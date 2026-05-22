const MIN_COLUMN_LINES = 5;
const MIN_COLUMN_GAP_RATIO = 0.18;

export function orderLinesByLayout(lines, warnings = []) {
  const pages = new Map();

  for (const line of lines) {
    const pageLines = pages.get(line.pageNum) || [];
    pageLines.push(line);
    pages.set(line.pageNum, pageLines);
  }

  const ordered = [];

  for (const [pageNum, pageLines] of [...pages.entries()].sort(([a], [b]) => a - b)) {
    const columns = detectColumns(pageLines);

    if (columns.length > 1) {
      warnings.push(
        `Detected a ${columns.length}-column text layout on page ${pageNum}; reading order is heuristic.`
      );
    }

    for (const column of columns) {
      ordered.push(...column.sort(compareTopToBottom));
    }
  }

  return ordered;
}

function detectColumns(lines) {
  if (lines.length < MIN_COLUMN_LINES * 2) {
    return [lines.sort(compareTopToBottom)];
  }

  const pageWidth = Math.max(...lines.map((line) => line.pageWidth || 0));
  const candidates = [...lines]
    .filter((line) => line.xMax - line.x > 20)
    .sort((a, b) => a.x - b.x);

  if (candidates.length < MIN_COLUMN_LINES * 2 || !pageWidth) {
    return [lines.sort(compareTopToBottom)];
  }

  const split = findBestColumnSplit(candidates, pageWidth);
  if (!split) {
    return [lines.sort(compareTopToBottom)];
  }

  const left = [];
  const right = [];
  const boundary = (split.before.x + split.after.x) / 2;

  for (const line of lines) {
    if (line.x < boundary) {
      left.push(line);
    } else {
      right.push(line);
    }
  }

  if (left.length < MIN_COLUMN_LINES || right.length < MIN_COLUMN_LINES) {
    return [lines.sort(compareTopToBottom)];
  }

  return [left, right];
}

function findBestColumnSplit(lines, pageWidth) {
  let best = null;

  for (let index = MIN_COLUMN_LINES; index < lines.length - MIN_COLUMN_LINES; index += 1) {
    const before = lines[index - 1];
    const after = lines[index];
    const gap = after.x - before.xMax;

    if (gap <= pageWidth * MIN_COLUMN_GAP_RATIO) {
      continue;
    }

    if (!best || gap > best.gap) {
      best = { before, after, gap };
    }
  }

  return best;
}

function compareTopToBottom(a, b) {
  return a.y - b.y || a.x - b.x;
}
