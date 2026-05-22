# PDF to Markdown Converter — Technical Specification

## 1. Overview

A static web application that converts PDF documents to Markdown entirely on the
client. No file ever leaves the browser. Hosted on Cloudflare Pages (no Workers,
no backend). The app detects and uses the best available compute device
(GPU → NPU → CPU/WASM) to accelerate ML-based processing for scanned or
complex PDFs.

---

## 2. Processing Modes

The app determines which pipeline to run based on the content of the PDF.

| Mode | Trigger | GPU Benefit |
|---|---|---|
| **Text extraction** | PDF has a text layer | None — PDF.js parses natively |
| **OCR** | PDF is image-only (scanned) | High — runs inference on each page image |
| **Layout analysis** | Text PDF with complex structure (tables, columns) | Medium — runs a layout model on top of extracted text |

Detection: after PDF.js loads the document, attempt `getTextContent()` on page 1.
If the total character count across a sample of pages is below a threshold
(e.g. < 50 chars/page average), treat the document as scanned and invoke OCR.

---

## 3. Tech Stack

| Concern | Library | Notes |
|---|---|---|
| PDF parsing | `pdfjs-dist` | Text layer extraction, page rasterization |
| OCR inference | `onnxruntime-web` | Runs ONNX models with WebGPU/WASM backend |
| OCR model | PaddleOCR v4 (ONNX export) or TrOCR-small (ONNX export) | Host model files in `/public/models/` |
| Transformers (optional) | `@huggingface/transformers` | Alternative to raw ONNX RT; easier model loading |
| Build tool | Vite | Fast dev server, ESM output, good Cloudflare Pages compat |
| Deployment | Cloudflare Pages | Static site, `wrangler pages deploy dist` |

No UI framework is required. Vanilla JS + CSS is sufficient and keeps the bundle
small. Add a framework (React, Svelte) only if the UI complexity warrants it.

---

## 4. Device Detection & Accelerator Selection

Run this once at startup and store the result for use throughout the session.

```
async function detectDevice() {
  // 1. Try WebGPU
  if (navigator.gpu) {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter) {
      const device = await adapter.requestDevice();
      return { type: 'webgpu', device };
    }
  }

  // 2. Try WebNN
  if (navigator.ml) {
    try {
      const ctx = await navigator.ml.createContext({ deviceType: 'gpu' });
      return { type: 'webnn', context: ctx };
    } catch {
      try {
        const ctx = await navigator.ml.createContext({ deviceType: 'npu' });
        return { type: 'webnn-npu', context: ctx };
      } catch { /* fall through */ }
    }
  }

  // 3. WASM/CPU fallback
  return { type: 'cpu' };
}
```

Map the result to an ONNX Runtime execution provider:

| Detected device | ONNX RT executionProviders |
|---|---|
| `webgpu` | `['webgpu', 'wasm']` |
| `webnn` / `webnn-npu` | `['webnn', 'wasm']` |
| `cpu` | `['wasm']` |

Surface the detected device in the UI so the user knows what is being used.

---

## 5. Application Architecture

```
src/
  main.js              # Entry point; wires up UI events
  detect.js            # Device detection (section 4)
  pipeline/
    classify.js        # Determines processing mode (text / OCR / layout)
    text.js            # Text-PDF pipeline
    ocr.js             # Scanned-PDF pipeline
    layout.js          # (Optional) layout analysis pass
  convert/
    heuristics.js      # Font-size / position → Markdown rules
    postprocess.js     # Cleanup: dedup blank lines, merge broken words, etc.
  ui/
    dropzone.js        # Drag-and-drop / file input handling
    progress.js        # Progress bar and status messages
    output.js          # Render output, copy, download
  models/
    loader.js          # ONNX session management; lazy-loads on first use
public/
  models/              # ONNX model files (committed or fetched from CDN)
index.html
vite.config.js
wrangler.toml
```

---

## 6. Pipeline: Text-Based PDF

Uses PDF.js only. No ML inference.

**Steps:**

1. Load document: `pdfjsLib.getDocument({ data: arrayBuffer })`
2. For each page:
   a. `page.getTextContent({ normalizeWhitespace: false })`
   b. Map each item to `{ str, x, y, fontSize, pageNum }`:
      - `x = transform[4]`
      - `y = viewportHeight - transform[5]`  (flip: PDF origin is bottom-left)
      - `fontSize = Math.abs(transform[3])`
   c. Group items into lines by Y-proximity (threshold: `fontSize * 0.5`)
   d. Sort lines top-to-bottom, items within each line left-to-right
   e. Concatenate item strings per line, collapse internal whitespace
3. Pass all lines to `heuristics.js` (section 8)
4. Pass result to `postprocess.js` (section 9)

**Edge cases:**
- Items with `fontSize < 1` are likely artifacts — skip them
- Rotated text (`transform[1] !== 0`) can be skipped or flagged
- Items whose Y overlaps the previous line by more than 50% are likely superscripts — append inline rather than starting a new line

---

## 7. Pipeline: Scanned PDF (OCR)

Uses PDF.js for rasterization, then ONNX Runtime for inference.

**Steps:**

1. For each page, render to an off-screen canvas at a suitable resolution
   (recommend 150–200 DPI equivalent; PDF.js scale = targetDPI / 72):
   ```
   const viewport = page.getViewport({ scale: 2.0 });
   const canvas = new OffscreenCanvas(viewport.width, viewport.height);
   const ctx = canvas.getContext('2d');
   await page.render({ canvasContext: ctx, viewport }).promise;
   const imageData = ctx.getImageData(0, 0, viewport.width, viewport.height);
   ```
