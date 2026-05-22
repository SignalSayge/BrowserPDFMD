import { loadOcrModels } from '../models/loader.js';
import { orderLinesByLayout } from './layout.js';

const RENDER_SCALE = 2;
const DETECTION_MIN_BOX_SIZE = 4;
const DETECTION_MIN_COMPONENT_AREA = 9;
const DETECTION_BOX_PADDING_RATIO = 0.08;
const DETECTION_MAX_BOXES = 500;
const DETECTION_ORIENTATION_EPSILON = 1e-6;
const RECOGNITION_MIN_TEXT_LENGTH = 1;
const RECOGNITION_MIN_SCORE = -Infinity;

export async function runOcrPipeline(pdf, {
  detectorProfile,
  device,
  onProgress,
  warnings = []
}) {
  const models = await loadOcrModels(device, { detectorProfile, onProgress });
  const allLines = [];

  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      onProgress?.({
        stage: 'OCR',
        current: pageNum,
        total: pdf.numPages,
        message: `Preparing page ${pageNum} for local OCR inference.`,
        percent: 25 + (pageNum / pdf.numPages) * 60
      });

      const page = await pdf.getPage(pageNum);
      let pageImage;

      try {
        pageImage = await rasterizePage(page);
        const boxes = await detectTextBoxes(models, pageImage);
        if (!boxes.length) {
          warnings.push(`No OCR text boxes detected on page ${pageNum}.`);
          continue;
        }

        const recognized = await recognizeBoxes(models, pageImage, boxes, {
          onProgress: (current, total) => {
            onProgress?.({
              stage: 'OCR',
              current: pageNum,
              total: pdf.numPages,
              message: `Recognizing page ${pageNum}: ${current}/${total} text region(s).`,
              percent: 25 + ((pageNum - 1 + current / total) / pdf.numPages) * 60
            });
          }
        });

        allLines.push(
          ...groupRecognizedBoxesIntoLines(recognized, {
            pageNum,
            pageHeight: pageImage.height / pageImage.scale,
            pageWidth: pageImage.width / pageImage.scale,
            scale: pageImage.scale
          })
        );
      } finally {
        page.cleanup?.();
        pageImage?.dispose();
      }
    }
  } finally {
    await models.detector?.release?.();
    await models.recognizer?.release?.();
  }

  return orderLinesByLayout(allLines, warnings);
}

async function rasterizePage(page) {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = new OffscreenCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height)
  );
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: context,
    viewport
  }).promise;

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return {
    canvas,
    context,
    height: canvas.height,
    imageData,
    scale: RENDER_SCALE,
    width: canvas.width,
    dispose() {
      this.imageData = null;
      this.context = null;
      this.canvas.width = 1;
      this.canvas.height = 1;
      this.canvas = null;
    }
  };
}

async function detectTextBoxes(models, pageImage) {
  const detectorConfig = models.manifest.detectors[models.detectorProfile.key];
  const input = preprocessDetectorImage(models.ort, pageImage, detectorConfig);
  const inputName = detectorConfig.input.name;
  const outputName = detectorConfig.outputs[0].name;

  let outputTensor;
  try {
    const output = await models.detector.run({ [inputName]: input.tensor });
    outputTensor = output[outputName] || Object.values(output)[0];
    return decodeDetectionMap(
      outputTensor,
      input.originalWidth,
      input.originalHeight,
      detectorConfig.postprocess
    );
  } finally {
    input.tensor.dispose?.();
    outputTensor?.dispose?.();
  }
}

function preprocessDetectorImage(ort, pageImage, config) {
  const { resizedHeight, resizedWidth } = calculateDetectorSize(
    pageImage.width,
    pageImage.height,
    config.input.resize.resizeLong
  );
  const resized = resizeImageData(pageImage.canvas, resizedWidth, resizedHeight);
  const data = resized.data;
  const planeSize = resizedWidth * resizedHeight;
  const input = new Float32Array(3 * planeSize);
  const mean = config.input.normalization.mean;
  const std = config.input.normalization.std;

  for (let index = 0; index < planeSize; index += 1) {
    const src = index * 4;
    // PaddleOCR's inference metadata decodes images as BGR. Canvas provides RGB.
    input[index] = data[src + 2] / 255 / std[0] - mean[0] / std[0];
    input[planeSize + index] = data[src + 1] / 255 / std[1] - mean[1] / std[1];
    input[planeSize * 2 + index] = data[src] / 255 / std[2] - mean[2] / std[2];
  }

  return {
    originalHeight: pageImage.height,
    originalWidth: pageImage.width,
    tensor: new ort.Tensor('float32', input, [1, 3, resizedHeight, resizedWidth])
  };
}

