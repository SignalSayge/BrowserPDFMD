export function setDeviceBadge(elements, device) {
  elements.deviceBadge.dataset.device = device.type;
  elements.deviceBadge.classList.remove('is-detecting');
  elements.deviceLabel.textContent = device.label;
  elements.deviceBadge.title = device.detail || device.label;
}

export function renderFileMeta(elements, file) {
  elements.fileMeta.hidden = false;
  elements.fileMeta.replaceChildren();

  const name = document.createElement('strong');
  name.textContent = file.name;

  const size = document.createElement('span');
  size.textContent = formatBytes(file.size);

  elements.fileMeta.append(name, size);
}

export function renderProgress(elements, progress) {
  const percent = clampPercent(progress.percent ?? derivePercent(progress));
  elements.progressPanel.hidden = false;
  elements.progressStage.textContent = progress.stage || 'Processing';
  elements.progressCount.textContent =
    progress.current && progress.total ? `${progress.current}/${progress.total}` : '';
  elements.progressMessage.textContent = progress.message || '';
  elements.progressBar.style.width = `${percent}%`;
  elements.progressTrack.setAttribute('aria-valuenow', String(Math.round(percent)));
}

export function hideProgress(elements) {
  elements.progressPanel.hidden = true;
}

export function resetError(elements) {
  elements.errorPanel.hidden = true;
  elements.errorTitle.textContent = '';
  elements.errorMessage.textContent = '';
}

export function renderError(elements, { title, message }) {
  elements.errorPanel.hidden = false;
  elements.errorTitle.textContent = title || 'Conversion failed';
  elements.errorMessage.textContent = message || 'The PDF could not be converted.';
}

export function renderWarnings(elements, warnings) {
  elements.warningList.replaceChildren();

  if (!warnings.length) {
    elements.warningList.hidden = true;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const warning of warnings) {
    const item = document.createElement('li');
    item.textContent = warning;
    fragment.append(item);
  }

  elements.warningList.append(fragment);
  elements.warningList.hidden = false;
}

function derivePercent(progress) {
  if (!progress.current || !progress.total) {
    return 10;
  }

  return (progress.current / progress.total) * 100;
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
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
