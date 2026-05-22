export function setOutput(elements, value) {
  elements.outputArea.value = value;
}

export async function copyOutput(outputArea) {
  const value = outputArea.value;
  if (!value) {
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  outputArea.focus();
  outputArea.select();
  document.execCommand('copy');
}

export function downloadOutput(markdown, filename) {
  if (!markdown) {
    return;
  }

  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
