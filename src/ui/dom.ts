function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}

export const dom = {
  // Drop zone
  dropZone: () => $('drop-zone') as HTMLElement,
  fileInput: () => $('file-input') as HTMLInputElement,
  fileInfo: () => $('file-info') as HTMLElement,
  fileName: () => $('file-name') as HTMLElement,
  fileSize: () => $('file-size') as HTMLElement,
  clearFile: () => $('clear-file') as HTMLButtonElement,

  // Options
  optionsPanel: () => $('options-panel') as HTMLElement,
  hwStatus: () => $('hw-status') as HTMLElement,
  engineSelect: () => $('engine-select') as HTMLSelectElement,
  langSelect: () => $('lang-select') as HTMLSelectElement,
  dpiSelect: () => $('dpi-select') as HTMLSelectElement,
  dpiOption: () => $('dpi-option') as HTMLElement,
  downsampleCheck: () => $('downsample-check') as HTMLInputElement,
  downsampleOption: () => $('downsample-option') as HTMLElement,
  startBtn: () => $('start-btn') as HTMLButtonElement,

  // Progress
  progressSection: () => $('progress-section') as HTMLElement,
  progressStep: () => $('progress-step') as HTMLElement,
  progressTime: () => $('progress-time') as HTMLElement,
  progressBar: () => $('progress-bar') as HTMLElement,
  progressPercent: () => $('progress-percent') as HTMLElement,
  pageGrid: () => $('page-grid') as HTMLElement,
  log: () => $('log') as HTMLElement,
  cancelBtn: () => $('cancel-btn') as HTMLButtonElement,

  // Results
  resultsSection: () => $('results-section') as HTMLElement,
  imageResult: () => $('image-result') as HTMLElement,
  pdfResult: () => $('pdf-result') as HTMLElement,
  ocrText: () => $('ocr-text') as HTMLElement,
  copyBtn: () => $('copy-btn') as HTMLButtonElement,
  resultPages: () => $('result-pages') as HTMLElement,
  resultTime: () => $('result-time') as HTMLElement,
  resultConfidence: () => $('result-confidence') as HTMLElement,
  resultSize: () => $('result-size') as HTMLElement,
  downloadBtn: () => $('download-btn') as HTMLButtonElement,
  resetBtn: () => $('reset-btn') as HTMLButtonElement,

  // Theme
  themeToggle: () => $('theme-toggle') as HTMLButtonElement,
};

export function show(el: HTMLElement): void {
  el.classList.remove('hidden');
}

export function hide(el: HTMLElement): void {
  el.classList.add('hidden');
}
