import { orderLinesByLayout } from './layout.js';

export async function extractTextLines(pdf, { onProgress, warnings }) {
  const allLines = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent({ normalizeWhitespace: false });
    const items = mapTextItems(content.items, viewport, pageNum, warnings);
    allLines.push(...groupItemsIntoLines(items, viewport));
    page.cleanup?.();
    onProgress?.({ current: pageNum, total: pdf.numPages });

    if (pageNum % 8 === 0) {
      await yieldToWorker();
    }
  }

  return orderLinesByLayout(allLines, warnings);
}

function mapTextItems(items, viewport, pageNum, warnings) {
  const mapped = [];
  let skippedRotated = 0;

  for (const item of items) {
    const text = typeof item.str === 'string' ? item.str : '';
    if (!text.trim()) {
      continue;
    }

    const transform = item.transform || [];
    const fontSize = Math.abs(transform[3] || item.height || 0);
    if (fontSize < 1) {
      continue;
    }

    if (Math.abs(transform[1] || 0) > 0.01) {
      skippedRotated += 1;
      continue;
    }

    mapped.push({
      text,
      x: transform[4] || 0,
      y: viewport.height - (transform[5] || 0),
      width: item.width || estimateWidth(text, fontSize),
      fontSize,
      pageNum,
      pageWidth: viewport.width,
      pageHeight: viewport.height
    });
  }

  if (skippedRotated) {
    warnings.push(`Skipped ${skippedRotated} rotated text item(s) on page ${pageNum}.`);
  }

  return mapped;
}

function groupItemsIntoLines(items, viewport) {
  const lines = [];
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const item of sorted) {
    const line = findNearestLine(lines, item);
    if (line) {
      line.items.push(item);
      line.y = weightedAverage(line.y, item.y, line.items.length);
      line.fontSize = Math.max(line.fontSize, item.fontSize);
      line.x = Math.min(line.x, item.x);
      line.xMax = Math.max(line.xMax, item.x + item.width);
    } else {
      lines.push({
        items: [item],
        x: item.x,
        xMax: item.x + item.width,
        y: item.y,
        fontSize: item.fontSize,
        pageNum: item.pageNum,
        pageWidth: viewport.width,
        pageHeight: viewport.height
      });
    }
  }

  return lines
    .map((line) => ({
      text: buildLineText(line.items),
      x: line.x,
      xMax: line.xMax,
      y: line.y,
      fontSize: line.fontSize,
      pageNum: line.pageNum,
      pageWidth: line.pageWidth,
      pageHeight: line.pageHeight
    }))
    .filter((line) => line.text);
}

function findNearestLine(lines, item) {
  let bestLine = null;
  let bestDistance = Infinity;

  for (const line of lines) {
    if (line.pageNum !== item.pageNum) {
      continue;
    }

    const threshold = Math.max(line.fontSize, item.fontSize) * 0.5;
    const distance = Math.abs(line.y - item.y);
    if (distance <= threshold && distance < bestDistance) {
      bestLine = line;
      bestDistance = distance;
    }
  }

  return bestLine;
}

function buildLineText(items) {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let output = '';
  let previous = null;

  for (const item of sorted) {
    if (!previous) {
      output = item.text;
      previous = item;
      continue;
    }

    const previousEnd = previous.x + previous.width;
    const gap = item.x - previousEnd;
    const gapThreshold = Math.max(previous.fontSize, item.fontSize) * 0.25;
    const needsSpace =
      gap > gapThreshold && !/\s$/.test(output) && !/^\s/.test(item.text);

    output += needsSpace ? ` ${item.text}` : item.text;
    previous = item;
  }

  return output.replace(/\s+/g, ' ').trim();
}

function estimateWidth(text, fontSize) {
  return text.length * fontSize * 0.48;
}

function weightedAverage(current, next, count) {
  return current + (next - current) / count;
}

async function yieldToWorker() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
