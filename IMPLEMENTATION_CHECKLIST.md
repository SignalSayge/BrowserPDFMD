# Implementation Checklist

## Current Status

- [x] Scaffold static Vite app with vanilla JavaScript and CSS.
- [x] Keep all document processing client-side.
- [x] Run PDF classification and conversion inside browser Web Workers.
- [x] Implement text-layer PDF extraction with PDF.js.
- [x] Add Markdown heading, list, paragraph, and cleanup heuristics.
- [x] Add two-column reading-order heuristic for text PDFs.
- [x] Add copy and Markdown download controls.
- [x] Add hover/focus info icon explaining local processing.
- [x] Add Cloudflare Pages `_headers` with COOP, COEP, CSP, and related security headers.
- [x] Add OCR detector profile UI: `Fast` and `Accurate`.
- [x] Define OCR asset manifest contract.

## OCR Assets

- [x] Download official PaddleOCR inference models:
  - [x] `PP-OCRv5_mobile_det`
  - [x] `PP-OCRv5_server_det`
  - [x] `en_PP-OCRv5_mobile_rec`
- [x] Convert Paddle inference models to ONNX:
  - [x] `public/models/paddleocr/pp-ocrv5-mobile-det.onnx`
  - [x] `public/models/paddleocr/pp-ocrv5-server-det.onnx.part01` through `.part05`
  - [x] `public/models/paddleocr/en-pp-ocrv5-mobile-rec.onnx`
- [x] Add `public/models/paddleocr/rec-dict.txt`.
- [x] Fill `public/models/paddleocr/manifest.json`:
  - [x] Source URLs.
  - [x] License references.
  - [x] SHA-256 hashes.
  - [x] Input tensor names and shapes.
  - [x] Output tensor names and shapes.
  - [x] Detector postprocess thresholds.
  - [x] Recognizer CTC decoder settings.
- [x] Verify shipped OCR asset SHA-256 hashes at runtime before ONNX session initialization.
- [x] Split the optional server detector into sub-25 MiB chunks for Cloudflare Pages deployment.
- [x] Add served third-party notice text for shipped PaddleOCR model assets.

## OCR Pipeline

- [x] Preprocess rendered page images for PaddleOCR detection.
- [x] Run selected detector profile lazily after scanned-PDF detection.
- [x] Decode detector output into text boxes.
- [x] Crop and normalize detected text boxes for recognition.
- [x] Run English recognizer on each crop.
- [x] Decode CTC logits with `rec-dict.txt`.
- [x] Sort OCR boxes into layout-aware reading order.
- [x] Convert OCR lines through the existing Markdown heuristics.
- [x] Release tensors and large image buffers after each page.
- [x] Add rotated text box estimation and affine deskew crop support.
- [ ] Tune detector box decoding against real scanned PDF fixtures.
- [ ] Tune skewed/rotated OCR behavior against real scanned PDF fixtures.

## Robustness

- [x] Add cancellation for large or slow conversions.
- [x] Add scanned-PDF memory warnings.
- [x] Add clearer OCR model download progress.
- [ ] Add fixture PDFs:
  - [ ] Text-layer PDF.
  - [ ] Scanned English PDF.
  - [ ] Two-column PDF.
  - [ ] Noisy or skewed scan.
- [x] Add automated tests for Markdown heuristics and layout ordering.

## Deployment

- [x] Run `npm run build`.
- [x] Keep generated `dist/` assets below Cloudflare Pages' current 25 MiB per-file limit.
- [ ] Deploy to Cloudflare Pages.
- [ ] Verify `_headers` are applied in production.
- [ ] Verify `crossOriginIsolated === true` in production.
- [ ] Test text PDF conversion in production.
- [ ] Test OCR model loading in production.