function calculateDetectorSize(width, height, resizeLong) {
  const ratio = resizeLong / Math.max(width, height);
  const rawWidth = Math.max(1, Math.floor(width * ratio));
  const rawHeight = Math.max(1, Math.floor(height * ratio));

  return {
    resizedHeight: Math.max(128, Math.ceil(rawHeight / 128) * 128),
    resizedWidth: Math.max(128, Math.ceil(rawWidth / 128) * 128)
  };
}

function decodeDetectionMap(tensor, originalWidth, originalHeight, postprocess) {
  const [, , mapHeight, mapWidth] = tensor.dims;
  const probabilities = tensor.data;
  const threshold = postprocess.threshold;
  const visited = new Uint8Array(mapWidth * mapHeight);
  const boxes = [];
  const xScale = originalWidth / mapWidth;
  const yScale = originalHeight / mapHeight;

  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) {
      const offset = y * mapWidth + x;
      if (visited[offset] || probabilities[offset] <= threshold) {
        continue;
      }

      const component = collectComponent(
        probabilities,
        visited,
        mapWidth,
        mapHeight,
        x,
        y,
        threshold
      );

      if (
        component.area < DETECTION_MIN_COMPONENT_AREA ||
        component.score < postprocess.boxThreshold
      ) {
        continue;
      }

      const box = createOrientedBoxFromComponent(
        component,
        xScale,
        yScale,
        originalWidth,
        originalHeight
      );

      if (
        box.xMax - box.x < DETECTION_MIN_BOX_SIZE ||
        box.yMax - box.y < DETECTION_MIN_BOX_SIZE
      ) {
        continue;
      }

      boxes.push({
        ...box,
        score: component.score
      });
    }
  }

  return mergeOverlappingBoxes(boxes)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, Math.min(postprocess.maxCandidates, DETECTION_MAX_BOXES));
}

function collectComponent(probabilities, visited, width, height, startX, startY, threshold) {
  const queueX = [startX];
  const queueY = [startY];
  let head = 0;
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;
  let area = 0;
  let scoreSum = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;

  visited[startY * width + startX] = 1;

  while (head < queueX.length) {
    const x = queueX[head];
    const y = queueY[head];
    head += 1;

    const offset = y * width + x;
    const pointX = x + 0.5;
    const pointY = y + 0.5;
    area += 1;
    scoreSum += probabilities[offset];
    sumX += pointX;
    sumY += pointY;
    sumXX += pointX * pointX;
    sumYY += pointY * pointY;
    sumXY += pointX * pointY;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }

        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue;
        }

        const neighborOffset = ny * width + nx;
        if (visited[neighborOffset] || probabilities[neighborOffset] <= threshold) {
          continue;
        }

        visited[neighborOffset] = 1;
        queueX.push(nx);
        queueY.push(ny);
      }
    }
  }

  return {
    area,
    pointsX: queueX,
    pointsY: queueY,
    maxX,
    maxY,
    minX,
    minY,
    score: scoreSum / area,
    sumX,
    sumXX,
    sumXY,
    sumY,
    sumYY
  };
}

