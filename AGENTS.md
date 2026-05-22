# AI Agent Guardrails & Guidelines

You are an expert Frontend Web Developer and Machine Learning Engineer.
When generating code, answering questions, or refactoring this project, you MUST adhere strictly to the following rules derived from the project PRD.

## 1. Absolute Hard Rules (DO NOT VIOLATE)
- **CLIENT-SIDE ONLY:** This is a 100% static client-side application. NEVER suggest, write, or implement any Node.js, Python, or backend server code.
- **ZERO DATA EXFILTRATION:** User privacy is paramount. NEVER write code that uploads the user's PDF, extracted text, or images to any external server or API. All processing must happen locally in the browser.
- **VANILLA JS PREFERRED:** Do not initialize or suggest UI frameworks (React, Vue, Svelte, Angular) unless explicitly instructed by the user. Use Vanilla JavaScript (ES6+ module syntax) and pure CSS.

## 2. Tech Stack & Dependencies
- **Build Tool:** Vite. Ensure all modules are ESM-compatible.
- **PDF Processing:** Use `pdfjs-dist`.
- **ML/OCR:** Use `onnxruntime-web` for inference.
- NEVER add dependencies that require Node.js built-ins (e.g., `fs`, `path`, `crypto`). If a polyfill is needed, rely on Vite's browser-compatible equivalents.

## 3. Architecture & Performance
- **Web Workers are Mandatory:** PDF rasterization, text extraction loops, and ONNX Runtime inference MUST be executed within Web Workers. NEVER block the main UI thread.
- **Offscreen Rendering:** When extracting images from PDFs for OCR, use `OffscreenCanvas` within the Web Worker.
- **Lazy Loading:** ONNX models are large. Do not load `ort.InferenceSession` or fetch `.onnx` files until the application determines OCR is actively required for the document.
- **Memory Management:** WebAssembly memory is limited. Suggest code that cleans up tensors, nullifies large arrays, and destroys ORT sessions when they are no longer needed.

## 4. Environment & Hosting Constraints
- **Cloudflare Pages:** The app is deployed to Cloudflare Pages as a static site. 
- **Cross-Origin Isolation:** Because ONNX Runtime Web utilizes `SharedArrayBuffer` for multi-threading, the application assumes `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers are present. Ensure Web Workers and WASM files are loaded in a way that respects these headers.

## 5. Coding Style
- Use modern async/await syntax. Avoid `.then()` chains unless strictly necessary.
- Document complex heuristics (like the font-size to markdown header logic) with inline block comments explaining the math.
- Provide robust error handling in Web Workers and pass structured error messages back to the main thread via `postMessage`.

## 6. Out of Scope Features
Do NOT implement or suggest code for the following unless the user explicitly overrides this file:
- Table-to-Markdown conversion.
- RTL (Right-to-Left) language support.
- LocalStorage caching of uploaded documents.
- User authentication.