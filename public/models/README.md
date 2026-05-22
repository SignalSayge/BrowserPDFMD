# Local OCR Model Assets

Place browser-served ONNX OCR assets in this directory.

The implementation supports text-layer PDF conversion and a lazy OCR path.
Scanned PDFs are detected locally, then OCR assets are loaded only when needed.
Model and dictionary SHA-256 hashes are verified against the manifest before
ONNX Runtime sessions are initialized.

## Selected Direction

Expected text is English, and preserving layout is useful. Use an English
PaddleOCR-style detector plus recognizer instead of a page-level recognizer.
The detector provides text boxes for reading order, columns, and line grouping;
the recognizer converts each crop to text.

Chosen v1 configuration:

- Default detector: `PP-OCRv5_mobile_det` to reduce first OCR download size.
- Optional detector: `PP-OCRv5_server_det` when the user selects accuracy.
- Recognizer: `en_PP-OCRv5_mobile_rec` for English text recognition.
- Orientation classifier: omitted for v1; assume upright scans.
- Semantic layout model: omitted for v1; use detector boxes for reading order.

Expected paths:

- `paddleocr/manifest.json`
- `paddleocr/pp-ocrv5-mobile-det.onnx`
- `paddleocr/pp-ocrv5-server-det.onnx.part01` through `.part05`
- `paddleocr/en-pp-ocrv5-mobile-rec.onnx`
- `paddleocr/rec-dict.txt`

Do not load model files from external APIs or CDNs at runtime. Keep OCR assets
local to preserve the client-only privacy model.

The manifest records the source URLs, SHA-256 hashes, input names, output names,
shapes, decoder settings, and export metadata for the exact ONNX files being
shipped.
