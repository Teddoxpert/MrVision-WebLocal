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
  fileList: () => $('file-list') as HTMLUListElement,
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
  preprocessCheck: () => $('preprocess-check') as HTMLInputElement,
  preprocessOption: () => $('preprocess-option') as HTMLElement,
  startBtn: () => $('start-btn') as HTMLButtonElement,

  // Progress
  progressSection: () => $('progress-section') as HTMLElement,
  batchStatus: () => $('batch-status') as HTMLElement,
  progressStep: () => $('progress-step') as HTMLElement,
  progressTime: () => $('progress-time') as HTMLElement,
  progressBar: () => $('progress-bar') as HTMLElement,
  progressPercent: () => $('progress-percent') as HTMLElement,
  pageGrid: () => $('page-grid') as HTMLElement,
  log: () => $('log') as HTMLElement,
  cancelBtn: () => $('cancel-btn') as HTMLButtonElement,

  // Results
  resultsSection: () => $('results-section') as HTMLElement,
  resultList: () => $('result-list') as HTMLElement,
  downloadAllBtn: () => $('download-all-btn') as HTMLButtonElement,
  resetBtn: () => $('reset-btn') as HTMLButtonElement,

  // Offline
  offlineSection: () => $('offline-section') as HTMLElement,
  cacheBtn: () => $('cache-btn') as HTMLButtonElement,
  cacheStatus: () => $('cache-status') as HTMLElement,

  // Theme
  themeToggle: () => $('theme-toggle') as HTMLButtonElement,
};

export function show(el: HTMLElement): void {
  el.classList.remove('hidden');
}

export function hide(el: HTMLElement): void {
  el.classList.add('hidden');
}