export function createOrientedBoxFromComponent(
  component,
  xScale,
  yScale,
  imageWidth,
  imageHeight
) {
  const fallback = expandAxisAlignedBox(
    {
      x: component.minX * xScale,
      y: component.minY * yScale,
      xMax: (component.maxX + 1) * xScale,
      yMax: (component.maxY + 1) * yScale
    },
    imageWidth,
    imageHeight
  );

  if (component.area < 2) {
    return {
      ...fallback,
      score: component.score
    };
  }

  const meanX = component.sumX / component.area;
  const meanY = component.sumY / component.area;
  const varianceX = component.sumXX / component.area - meanX * meanX;
  const varianceY = component.sumYY / component.area - meanY * meanY;
  const covariance = component.sumXY / component.area - meanX * meanY;

  if (
    Math.abs(varianceX) < DETECTION_ORIENTATION_EPSILON &&
    Math.abs(varianceY) < DETECTION_ORIENTATION_EPSILON
  ) {
    return {
      ...fallback,
      score: component.score
    };
  }

  let angle = 0.5 * Math.atan2(2 * covariance, varianceX - varianceY);
  let axisX = Math.cos(angle);
  let axisY = Math.sin(angle);

  if (axisX < 0) {
    axisX *= -1;
    axisY *= -1;
    angle += Math.PI;
  }

  let crossX = -axisY;
  let crossY = axisX;
  let minAlongAxis = Infinity;
  let maxAlongAxis = -Infinity;
  let minAcrossAxis = Infinity;
  let maxAcrossAxis = -Infinity;

  for (let index = 0; index < component.pointsX.length; index += 1) {
    const pointX = component.pointsX[index] + 0.5;
    const pointY = component.pointsY[index] + 0.5;
    const dx = pointX - meanX;
    const dy = pointY - meanY;
    const along = dx * axisX + dy * axisY;
    const across = dx * crossX + dy * crossY;
    minAlongAxis = Math.min(minAlongAxis, along);
    maxAlongAxis = Math.max(maxAlongAxis, along);
    minAcrossAxis = Math.min(minAcrossAxis, across);
    maxAcrossAxis = Math.max(maxAcrossAxis, across);
  }

  if (!Number.isFinite(minAlongAxis) || !Number.isFinite(minAcrossAxis)) {
    return {
      ...fallback,
      score: component.score
    };
  }

  const width = maxAlongAxis - minAlongAxis;
  const height = maxAcrossAxis - minAcrossAxis;
  const padding = Math.max(
    1,
    Math.max(width * xScale, height * yScale) * DETECTION_BOX_PADDING_RATIO
  );
  const mapPaddingX = padding / xScale;
  const mapPaddingY = padding / yScale;
  const paddedAlongMin = minAlongAxis - mapPaddingX;
  const paddedAlongMax = maxAlongAxis + mapPaddingX;
  const paddedAcrossMin = minAcrossAxis - mapPaddingY;
  const paddedAcrossMax = maxAcrossAxis + mapPaddingY;

  const quad = [
    pointFromLocal(meanX, meanY, axisX, axisY, crossX, crossY, paddedAlongMin, paddedAcrossMin, xScale, yScale),
    pointFromLocal(meanX, meanY, axisX, axisY, crossX, crossY, paddedAlongMax, paddedAcrossMin, xScale, yScale),
    pointFromLocal(meanX, meanY, axisX, axisY, crossX, crossY, paddedAlongMax, paddedAcrossMax, xScale, yScale),
    pointFromLocal(meanX, meanY, axisX, axisY, crossX, crossY, paddedAlongMin, paddedAcrossMax, xScale, yScale)
  ].map((point) => ({
    x: clamp(point.x, 0, imageWidth),
    y: clamp(point.y, 0, imageHeight)
  }));

  const bounds = boundsForQuad(quad);
  if (
    bounds.xMax - bounds.x < DETECTION_MIN_BOX_SIZE ||
    bounds.yMax - bounds.y < DETECTION_MIN_BOX_SIZE
  ) {
    return {
      ...fallback,
      score: component.score
    };
  }

  return {
    ...bounds,
    angle,
    orientedHeight: Math.max(height * yScale, DETECTION_MIN_BOX_SIZE),
    orientedWidth: Math.max(width * xScale, DETECTION_MIN_BOX_SIZE),
    quad,
    score: component.score
  };
}

function expandAxisAlignedBox(box, imageWidth, imageHeight) {
  const width = box.xMax - box.x;
  const height = box.yMax - box.y;
  const padding = Math.max(2, Math.max(width, height) * DETECTION_BOX_PADDING_RATIO);

  return {
    x: clamp(box.x - padding, 0, imageWidth - 1),
    y: clamp(box.y - padding, 0, imageHeight - 1),
    xMax: clamp(box.xMax + padding, 1, imageWidth),
    yMax: clamp(box.yMax + padding, 1, imageHeight)
  };
}

function pointFromLocal(
  meanX,
  meanY,
  axisX,
  axisY,
  crossX,
  crossY,
  along,
  across,
  xScale,
  yScale
) {
  return {
    x: (meanX + along * axisX + across * crossX) * xScale,
    y: (meanY + along * axisY + across * crossY) * yScale
  };
}

function boundsForQuad(quad) {
  return {
    x: Math.min(...quad.map((point) => point.x)),
    xMax: Math.max(...quad.map((point) => point.x)),
    y: Math.min(...quad.map((point) => point.y)),
    yMax: Math.max(...quad.map((point) => point.y))
  };
}

