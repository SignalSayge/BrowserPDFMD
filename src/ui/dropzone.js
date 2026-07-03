export function createDropzone({ button, dropzone, input, onFile, onInvalidFile }) {
  button.addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    const [file] = input.files || [];
    input.value = '';
    handleFile(file, onFile, onInvalidFile);
  });

  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });

  for (const eventName of ['dragenter', 'dragover']) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-dragging');
    });
  }

  dropzone.addEventListener('dragleave', (event) => {
    event.preventDefault();
    // Leaving into a child element still counts as inside the dropzone.
    if (event.relatedTarget && dropzone.contains(event.relatedTarget)) {
      return;
    }
    dropzone.classList.remove('is-dragging');
  });

  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
  });

  dropzone.addEventListener('drop', (event) => {
    const [file] = event.dataTransfer?.files || [];
    handleFile(file, onFile, onInvalidFile);
  });
}

function handleFile(file, onFile, onInvalidFile) {
  if (!file) {
    return;
  }

  const isPdf =
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (!isPdf) {
    onInvalidFile('Choose a PDF file.');
    return;
  }

  onFile(file);
}
