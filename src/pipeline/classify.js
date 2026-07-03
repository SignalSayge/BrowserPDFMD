const MIN_TEXT_CHARS_PER_PAGE = 50;
const MAX_SAMPLE_PAGES = 3;

export async function classifyDocument(pdf) {
  const samplePages = getSamplePages(pdf.numPages);
  const warnings = [];
  let totalChars = 0;

  for (const pageNum of samplePages) {
    try {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const chars = content.items.reduce((sum, item) => {
        return sum + (typeof item.str === 'string' ? item.str.trim().length : 0);
      }, 0);
      totalChars += chars;
      page.cleanup?.();
    } catch (error) {
      warnings.push(`Could not inspect page ${pageNum}: ${readErrorMessage(error)}`);
    }
  }

  const averageChars = samplePages.length ? totalChars / samplePages.length : 0;

  return {
    mode: averageChars < MIN_TEXT_CHARS_PER_PAGE ? 'ocr' : 'text',
    averageChars,
    sampledPages: samplePages,
    warnings
  };
}

function getSamplePages(pageCount) {
  if (pageCount <= MAX_SAMPLE_PAGES) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  return Array.from(new Set([1, Math.ceil(pageCount / 2), pageCount]));
}

function readErrorMessage(error) {
  return error instanceof Error ? error.message : 'Unknown PDF.js error';
}
