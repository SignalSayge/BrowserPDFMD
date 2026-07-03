export const OCR_DETECTOR_PROFILES = {
  fast: {
    label: 'Fast',
    model: 'PP-OCRv5_mobile_det',
    url: '/models/paddleocr/pp-ocrv5-mobile-det.onnx'
  },
  accurate: {
    label: 'Accurate',
    model: 'PP-OCRv5_server_det',
    url: '/models/paddleocr/pp-ocrv5-server-det.onnx'
  }
};

export const OCR_MODEL_ASSETS = {
  manifest: '/models/paddleocr/manifest.json',
  recognizer: '/models/paddleocr/en-pp-ocrv5-mobile-rec.onnx',
  dictionary: '/models/paddleocr/rec-dict.txt'
};

export async function loadOcrModels(device, {
  detectorProfile = 'fast',
  onProgress
} = {}) {
  const selectedDetector = getDetectorProfile(detectorProfile);
  onProgress?.({
    stage: 'Loading model',
    message: 'Loading local OCR manifest.',
    percent: 20
  });

  const manifest = await loadManifest(selectedDetector);

  onProgress?.({
    stage: 'Loading model',
    message: 'Loading ONNX Runtime Web.',
    percent: 21
  });

  const ort = await import('onnxruntime-web/webgpu');
  configureOrt(ort);

  const plan = buildExecutionPlan(device);

  let detector;
  let recognizer;
  let detectorDeviceType;
  let recognizerDeviceType;
  let dictionaryText;
  try {
    const detectorManifest = manifest.detectors[selectedDetector.key];
    const detectorBytes = await fetchModelAsset({
      chunks: detectorManifest.chunks,
      label: `${selectedDetector.label} detector`,
      onProgress,
      percentEnd: 23.5,
      percentStart: 21,
      url: selectedDetector.url
    });
    await verifyBinaryAsset(
      detectorBytes,
      detectorManifest,
      `${selectedDetector.label} detector`
    );

    const recognizerBytes = await fetchModelAsset({
      label: 'English recognizer',
      onProgress,
      percentEnd: 25,
      percentStart: 23.5,
      url: OCR_MODEL_ASSETS.recognizer
    });
    await verifyBinaryAsset(
      recognizerBytes,
      manifest.recognizer,
      'English recognizer'
    );

    dictionaryText = await fetchTextAsset(
      OCR_MODEL_ASSETS.dictionary,
      'recognition dictionary'
    );
    await verifyTextAsset(
      dictionaryText,
      manifest.recognizer.dictionarySha256,
      'recognition dictionary'
    );

    onProgress?.({
      stage: 'Loading model',
      message: `Initializing ${selectedDetector.label} OCR detector.`,
      percent: 25
    });
    ({ session: detector, deviceType: detectorDeviceType } = await createSession(
      ort,
      detectorBytes,
      plan,
      `${selectedDetector.label} detector`
    ));

    onProgress?.({
      stage: 'Loading model',
      message: 'Initializing English OCR recognizer.',
      percent: 25
    });
    ({ session: recognizer, deviceType: recognizerDeviceType } = await createSession(
      ort,
      recognizerBytes,
      plan,
      'English recognizer'
    ));
  } catch (error) {
    await detector?.release?.();
    await recognizer?.release?.();
    throw error;
  }

  // Report the execution provider the sessions actually initialized on, so the
  // UI badge reflects reality instead of the optimistic main-thread detection.
  const effectiveDevice =
    DEVICE_DESCRIPTORS[weakerDevice(detectorDeviceType, recognizerDeviceType)];
  onProgress?.({
    stage: 'Loading model',
    message: `OCR running on ${effectiveDevice.label}.`,
    percent: 25,
    device: effectiveDevice
  });

  return {
    ort,
    detector,
    detectorProfile: selectedDetector,
    recognizer,
    device: effectiveDevice,
    dictionary: dictionaryText.split(/\r?\n/).filter(Boolean),
    manifest
  };
}

