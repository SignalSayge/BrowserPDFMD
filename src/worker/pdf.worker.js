import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { linesToMarkdown } from '../convert/heuristics.js';
import { postprocessMarkdown } from '../convert/postprocess.js';
import { classifyDocument } from '../pipeline/classify.js';
import { runOcrPipeline } from '../pipeline/ocr.js';
import { extractTextLines } from '../pipeline/text.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// pdf.js renders pages with DOMCanvasFactory/DOMFilterFactory by default, which
// call document.createElement — unavailable in this Web Worker. Supply
// worker-safe factories so page.render() works for OCR rasterization.
class OffscreenCanvasFactory {
  create(width, height) {
    if (width <= 0 || height <= 0) {
      throw new Error('Invalid canvas size');
    }
    const canvas = new OffscreenCanvas(width, height);
    return {
      canvas,
      context: canvas.getContext('2d', { willReadFrequently: true })
    };
  }

  reset(canvasAndContext, width, height) {
    if (!canvasAndContext.canvas) {
      throw new Error('Canvas is not specified');
    }
    if (width <= 0 || height <= 0) {
      throw new Error('Invalid canvas size');
    }
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {
    if (!canvasAndContext.canvas) {
      throw new Error('Canvas is not specified');
    }
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

class NoOpFilterFactory {
  addFilter() {
    return 'none';
  }

  addHCMFilter() {
    return 'none';
  }

  addAlphaFilter() {
    return 'none';
  }

  addLuminosityFilter() {
    return 'none';
  }

  addHighlightHCMFilter() {
    return 'none';
  }

  destroy() {}
}

let activeTaskId = null;

self.addEventListener('message', (event) => {
  const { data } = event;
  if (data?.type !== 'convert') {
    return;
  }

  if (activeTaskId) {
    self.postMessage({
      type: 'error',
      taskId: data.taskId,
      error: {
        code: 'WORKER_BUSY',
        message: 'A conversion is already running in this worker.',
        details: null
      },
      warnings: []
    });
    return;
  }

  activeTaskId = data.taskId;
  convertPdf(data)
    .catch((error) => {
      self.postMessage({
        type: 'error',
        taskId: data.taskId,
        error: normalizeError(error),
        warnings: error?.warnings || []
      });
    })
    .finally(() => {
      if (activeTaskId === data.taskId) {
        activeTaskId = null;
      }
    });
});

async function convertPdf({ buffer, device, file, ocr, taskId }) {
  const warnings = [];
  const progress = (payload) => {
    self.postMessage({
      type: 'progress',
      taskId,
      ...payload
    });
  };

  progress({
    stage: 'Loading',
    message: 'Opening PDF structure.',
    percent: 8
  });

  const loadingTask = pdfjsLib.getDocument({
    data: buffer,
    disableFontFace: true,
    useSystemFonts: true,
    CanvasFactory: OffscreenCanvasFactory,
    FilterFactory: NoOpFilterFactory
  });

  let pdf;

  try {
    pdf = await loadingTask.promise;

    progress({
      stage: 'Classifying',
      message: 'Checking for an embedded text layer.',
      percent: 14
    });

    const classification = await classifyDocument(pdf);
    warnings.push(...classification.warnings);

    let lines;
    if (classification.mode === 'ocr') {
      const ocrWarnings = createOcrMemoryWarnings({
        detectorProfile: ocr?.detectorProfile,
        file,
        pageCount: pdf.numPages
      });
      warnings.push(...ocrWarnings);

      progress({
        stage: 'OCR',
        message: 'Scanned PDF detected; preparing local OCR.',
        percent: 18,
        warnings: [...warnings]
      });

      progress({
        stage: 'Loading model',
        message: 'Loading local OCR model assets.',
        percent: 20
      });
      lines = await runOcrPipeline(pdf, {
        device,
        detectorProfile: ocr?.detectorProfile,
        onProgress: progress,
        warnings
      });
    } else {
      lines = await extractTextLines(pdf, {
        onProgress: ({ current, total }) => {
          progress({
            stage: 'Extracting',
            current,
            total,
            message: `Reading page ${current} of ${total}.`,
            percent: 20 + (current / total) * 68
          });
        },
        warnings
      });
    }

    progress({
      stage: 'Formatting',
      message: 'Applying Markdown heuristics.',
      percent: 92
    });

    const rawMarkdown = linesToMarkdown(lines);
    const markdown = postprocessMarkdown(rawMarkdown);

    self.postMessage({
      type: 'complete',
      taskId,
      markdown,
      mode: classification.mode,
      pages: pdf.numPages,
      file,
      warnings
    });
  } finally {
    if (pdf) {
      await pdf.destroy?.();
    } else {
      await loadingTask.destroy?.();
    }
  }
}

function createOcrMemoryWarnings({ detectorProfile, file, pageCount }) {
  const warnings = [
    'This scanned PDF will be rasterized and OCR processed locally in your browser; large scans can use substantial memory.'
  ];

  if (pageCount > 20) {
    warnings.push(
      `OCR will process ${pageCount} pages in-browser. Splitting very large PDFs can reduce memory pressure.`
    );
  }

  if (file?.size > 25 * 1024 * 1024) {
    warnings.push(
      `The PDF is ${formatBytes(file.size)}; rasterized scan data may require several times that amount while processing.`
    );
  }

  if (detectorProfile === 'accurate') {
    warnings.push(
      'The Accurate OCR detector loads the larger server model only when OCR is needed and may be slower on low-memory devices.'
    );
  }

  return warnings;
}

function normalizeError(error) {
  if (error?.code && error?.message) {
    return {
      code: error.code,
      message: error.message,
      details: error.details || null
    };
  }

  return {
    code: 'WORKER_ERROR',
    message: error instanceof Error ? error.message : 'The worker could not convert this PDF.',
    details: null
  };
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
