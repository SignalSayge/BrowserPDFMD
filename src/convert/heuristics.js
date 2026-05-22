export function linesToMarkdown(lines) {
  if (!lines.length) {
    return '';
  }

  const sorted = [...lines];
  const bodyFontSize = detectBodyFontSize(sorted);
  const markdownLines = [];
  let previous = null;

  for (const line of sorted) {
    if (shouldInsertBlankLine(previous, line)) {
      markdownLines.push('');
    }

    markdownLines.push(classifyLine(line, bodyFontSize));
    previous = line;
  }

  return markdownLines.join('\n');
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

  return text;
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