async function loadManifest(selectedDetector) {
  const response = await fetch(OCR_MODEL_ASSETS.manifest, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw createWorkerError(
      'OCR_MANIFEST_MISSING',
      `Add the local OCR manifest at ${OCR_MODEL_ASSETS.manifest} before OCR can run.`
    );
  }

  const manifest = await response.json();
  const expectedRecognizer = 'en_PP-OCRv5_mobile_rec';

  if (
    manifest?.detectors?.[selectedDetector.key]?.model !== selectedDetector.model ||
    manifest?.recognizer?.model !== expectedRecognizer
  ) {
    throw createWorkerError(
      'OCR_MANIFEST_MISMATCH',
      `OCR manifest must declare ${selectedDetector.model} and ${expectedRecognizer}.`
    );
  }

  return manifest;
}

async function fetchModelAsset({
  chunks,
  label,
  onProgress,
  percentEnd,
  percentStart,
  url
}) {
  if (!chunks?.length) {
    return fetchBinaryAsset(url, {
      label,
      onProgress,
      percentEnd,
      percentStart
    });
  }

  const bytesByChunk = [];
  const totalBytes = chunks.reduce((sum, chunk) => sum + (chunk.sizeBytes || 0), 0);
  let completedBytes = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const chunkStart = totalBytes
      ? percentStart + (completedBytes / totalBytes) * (percentEnd - percentStart)
      : percentStart;
    const chunkEnd = totalBytes
      ? percentStart +
        ((completedBytes + chunk.sizeBytes) / totalBytes) * (percentEnd - percentStart)
      : percentEnd;
    const chunkBytes = await fetchBinaryAsset(toModelAssetUrl(chunk.filename), {
      label: `${label} chunk ${index + 1}/${chunks.length}`,
      onProgress,
      percentEnd: chunkEnd,
      percentStart: chunkStart
    });

    await verifyChunkAsset(chunkBytes, chunk, `${label} chunk ${index + 1}`);
    bytesByChunk.push(chunkBytes);
    completedBytes += chunkBytes.byteLength;
  }

  const merged = new Uint8Array(completedBytes);
  let offset = 0;
  for (const chunkBytes of bytesByChunk) {
    merged.set(chunkBytes, offset);
    offset += chunkBytes.byteLength;
  }

  return merged;
}

async function fetchBinaryAsset(url, {
  label,
  onProgress,
  percentEnd,
  percentStart
}) {
  const response = await fetch(url, {
    cache: 'force-cache'
  });

  if (!response.ok) {
    throw createWorkerError(
      'OCR_MODEL_MISSING',
      `The local OCR asset could not be loaded at ${url}.`
    );
  }

  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress?.({
      stage: 'Loading model',
      message: `Loaded ${label}.`,
      percent: percentEnd
    });
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push(value);
    received += value.byteLength;

    const percent = total
      ? percentStart + (received / total) * (percentEnd - percentStart)
      : percentStart;
    const message = total
      ? `Loading ${label}: ${formatBytes(received)} of ${formatBytes(total)}.`
      : `Loading ${label}: ${formatBytes(received)}.`;

    onProgress?.({
      stage: 'Loading model',
      message,
      percent
    });
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  onProgress?.({
    stage: 'Loading model',
    message: `Loaded ${label}.`,
    percent: percentEnd
  });

  return bytes;
}

function toModelAssetUrl(filename) {
  return `/models/paddleocr/${filename}`;
}

async function fetchTextAsset(url, label) {
  const response = await fetch(url, {
    cache: 'force-cache'
  });

  if (!response.ok) {
    throw createWorkerError(
      'OCR_MODEL_MISSING',
      `The local OCR ${label} could not be loaded at ${url}.`
    );
  }

  return response.text();
}

async function verifyBinaryAsset(bytes, manifestEntry, label) {
  if (manifestEntry?.sizeBytes && bytes.byteLength !== manifestEntry.sizeBytes) {
    throw createWorkerError(
      'OCR_MODEL_INTEGRITY',
      `${label} size does not match the OCR manifest.`
    );
  }

  await verifyBytes(bytes, manifestEntry?.sha256, label);
}

