export function postprocessMarkdown(markdown) {
  const lines = markdown
    .replace(/\r\n?/g, '\n')
    .replace(/([A-Za-z]{2,})-\n([a-z]{2,})/g, '$1$2')
    .split('\n')
    .map((line) => line.trimEnd());

  return removeIsolatedPageNumbers(lines)
    .filter(keepLine)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function removeIsolatedPageNumbers(lines) {
  return lines.filter((line, index) => {
    const trimmed = line.trim();
    const previousBlank = index === 0 || !lines[index - 1].trim();
    const nextBlank = index === lines.length - 1 || !lines[index + 1].trim();
    return !(/^\d{1,4}$/.test(trimmed) && previousBlank && nextBlank);
  });
}

function keepLine(line) {
  const trimmed = line.trim();

  if (!trimmed) {
    return true;
  }

  if (/^\s*(-|\d+\.)\s+/.test(line)) {
    return true;
  }

  if (/^#{1,6}\s+/.test(line)) {
    return trimmed.length > 3;
  }

  return trimmed.length >= 3;
}
