# Security Best Practices Report

## Executive Summary

No critical or high-severity security issues were found in the current client-only
PDF-to-Markdown implementation. The app keeps PDF data local, uses browser Web
Workers for processing, has no telemetry, and does not use browser storage.

Four hardening gaps were fixed during this review:

- Added a production browser security-header baseline, including CSP, COOP,
  COEP, CORP, `nosniff`, referrer policy, and permissions policy.
- Removed DOM HTML insertion sinks from file metadata and warning rendering.
- Added runtime SHA-256 verification for shipped OCR model and dictionary
  assets before ONNX session initialization.
- Added user-initiated cancellation and a worker-side active-task guard for
  expensive conversions.
- Split the optional accurate detector into sub-25 MiB static chunks so Pages
  deployment can keep all static assets under the current file-size limit.

The main remaining release requirements are fixture-based OCR accuracy tuning
and production deployment verification of Cloudflare response headers.

## Scope

Reviewed:

- Static Vite frontend files.
- Browser Web Worker PDF pipeline.
- OCR model loading boundary.
- Cloudflare Pages headers.
- Dependency audit output.

Verification commands:

- `npm audit --audit-level=moderate`: passed, 0 vulnerabilities.
- `npm test`: passed.
- `npm run build`: passed.
- Local OCR asset SHA-256 check against manifest: passed.
- Cloudflare Pages deployment-size check against current 25 MiB per-file limit:
  passed after chunking and WASM-only ORT build.
- Risky API scan for external URLs, web storage, DOM HTML sinks, eval-like APIs,
  navigation sinks, and messaging APIs.

## Critical Findings

None.

## High Findings

None.

## Medium Findings

### S-001: Missing Browser Security Headers

- Severity: Medium
- Status: Fixed
- Location: `public/_headers:2`
- Evidence: The app originally only configured COOP and COEP. It now includes a
  full static-site baseline:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
  - `Cross-Origin-Resource-Policy: same-origin`
  - `Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; ...`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), ...`
- Impact: Without CSP and related headers, an accidental DOM XSS bug or
  unexpected third-party resource path would have a larger blast radius.
- Fix: Added a CSP that allows same-origin scripts, workers, local fetches, and
  WebAssembly while blocking third-party scripts, plugins, forms, framing, and
  unnecessary browser capabilities.
- Mitigation: Keep any future dependencies and assets same-origin unless there
  is a documented reason to expand the CSP.
- False positive notes: `script-src 'wasm-unsafe-eval'` is intentional because
  PDF/OCR processing depends on WebAssembly. It does not enable JavaScript
  `eval`.

## Low Findings

### S-002: DOM HTML Insertion Sink in UI Rendering

- Severity: Low
- Status: Fixed
- Location: `src/ui/progress.js:8`
- Evidence: File metadata and warning list rendering now use `textContent`,
  `replaceChildren`, and explicit DOM nodes at `src/ui/progress.js:8` and
  `src/ui/progress.js:48`.
- Impact: PDF filenames are user-controlled local input. Rendering them through
  HTML parsing would be avoidable XSS risk.
- Fix: Replaced HTML-string rendering with safe DOM APIs.
- Mitigation: Continue using `textContent` and DOM node creation for all user or
  document-derived strings.

### S-003: OCR Model Supply Chain Requires Release Controls

- Severity: Low
- Status: Fixed for shipped assets; production accuracy fixtures still needed
- Location: `public/models/README.md:5`, `src/models/loader.js:57`
- Evidence: OCR assets are expected at local same-origin paths:
  `paddleocr/pp-ocrv5-mobile-det.onnx`,
  `paddleocr/pp-ocrv5-server-det.onnx`,
  `paddleocr/en-pp-ocrv5-mobile-rec.onnx`,
  `paddleocr/rec-dict.txt`, and `paddleocr/manifest.json`.
- Impact: ONNX model files are executable compute artifacts in the browser
  runtime. A tampered or unreviewed model could degrade results, exhaust memory,
  or undermine user trust.
- Fix: The model source URLs, license reference, export metadata, SHA-256 hashes,
  and input/output shapes are pinned in the manifest. Runtime loading now
  verifies model and dictionary SHA-256 hashes before ONNX sessions are created.
  Test fixture results still need to be added before production OCR release.
- Mitigation: Keep runtime loading local-only. Do not add CDN model URLs or
  runtime model download APIs.

## Informational Findings

### S-004: Worker Messaging Is Same-Origin Dedicated Worker Messaging

- Severity: Informational
- Status: Acceptable
- Location: `src/main.js:111`, `src/main.js:138`, `src/worker/pdf.worker.js:11`
- Evidence: The main thread creates a dedicated local worker and only accepts
  messages matching the current random task ID.
- Impact: This is not cross-window `postMessage`; no external origin is involved.
- Fix: None required now.
- Mitigation: If future code adds `window.postMessage`, iframes, or service
  workers, add strict origin and schema validation.

### S-005: No Data Exfiltration Paths Found

- Severity: Informational
- Status: Acceptable
- Location: `src/models/loader.js:36`, `src/models/loader.js:52`
- Evidence: The only `fetch` calls target local OCR model assets. No remote URLs,
  analytics, external APIs, web storage, or document upload paths were found.
- Impact: Current implementation aligns with the local-only privacy requirement.
- Fix: None required now.
- Mitigation: Keep `connect-src 'self'` in CSP and reject any future remote OCR,
  telemetry, or document-processing endpoints unless the product requirements
  explicitly change.

## Additional App Requirements Before Production

- Add OCR fixture results for the exact shipped model files.
- Add any required upstream model notice text if deployment policy requires
  notices beyond manifest license fields.
- Add PDF fixtures for text-layer, scanned, and two-column documents.
- Test the deployed Cloudflare Pages response headers with `curl -I` or browser
  devtools after deployment.