async function verifyChunkAsset(bytes, chunk, label) {
  if (chunk?.sizeBytes && bytes.byteLength !== chunk.sizeBytes) {
    throw createWorkerError(
      'OCR_MODEL_INTEGRITY',
      `${label} size does not match the OCR manifest.`
    );
  }

  await verifyBytes(bytes, chunk?.sha256, label);
}

async function verifyTextAsset(text, expectedHash, label) {
  const bytes = new TextEncoder().encode(text);
  await verifyBytes(bytes, expectedHash, label);
}

async function verifyBytes(bytes, expectedHash, label) {
  if (!expectedHash) {
    throw createWorkerError(
      'OCR_MODEL_INTEGRITY',
      `${label} is missing a SHA-256 hash in the OCR manifest.`
    );
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actualHash = toHex(new Uint8Array(digest));

  if (actualHash !== expectedHash) {
    throw createWorkerError(
      'OCR_MODEL_INTEGRITY',
      `${label} SHA-256 does not match the OCR manifest.`
    );
  }
}

function getDetectorProfile(detectorProfile) {
  const key = Object.hasOwn(OCR_DETECTOR_PROFILES, detectorProfile)
    ? detectorProfile
    : 'fast';
  return {
    key,
    ...OCR_DETECTOR_PROFILES[key]
  };
}

// Accelerator tiers list the accelerator alone (no 'wasm') so that a genuine
// initialization failure throws and advances to the next tier — giving an
// NPU -> WebGPU -> CPU failover and a session whose success honestly reflects
// the provider in use. Only the final CPU tier uses 'wasm'.
const WEBGPU_TIER = { type: 'webgpu', providers: ['webgpu'] };
const CPU_TIER = { type: 'cpu', providers: ['wasm'] };

const DEVICE_DESCRIPTORS = {
  'webnn-npu': { type: 'webnn-npu', label: 'NPU', detail: 'WebNN NPU runtime' },
  webnn: { type: 'webnn', label: 'GPU (WebNN)', detail: 'WebNN GPU runtime' },
  webgpu: { type: 'webgpu', label: 'GPU', detail: 'WebGPU runtime' },
  cpu: { type: 'cpu', label: 'CPU', detail: 'WASM OCR runtime' }
};

const DEVICE_RANK = { cpu: 0, webgpu: 1, webnn: 2, 'webnn-npu': 3 };

function buildExecutionPlan(device) {
  switch (device?.type) {
    case 'webnn-npu':
      return [
        { type: 'webnn-npu', providers: [{ name: 'webnn', deviceType: 'npu' }] },
        WEBGPU_TIER,
        CPU_TIER
      ];
    case 'webnn':
      return [
        { type: 'webnn', providers: [{ name: 'webnn', deviceType: 'gpu' }] },
        WEBGPU_TIER,
        CPU_TIER
      ];
    case 'webgpu':
      return [WEBGPU_TIER, CPU_TIER];
    default:
      return [CPU_TIER];
  }
}

function weakerDevice(a, b) {
  return DEVICE_RANK[a] <= DEVICE_RANK[b] ? a : b;
}

async function createSession(ort, modelBytes, plan, label) {
  for (let index = 0; index < plan.length; index += 1) {
    const tier = plan[index];
    try {
      const session = await ort.InferenceSession.create(modelBytes, {
        executionProviders: tier.providers
      });
      console.info(`[OCR] ${label}: running on ${tier.type}.`);
      return { session, deviceType: tier.type };
    } catch (error) {
      const next = plan[index + 1];
      if (!next) {
        throw error;
      }
      console.warn(
        `[OCR] ${label}: ${tier.type} could not initialize; trying ${next.type}. Reason:`,
        error
      );
    }
  }

  throw new Error('No execution provider could be initialized.');
}

function configureOrt(ort) {
  // Surface ORT's own "N nodes were not assigned to the preferred execution
  // provider" diagnostics so a silent CPU fallback (e.g. WebNN declining the
  // graph) is visible in the console.
  ort.env.logLevel = 'warning';
  const threads = Math.max(1, Math.min(navigator.hardwareConcurrency || 1, 4));
  ort.env.wasm.numThreads = self.crossOriginIsolated ? threads : 1;
}

function toHex(bytes) {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function createWorkerError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}
