export async function detectDevice() {
  return {
    type: 'cpu',
    label: 'CPU',
    detail: 'WASM OCR runtime',
    executionProviders: ['wasm']
  };
}