function mergeOverlappingBoxes(boxes) {
  const merged = [];
  for (const box of boxes.sort((a, b) => areaOfBox(b) - areaOfBox(a))) {
    const existing = merged.find((candidate) => boxOverlapRatio(candidate, box) > 0.7);
    if (!existing) {
      merged.push(box);
    }
  }

  return merged;
}

async function recognizeBoxes(models, pageImage, boxes, { onProgress }) {
  const recognized = [];
  const recognizerConfig = models.manifest.recognizer;
  const inputName = recognizerConfig.input.name;
  const outputName = recognizerConfig.outputs[0].name;

  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    const input = preprocessRecognitionCrop(models.ort, pageImage.canvas, box);
    let outputTensor;

    try {
      const output = await models.recognizer.run({ [inputName]: input });
      outputTensor = output[outputName] || Object.values(output)[0];
      const result = decodeRecognitionOutput(outputTensor, models.dictionary);
      if (
        result.text.length >= RECOGNITION_MIN_TEXT_LENGTH &&
        result.score >= RECOGNITION_MIN_SCORE
      ) {
        recognized.push({
          ...box,
          score: result.score,
          text: result.text
        });
      }
    } finally {
      input.dispose?.();
      outputTensor?.dispose?.();
    }

    onProgress?.(index + 1, boxes.length);
    if ((index + 1) % 12 === 0) {
      await yieldToWorker();
    }
  }

  return recognized;
}

function preprocessRecognitionCrop(ort, sourceCanvas, box) {
  const cropGeometry = getRecognitionCropGeometry(box);
  const cropWidth = cropGeometry.width;
  const cropHeight = cropGeometry.height;
  const targetHeight = 48;
  const targetWidth = Math.min(
    3200,
    Math.max(320, Math.ceil((cropWidth / cropHeight) * targetHeight))
  );
  const resizedWidth = Math.min(
    targetWidth,
    Math.ceil((cropWidth / cropHeight) * targetHeight)
  );
  const cropCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  const cropContext = cropCanvas.getContext('2d', { willReadFrequently: true });
  cropContext.fillStyle = '#fff';
  cropContext.fillRect(0, 0, targetWidth, targetHeight);

  if (cropGeometry.quad) {
    drawOrientedCrop(
      cropContext,
      sourceCanvas,
      cropGeometry.quad,
      resizedWidth,
      targetHeight
    );
  } else {
    cropContext.drawImage(
      sourceCanvas,
      box.x,
      box.y,
      cropWidth,
      cropHeight,
      0,
      0,
      resizedWidth,
      targetHeight
    );
  }

  const imageData = cropContext.getImageData(0, 0, targetWidth, targetHeight);
  const planeSize = targetWidth * targetHeight;
  const input = new Float32Array(3 * planeSize);

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < resizedWidth; x += 1) {
      const index = y * targetWidth + x;
      const src = index * 4;
      input[index] = imageData.data[src + 2] / 255 / 0.5 - 1;
      input[planeSize + index] = imageData.data[src + 1] / 255 / 0.5 - 1;
      input[planeSize * 2 + index] = imageData.data[src] / 255 / 0.5 - 1;
    }
  }

  cropCanvas.width = 1;
  cropCanvas.height = 1;

  return new ort.Tensor('float32', input, [1, 3, targetHeight, targetWidth]);
}

function getRecognitionCropGeometry(box) {
  if (box.quad?.length === 4) {
    const width = Math.max(
      distance(box.quad[0], box.quad[1]),
      distance(box.quad[3], box.quad[2]),
      1
    );
    const height = Math.max(
      distance(box.quad[0], box.quad[3]),
      distance(box.quad[1], box.quad[2]),
      1
    );

    return {
      height,
      quad: box.quad,
      width
    };
  }

  return {
    height: Math.max(1, Math.round(box.yMax - box.y)),
    quad: null,
    width: Math.max(1, Math.round(box.xMax - box.x))
  };
}

