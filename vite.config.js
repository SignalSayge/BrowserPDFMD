import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

function removeUnshippedLargeModels() {
  return {
    name: 'remove-unshipped-large-models',
    closeBundle() {
      rmSync(resolve('dist/models/paddleocr/pp-ocrv5-server-det.onnx'), {
        force: true
      });
    }
  };
}

export default defineConfig({
  base: '/',
  build: {
    target: 'es2022'
  },
  plugins: [removeUnshippedLargeModels()],
  worker: {
    format: 'es'
  }
});