2. Pre-process image for the model (resize, normalize, convert to tensor).
3. Run inference via ONNX Runtime Web:
   ```
   const session = await ort.InferenceSession.create('/models/ocr.onnx', {
     executionProviders: resolvedProviders
   });
   const output = await session.run(inputTensor);
   ```
4. Decode output tokens to text strings.
5. If the model also produces bounding boxes, use them to reconstruct line order.
6. Pass lines to `heuristics.js`.

**Model choices (pick one):**

- **PaddleOCR v4** — strong multilingual support; two ONNX files (detection +
  recognition). More complex to wire up.
- **TrOCR-small** (Microsoft) — single model, English-focused, simpler pipeline.
  ONNX export available via Hugging Face.
- **EasyOCR** — ONNX-exportable; good for bootstrapping.

Model files should be served from `/public/models/` to avoid CORS issues.
Load lazily (only when OCR is needed). Show a one-time download progress
indicator on first use if models are large.

---

## 8. Heuristics: Lines → Markdown (`heuristics.js`)

**Input:** array of `{ text, fontSize, y, pageNum }` objects, sorted top-to-bottom.

**Body font size detection:**
Collect all font sizes across the document, round to nearest integer, find the
statistical mode. This is the baseline body size.

**Per-line classification:**

```
ratio = line.fontSize / bodyFontSize

if ratio >= 1.9  → "# "  + text        (H1)
if ratio >= 1.45 → "## " + text        (H2)
if ratio >= 1.18 → "### " + text       (H3)
if text matches /^[•●◦▪]\s*/  → "- " + stripped text   (unordered list)
if text matches /^[-–—]\s+\S/ → "- " + stripped text   (unordered list)
if text matches /^\d+[.)]\s+/ → N. stripped text       (ordered list)
otherwise → text as-is (paragraph)
```

**Paragraph break detection:**
Between two consecutive lines, if:
- `line.pageNum !== prev.pageNum`, OR
- vertical gap `> fontSize * 2.2`

...insert a blank line in the output.

**Column detection (optional enhancement):**
If two lines have the same Y but non-overlapping X ranges, they are likely
parallel columns. Heuristic: process left column first, then right, separated
by a blank line. Detect by checking whether items on the same page share
nearly identical Y values with an X gap larger than 20% of page width.

---

## 9. Post-Processing (`postprocess.js`)

Applied to the raw Markdown string after heuristic conversion:

1. Collapse 3+ consecutive blank lines to 2
2. Trim leading/trailing whitespace per line
3. Detect broken hyphenated words across lines: `word-\nrest` → `wordrest`
4. Remove lines that are purely numeric (likely page numbers) if they appear
   alone with surrounding blank lines
5. Remove lines that are single characters or fewer than 3 characters and are
   not part of a list (likely artifacts)
6. Normalize list indentation: detect nested lists by X position of original
   items relative to the leftmost list item

---

## 10. UI Requirements

**Layout:** single page, no routing.

**States:**

| State | UI |
|---|---|
| Idle | Drop zone centered, device badge visible |
| Loading model | Progress bar, "Loading OCR model (first use)" message |
| Processing | Per-page progress counter, spinning indicator |
| Complete | Markdown output area, copy button, download button |
| Error | Inline error message, option to retry |

**Device badge:** small indicator in the corner showing detected compute:
`GPU (WebGPU)`, `NPU (WebNN)`, or `CPU`. Helps the user understand performance
expectations.

**Output area:** monospace, scrollable, read-only `<textarea>` or `<pre>` block.
Allow the user to select and edit before downloading.

**Download:** generate a `Blob` with `type: 'text/markdown'`, trigger download
via an `<a>` with `href = URL.createObjectURL(blob)`.

---

## 11. Cloudflare Pages Configuration

`wrangler.toml`:
```toml
name = "pdf-to-markdown"
pages_build_output_dir = "dist"
```

`vite.config.js` notes:
- Set `base: '/'`
- ONNX Runtime Web requires the `.wasm` and `.mjs` worker files to be served
  with correct MIME types and COOP/COEP headers (required for SharedArrayBuffer,
  which ONNX RT uses for threading)

`_headers` file in `/public/`:
```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

These headers are required for WebGPU and SharedArrayBuffer to be available.
Cloudflare Pages serves files from `/public/` at the root, so place `_headers`
there.

---

## 12. Browser Compatibility

| Feature | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| PDF.js | ✓ | ✓ | ✓ | ✓ |
| WebGPU | 113+ | 113+ | Nightly | 18+ (limited) |
| WebNN | 113+ | 113+ | No | No |
| ONNX RT WASM | ✓ | ✓ | ✓ | ✓ |
| SharedArrayBuffer | ✓ (with COOP/COEP) | ✓ | ✓ | ✓ |

The app must function in all modern browsers via the WASM fallback. GPU
acceleration is a progressive enhancement.

---

## 13. Performance Considerations

- Rasterize PDF pages in a Web Worker to avoid blocking the main thread
- Lazy-load ONNX models (only if OCR is needed); cache the session across pages
  of the same document
- For large PDFs, process pages in batches and yield to the event loop between
  batches to keep the UI responsive
- WebGPU inference can handle batches of page images simultaneously; tune batch
  size based on adapter `maxBufferSize` limits
- WASM fallback: use `ort.env.wasm.numThreads` to match `navigator.hardwareConcurrency`

---

## 14. Out of Scope

- Server-side processing of any kind
- Storing or caching documents between sessions
- User accounts or authentication
- Table-to-Markdown conversion (complex layout; treat as a future enhancement)
- RTL language support in the Markdown output ordering