function drawOrientedCrop(context, sourceCanvas, quad, width, height) {
  const [topLeft, topRight, , bottomLeft] = quad;
  const basisX = {
    x: topRight.x - topLeft.x,
    y: topRight.y - topLeft.y
  };
  const basisY = {
    x: bottomLeft.x - topLeft.x,
    y: bottomLeft.y - topLeft.y
  };
  const determinant = basisX.x * basisY.y - basisX.y * basisY.x;

  if (Math.abs(determinant) < DETECTION_ORIENTATION_EPSILON) {
    return;
  }

  const inverse00 = basisY.y / determinant;
  const inverse01 = -basisY.x / determinant;
  const inverse10 = -basisX.y / determinant;
  const inverse11 = basisX.x / determinant;
  const a = inverse00 * width;
  const b = inverse10 * height;
  const c = inverse01 * width;
  const d = inverse11 * height;
  const e = -(a * topLeft.x + c * topLeft.y);
  const f = -(b * topLeft.x + d * topLeft.y);

  context.save();
  context.beginPath();
  context.rect(0, 0, width, height);
  context.clip();
  context.setTransform(a, b, c, d, e, f);
  context.drawImage(sourceCanvas, 0, 0);
  context.restore();
}

function decodeRecognitionOutput(tensor, dictionary) {
  const dims = tensor.dims;
  const timeSteps = dims[dims.length - 2];
  const classCount = dims[dims.length - 1];
  const data = tensor.data;
  let previousIndex = -1;
  let confidenceSum = 0;
  let confidenceCount = 0;
  let text = '';

  for (let step = 0; step < timeSteps; step += 1) {
    const base = step * classCount;
    let bestIndex = 0;
    let bestScore = data[base];

    for (let classIndex = 1; classIndex < classCount; classIndex += 1) {
      const score = data[base + classIndex];
      if (score > bestScore) {
        bestScore = score;
        bestIndex = classIndex;
      }
    }

    if (bestIndex === 0 || bestIndex === previousIndex) {
      previousIndex = bestIndex;
      continue;
    }

    text += decodeCharacter(bestIndex, dictionary);
    confidenceSum += bestScore;
    confidenceCount += 1;
    previousIndex = bestIndex;
  }

  return {
    score: confidenceCount ? confidenceSum / confidenceCount : 0,
    text: text.trim()
  };
}

function decodeCharacter(classIndex, dictionary) {
  if (classIndex === dictionary.length + 1) {
    return ' ';
  }

  return dictionary[classIndex - 1] || '';
}

function groupRecognizedBoxesIntoLines(boxes, { pageHeight, pageNum, pageWidth, scale }) {
  const lineGroups = [];

  for (const box of boxes.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const group = findLineGroup(lineGroups, box);
    if (group) {
      group.boxes.push(box);
      group.x = Math.min(group.x, box.x);
      group.xMax = Math.max(group.xMax, box.xMax);
      group.y = Math.min(group.y, box.y);
      group.yMax = Math.max(group.yMax, box.yMax);
    } else {
      lineGroups.push({
        boxes: [box],
        x: box.x,
        xMax: box.xMax,
        y: box.y,
        yMax: box.yMax
      });
    }
  }

  return lineGroups
    .map((group) => {
      const sortedBoxes = [...group.boxes].sort((a, b) => a.x - b.x);
      const text = sortedBoxes.map((box) => box.text).join(' ').replace(/\s+/g, ' ').trim();
      return {
        fontSize: Math.max(8, (group.yMax - group.y) / scale),
        pageHeight,
        pageNum,
        pageWidth,
        text,
        x: group.x / scale,
        xMax: group.xMax / scale,
        y: group.y / scale
      };
    })
    .filter((line) => line.text);
}

function findLineGroup(groups, box) {
  const centerY = (box.y + box.yMax) / 2;
  const height = box.yMax - box.y;

  return groups.find((group) => {
    const groupCenterY = (group.y + group.yMax) / 2;
    const groupHeight = group.yMax - group.y;
    const overlap = Math.min(group.yMax, box.yMax) - Math.max(group.y, box.y);
    return (
      Math.abs(centerY - groupCenterY) <= Math.max(height, groupHeight) * 0.55 ||
      overlap > Math.min(height, groupHeight) * 0.45
    );
  });
}

function resizeImageData(sourceCanvas, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(sourceCanvas, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  canvas.width = 1;
  canvas.height = 1;
  return imageData;
}

function areaOfBox(box) {
  return Math.max(0, box.xMax - box.x) * Math.max(0, box.yMax - box.y);
}

function boxOverlapRatio(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const xMax = Math.min(a.xMax, b.xMax);
  const yMax = Math.min(a.yMax, b.yMax);
  const overlap = Math.max(0, xMax - x) * Math.max(0, yMax - y);
  return overlap / Math.max(1, Math.min(areaOfBox(a), areaOfBox(b)));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function yieldToWorker() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createWorkerError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
