export function linesToMarkdown(lines) {
  if (!lines.length) {
    return '';
  }

  const sorted = [...lines];
  const bodyFontSize = detectBodyFontSize(sorted);
  const markdownLines = [];
  let previous = null;
  let index = 0;

  while (index < sorted.length) {
    const table = detectTable(sorted, index);
    if (table) {
      if (previous) {
        markdownLines.push('');
      }
      markdownLines.push(...table.markdown, '');
      previous = sorted[index + table.length - 1];
      index += table.length;
      continue;
    }

    const line = sorted[index];
    if (shouldInsertBlankLine(previous, line)) {
      markdownLines.push('');
    }

    markdownLines.push(classifyLine(line, bodyFontSize));
    previous = line;
    index += 1;
  }

  return markdownLines.join('\n').replace(/\n+$/, '');
}

/*
 * Table detection uses whitespace "rivers": a run of lines is a table only
 * where the gaps between their cells overlap vertically. The shared gap bands
 * become column separators, so column alignment is enforced by construction —
 * lines whose gaps don't line up (centered titles, spaced headers) never
 * intersect and fall through to normal paragraph handling.
 */
const MIN_RIVER_WIDTH = 3;

function detectTable(lines, start) {
  const first = lines[start];
  if (!isTableRow(first)) {
    return null;
  }

  let bands = cellGaps(first);
  let end = start + 1;

  // A paragraph-sized vertical gap ends the run: lines far above or below a
  // table often have an incidental word gap that overlaps its river.
  while (
    end < lines.length &&
    isTableRow(lines[end]) &&
    !shouldInsertBlankLine(lines[end - 1], lines[end])
  ) {
    const next = intersectBands(bands, cellGaps(lines[end]));
    if (!next.length) {
      break;
    }
    bands = next;
    end += 1;
  }

  if (end - start < 2) {
    return null;
  }

  const boundaries = bands.map((band) => (band.start + band.end) / 2);
  const rows = lines.slice(start, end).map((line) => splitRow(line.cells, boundaries));

  // ponytail: first row is assumed to be the header, and a cell wrapped onto a
  // second visual line becomes its own row; merge wrapped rows if it matters
  return {
    length: end - start,
    markdown: [
      toPipeRow(rows[0]),
      `| ${Array(boundaries.length + 1).fill('---').join(' | ')} |`,
      ...rows.slice(1).map(toPipeRow)
    ]
  };
}

function isTableRow(line) {
  return (line.cells?.length || 0) >= 2;
}

function cellGaps(line) {
  const gaps = [];
  for (let index = 1; index < line.cells.length; index += 1) {
    gaps.push({ start: line.cells[index - 1].xEnd, end: line.cells[index].x });
  }
  return gaps;
}

function intersectBands(bands, gaps) {
  const merged = [];
  for (const band of bands) {
    // Keep only the widest overlap per band so a band spanning several of the
    // row's gaps narrows to one column separator instead of spawning extras.
    let best = null;
    for (const gap of gaps) {
      const start = Math.max(band.start, gap.start);
      const end = Math.min(band.end, gap.end);
      if (end - start >= MIN_RIVER_WIDTH && (!best || end - start > best.end - best.start)) {
        best = { start, end };
      }
    }
    if (best) {
      merged.push(best);
    }
  }
  return merged;
}

function splitRow(cells, boundaries) {
  // Every boundary sits inside one of this row's own gaps, so cells never
  // straddle a boundary; extra per-row splits just merge back into a column.
  const columns = Array.from({ length: boundaries.length + 1 }, () => []);
  for (const cell of cells) {
    let index = boundaries.findIndex((boundary) => cell.x < boundary);
    if (index === -1) {
      index = boundaries.length;
    }
    columns[index].push(cell.text);
  }
  return columns.map((parts) => parts.join(' '));
}

function toPipeRow(columns) {
  return `| ${columns.map((text) => text.replace(/\|/g, '\\|')).join(' | ')} |`;
}

function detectBodyFontSize(lines) {
  const buckets = new Map();

  for (const line of lines) {
    const rounded = Math.max(1, Math.round(line.fontSize));
    buckets.set(rounded, (buckets.get(rounded) || 0) + 1);
  }

  let bestSize = 12;
  let bestCount = 0;

  for (const [size, count] of buckets.entries()) {
    if (count > bestCount) {
      bestSize = size;
      bestCount = count;
    }
  }

  return bestSize;
}

function classifyLine(line, bodyFontSize) {
  const text = line.text.trim();
  const bulletMatch = text.match(/^[\u2022\u25cf\u25e6\u25aa]\s*(.+)$/);
  const dashBulletMatch = text.match(/^[-\u2013\u2014]\s+(.+)$/);
  const orderedMatch = text.match(/^(\d+)[.)]\s+(.+)$/);

  if (bulletMatch || dashBulletMatch) {
    return `${listIndent(line)}- ${(bulletMatch?.[1] || dashBulletMatch?.[1]).trim()}`;
  }

  if (orderedMatch) {
    return `${listIndent(line)}${orderedMatch[1]}. ${orderedMatch[2].trim()}`;
  }

  /*
   * Header detection is ratio-based so it survives PDFs with different base
   * sizes. The mode font size is treated as body text; progressively larger
   * ratios become Markdown headings while very long lines are kept as
   * paragraphs to avoid promoting oversized callouts or wrapped sentences.
   */
  const ratio = line.fontSize / bodyFontSize;
  const headingCandidate = text.length <= 120 && text.split(/\s+/).length <= 18;

  if (headingCandidate && ratio >= 1.9) {
    return `# ${text}`;
  }

  if (headingCandidate && ratio >= 1.45) {
    return `## ${text}`;
  }

  if (headingCandidate && ratio >= 1.18) {
    return `### ${text}`;
  }

  // Bold-but-body-sized lines are usually headings the ratio check misses.
  if (headingCandidate && line.bold && ratio >= 1) {
    return `### ${text}`;
  }

  return line.mdText || text;
}

function shouldInsertBlankLine(previous, line) {
  if (!previous) {
    return false;
  }

  if (line.pageNum !== previous.pageNum) {
    return true;
  }

  const verticalGap = Math.abs(line.y - previous.y);
  return verticalGap > Math.max(line.fontSize, previous.fontSize) * 2.2;
}

function listIndent(line) {
  const leftMargin = Math.max(0, line.x || 0);
  const level = Math.max(0, Math.min(3, Math.floor(leftMargin / 36) - 1));
  return '  '.repeat(level);
}
