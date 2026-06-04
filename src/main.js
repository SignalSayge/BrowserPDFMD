import './styles.css';
import { detectDevice } from './detect.js';
import { createDropzone } from './ui/dropzone.js';
import { setOutput, copyOutput, downloadOutput } from './ui/output.js';
import {
  hideProgress,
  renderError,
  renderFileMeta,
  renderProgress,
  renderWarnings,
  resetError,
  setDeviceBadge
} from './ui/progress.js';

const elements = {
  cancelButton: document.querySelector('#cancelButton'),
  copyButton: document.querySelector('#copyButton'),
  deviceBadge: document.querySelector('#deviceBadge'),
  deviceLabel: document.querySelector('#deviceLabel'),
  downloadButton: document.querySelector('#downloadButton'),
  dropzone: document.querySelector('#dropzone'),
  errorPanel: document.querySelector('#errorPanel'),
  errorMessage: document.querySelector('#errorMessage'),
  errorTitle: document.querySelector('#errorTitle'),
  fileInput: document.querySelector('#fileInput'),
  fileMeta: document.querySelector('#fileMeta'),
  outputArea: document.querySelector('#outputArea'),
  ocrDetectorInputs: [...document.querySelectorAll('input[name="ocrDetector"]')],
  progressBar: document.querySelector('#progressBar'),
  progressCount: document.querySelector('#progressCount'),
  progressMessage: document.querySelector('#progressMessage'),
  progressPanel: document.querySelector('#progressPanel'),
  progressStage: document.querySelector('#progressStage'),
  progressTrack: document.querySelector('.progress-track'),
  retryButton: document.querySelector('#retryButton'),
  warningList: document.querySelector('#warningList')
};

const appState = {
  currentFile: null,
  currentTaskId: null,
  device: { type: 'cpu', label: 'CPU', executionProviders: ['wasm'] },
  ocrDetectorProfile: 'fast',
  worker: null
};

createDropzone({
  button: document.querySelector('#chooseFileButton'),
  dropzone: elements.dropzone,
  input: elements.fileInput,
  onFile: handleSelectedFile,
  onInvalidFile: (message) => {
    renderError(elements, {
      title: 'Unsupported file',
      message
    });
  }
});

elements.copyButton.addEventListener('click', async () => {
  await copyOutput(elements.outputArea);
});

elements.downloadButton.addEventListener('click', () => {
  const baseName = appState.currentFile?.name?.replace(/\.pdf$/i, '') || 'document';
  downloadOutput(elements.outputArea.value, `${baseName}.md`);
});

elements.retryButton.addEventListener('click', async () => {
  if (appState.currentFile) {
    await convertFile(appState.currentFile);
  }
});

elements.cancelButton.addEventListener('click', () => {
  cancelConversion();
});

for (const input of elements.ocrDetectorInputs) {
  input.addEventListener('change', () => {
    if (input.checked) {
      appState.ocrDetectorProfile = input.value;
    }
  });
}

await initialize();

async function initialize() {
  appState.worker = createPdfWorker();

  try {
    appState.device = await detectDevice();
    setDeviceBadge(elements, appState.device);
  } catch (error) {
    appState.device = { type: 'cpu', label: 'CPU', executionProviders: ['wasm'] };
    setDeviceBadge(elements, appState.device);
    console.warn('Compute detection failed; using CPU fallback.', error);
  }
}

async function handleSelectedFile(file) {
  appState.currentFile = file;
  await convertFile(file);
}

async function convertFile(file) {
  if (appState.currentTaskId) {
    cancelConversion({ showMessage: false });
  }

  resetError(elements);
  renderWarnings(elements, []);
  setOutput(elements, '');
  renderFileMeta(elements, file);
  elements.copyButton.disabled = true;
  elements.downloadButton.disabled = true;
  elements.cancelButton.hidden = false;
  elements.cancelButton.disabled = false;

  const taskId = crypto.randomUUID();
  appState.currentTaskId = taskId;

  renderProgress(elements, {
    stage: 'Reading',
    message: 'Preparing the PDF in memory.',
    percent: 5
  });

  try {
    const buffer = await file.arrayBuffer();
    if (appState.currentTaskId !== taskId) {
      return;
    }

    appState.worker.postMessage(
      {
        type: 'convert',
        taskId,
        file: {
          name: file.name,
          size: file.size,
          type: file.type
        },
        buffer,
        device: appState.device,
        ocr: {
          detectorProfile: appState.ocrDetectorProfile
        }
      },
      [buffer]
    );
  } catch (error) {
    if (appState.currentTaskId !== taskId) {
      return;
    }

    appState.currentTaskId = null;
    elements.cancelButton.hidden = true;
    elements.cancelButton.disabled = true;
    renderError(elements, {
      title: 'Unable to read PDF',
      message: error instanceof Error ? error.message : 'The browser could not read this file.'
    });
  }
}

function cancelConversion({ showMessage = true } = {}) {
  const hadTask = Boolean(appState.currentTaskId);
  appState.currentTaskId = null;
  appState.worker?.terminate();
  appState.worker = createPdfWorker();
  elements.cancelButton.hidden = true;
  elements.cancelButton.disabled = true;
  hideProgress(elements);

  if (showMessage && hadTask) {
    renderError(elements, {
      title: 'Conversion cancelled',
      message: 'The active conversion was stopped before it finished.'
    });
  }
}

function createPdfWorker() {
  const worker = new Worker(new URL('./worker/pdf.worker.js', import.meta.url), {
    type: 'module'
  });

  worker.addEventListener('message', ({ data }) => {
    if (!data || data.taskId !== appState.currentTaskId) {
      return;
    }

    if (data.type === 'progress') {
      if (data.device) {
        appState.device = data.device;
        setDeviceBadge(elements, data.device);
      }
      renderProgress(elements, data);
      if (data.warnings) {
        renderWarnings(elements, data.warnings);
      }
      return;
    }

    if (data.type === 'complete') {
      appState.currentTaskId = null;
      hideProgress(elements);
      elements.cancelButton.hidden = true;
      elements.cancelButton.disabled = true;
      setOutput(elements, data.markdown);
      renderWarnings(elements, data.warnings || []);
      elements.copyButton.disabled = !data.markdown;
      elements.downloadButton.disabled = !data.markdown;
      return;
    }

    if (data.type === 'error') {
      appState.currentTaskId = null;
      hideProgress(elements);
      elements.cancelButton.hidden = true;
      elements.cancelButton.disabled = true;
      renderWarnings(elements, data.warnings || []);
      renderError(elements, {
        title: data.error?.code || 'Conversion failed',
        message: data.error?.message || 'The PDF could not be converted.'
      });
    }
  });

  worker.addEventListener('error', (event) => {
    if (!appState.currentTaskId) {
      return;
    }

    hideProgress(elements);
    appState.currentTaskId = null;
    elements.cancelButton.hidden = true;
    elements.cancelButton.disabled = true;
    renderError(elements, {
      title: 'Worker error',
      message: event.message || 'The conversion worker stopped unexpectedly.'
    });
  });

  return worker;
}
