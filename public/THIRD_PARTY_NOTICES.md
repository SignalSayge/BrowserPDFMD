# Third-Party Notices

This static application ships third-party browser dependencies and local OCR
model assets. No PDF, extracted text, or rendered page image is sent to any
third-party service at runtime.

## PaddleOCR Model Assets

The OCR model assets under `/models/paddleocr/` are exported ONNX versions of
official PaddleOCR/PaddlePaddle inference models:

- `PP-OCRv5_mobile_det`
- `PP-OCRv5_server_det`
- `en_PP-OCRv5_mobile_rec`

Upstream project: https://github.com/PaddlePaddle/PaddleOCR

License: Apache License 2.0

License copy: `/licenses/APACHE-2.0.txt`

Local modifications:

- Exported from Paddle inference format to ONNX for browser inference.
- Split the optional server detector into static chunks for Cloudflare Pages
  deployment.
- Added a manifest with source URLs, SHA-256 hashes, tensor metadata, and
  decoder settings.

The exact source archive URLs and SHA-256 hashes are recorded in
`/models/paddleocr/manifest.json`.

No separate upstream model-use policy notice was found beyond the Apache-2.0
license and attribution requirements.
