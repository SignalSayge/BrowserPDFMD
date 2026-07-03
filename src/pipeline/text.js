import { orderLinesByLayout } from './layout.js';

export async function extractTextLines(pdf, { onProgress, warnings }) {
  const allLines = [];
  const fontFlagsCache = new Map();

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    // Font objects only reach commonObjs when the page is parsed for
    // rendering; getOperatorList does that parse without a canvas so
    // resolveFontFlags can read real font names (bold/italic detection).
    await page.getOperatorList();
    const content = await page.getTextContent();
    const getFontFlags = (fontName) => resolveFontFlags(page, fontName, fontFlagsCache);
    const items = mapTextItems(content.items, viewport, pageNum, warnings, getFontFlags);
    allLines.push(...groupItemsIntoLines(items, viewport));
    page.cleanup?.();
    onProgress?.({ current: pageNum, total: pdf.numPages });

    if (pageNum % 8 === 0) {
      await yieldToWorker();
    }
  }

  return orderLinesByLayout(allLines, warnings);
}

function resolveFontFlags(page, fontName, cache) {
  if (!cache.has(fontName)) {
    let name = '';
    try {
      name = page.commonObjs.get(fontName)?.name || '';
    } catch {
      // Font not resolved on this thread; treat as regular weight/style.
    }
    cache.set(fontName, {
      bold: /bold|black|heavy|semibold/i.test(name),
      italic: /italic|oblique/i.test(name)
    });
  }
  return cache.get(fontName);
}

function mapTextItems(items, viewport, pageNum, warnings, getFontFlags) {
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

    const flags = getFontFlags(item.fontName);
    mapped.push({
      text,
      bold: flags.bold,
      italic: flags.italic,
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
    .map((line) => {
      const { text, mdText } = buildLineTexts(line.items);
      return {
        text,
        mdText,
        cells: buildCells(line.items),
        bold: line.items.every((item) => item.bold),
        x: line.x,
        xMax: line.xMax,
        y: line.y,
        fontSize: line.fontSize,
        pageNum: line.pageNum,
        pageWidth: line.pageWidth,
        pageHeight: line.pageHeight
      };
    })
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

export function buildLineTexts(items) {
  const runs = buildStyleRuns(items);
  const collapse = (value) => value.replace(/\s+/g, ' ');

  const text = runs
    .map((run) => run.sep + collapse(run.text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  const mdText = runs
    .map((run) => {
      const marker = run.bold && run.italic ? '***' : run.bold ? '**' : run.italic ? '*' : '';
      const body = collapse(run.text).trim();
      const wrapped = marker && body ? `${marker}${body}${marker}` : body;
      // Whitespace must sit outside emphasis markers or Markdown ignores them.
      const leading = /^\s/.test(run.text) ? ' ' : '';
      const trailing = /\s$/.test(run.text) ? ' ' : '';
      return run.sep + leading + wrapped + trailing;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  return { text, mdText };
}

function buildStyleRuns(items) {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const runs = [];
  let previous = null;

  for (const item of sorted) {
    let sep = '';
    if (previous) {
      const gap = item.x - (previous.x + previous.width);
      const gapThreshold = Math.max(previous.fontSize, item.fontSize) * 0.25;
      if (gap > gapThreshold && !/\s$/.test(previous.text) && !/^\s/.test(item.text)) {
        sep = ' ';
      }
    }

    const run = runs[runs.length - 1];
    if (run && run.bold === !!item.bold && run.italic === !!item.italic) {
      run.text += sep + item.text;
    } else {
      runs.push({ sep, text: item.text, bold: !!item.bold, italic: !!item.italic });
    }
    previous = item;
  }

  return runs;
}

function buildCells(items) {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const cells = [];
  let previous = null;

  for (const item of sorted) {
    // Generous split threshold: false splits are cheap because table detection
    // only keeps column boundaries whose whitespace is shared by every row.
    const gap = previous ? item.x - (previous.x + previous.width) : 0;
    if (!previous || gap > Math.max(previous.fontSize, item.fontSize) * 1.25) {
      cells.push({ x: item.x, items: [item] });
    } else {
      cells[cells.length - 1].items.push(item);
    }
    previous = item;
  }

  return cells.map((cell) => {
    const last = cell.items[cell.items.length - 1];
    return {
      x: cell.x,
      xEnd: last.x + last.width,
      text: buildLineTexts(cell.items).text
    };
  });
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
