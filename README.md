# Local PDF to Markdown Converter

A blazing-fast, privacy-first static web application that converts PDF documents to Markdown entirely within the browser. 

**No file ever leaves your machine.** There is no server-side processing, no telemetry, and zero data exfiltration.

## Key Features

- **100% Client-Side Processing**: Your PDFs and data stay on your device.
- **Lazy Local OCR**: Automatically detects scanned/image-only PDFs and runs OCR via ONNX Runtime Web only when needed.
- **Pages-Compatible Assets**: Keeps the default OCR path small and splits the optional accurate detector into deployable static chunks.
- **Intelligent Heuristics**: Analyzes font sizes and text positions to reconstruct appropriate Markdown headers, paragraphs, and lists.
- **Performance Focused**: Built with Vanilla JavaScript, pure CSS, and Vite. All heavy lifting happens in Web Workers to keep the UI perfectly responsive.

## Tech Stack

- **Build Tool**: [Vite](https://vitejs.dev/)
- **PDF Parsing & Rasterization**: [`pdfjs-dist`](https://mozilla.github.io/pdf.js/)
- **Machine Learning / OCR**: `onnxruntime-web`
- **Deployment**: Cloudflare Pages (Static Site)

## How It Works

The application intelligently selects a processing pipeline based on the PDF content:

1. **Text Extraction Pipeline**: For PDFs with a native text layer. Uses `pdfjs-dist` to extract text layout and applies heuristics to generate structured Markdown.
2. **OCR Pipeline**: For scanned or image-only PDFs. Rasterizes pages to an `OffscreenCanvas` in a Web Worker, then lazily loads local PaddleOCR ONNX assets to detect English text boxes and recognize text.

*All heavy tasks (PDF rasterization, extraction loops, and ONNX inference) run exclusively in Web Workers.*

## Security & Privacy

This application is designed with strict security boundaries:
- **Data Privacy**: No data is uploaded anywhere. No external APIs are called for processing.
- **Hardened Headers**: Implements `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to enable secure `SharedArrayBuffer` usage for multi-threaded WASM execution.
- **Strict CSP**: Enforces a strict Content Security Policy allowing only local scripts, workers, and secure WebAssembly execution.

## Getting Started

### Prerequisites
- Node.js (v18+)
- npm

### Installation

1. Clone the repository and navigate to the project directory:
   ```bash
   git clone <repository-url>
   cd converter
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Development

Start the Vite development server:
```bash
npm run dev
```

Run the pure logic tests:
```bash
npm test
```

### Build & Deployment

Build the production static assets:
```bash
npm run build
```
The optimized bundle will be placed in the `dist/` directory, ready to be deployed to Cloudflare Pages:
```bash
npx wrangler pages deploy dist
```

The build removes the unchunked server detector from `dist/` and serves the
optional accurate detector as sub-25 MiB chunks for Cloudflare Pages.

## Out of Scope
- Server-side processing or backend APIs.
- LocalStorage caching of uploaded documents.
- Table-to-Markdown conversion (treat as a future enhancement).
