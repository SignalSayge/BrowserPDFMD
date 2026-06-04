export async function detectDevice() {
  // Prefer a dedicated NPU (WebNN) for true offload, then GPU via the mature
  // WebGPU EP, then WebNN GPU as a fallback, then CPU/WASM. Every accelerated
  // option keeps 'wasm' last so createSession can fall back if the EP fails.
  if (await canUseWebnn('npu')) {
    return {
      type: 'webnn-npu',
      label: 'NPU',
      detail: 'WebNN NPU runtime',
      executionProviders: [{ name: 'webnn', deviceType: 'npu' }, 'wasm']
    };
  }

  if (await canUseWebgpu()) {
    return {
      type: 'webgpu',
      label: 'GPU',
      detail: 'WebGPU runtime',
      executionProviders: ['webgpu', 'wasm']
    };
  }

  if (await canUseWebnn('gpu')) {
    return {
      type: 'webnn',
      label: 'GPU (WebNN)',
      detail: 'WebNN GPU runtime',
      executionProviders: [{ name: 'webnn', deviceType: 'gpu' }, 'wasm']
    };
  }

  return {
    type: 'cpu',
    label: 'CPU',
    detail: 'WASM OCR runtime',
    executionProviders: ['wasm']
  };
}

async function canUseWebgpu() {
  if (typeof navigator.gpu?.requestAdapter !== 'function') {
    return false;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

async function canUseWebnn(deviceType) {
  if (typeof navigator.ml?.createContext !== 'function') {
    return false;
  }

  try {
    const context = await navigator.ml.createContext({ deviceType });
    return Boolean(context);
  } catch {
    return false;
  }
}
