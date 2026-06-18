import { dom, show, hide } from './ui/dom.js';
import { initProgress, stopTimer, createProgressCallback } from './ui/progress.js';
import { getOptions, showPdfOptions, initHardwareStatus } from './ui/options.js';
import { initTheme, toggleTheme } from './ui/theme.js';
import { isImageFile, isPdfFile, formatFileSize, downloadBlob, readFileAsArrayBuffer } from './utils/file.js';
import { formatElapsed } from './utils/time.js';
import { ocrImage } from './core/image-ocr.js';
import { ocrPdf, cancelPipeline } from './core/pdf-ocr.js';
import { isCacheApiAvailable, getCacheStatus, prefetchAssets } from './core/offline-cache.js';
import type { PdfOcrResult } from './core/pdf-ocr.js';

interface PdfDownload {
  name: string;
  bytes: Uint8Array;
}

let selectedFiles: File[] = [];
let pdfDownloads: PdfDownload[] = [];
// Set when the user cancels: stops the batch loop from starting the next file.
let batchCancelled = false;

function resetUI(): void {
  selectedFiles = [];
  pdfDownloads = [];
  batchCancelled = false;

  hide(dom.fileInfo());
  hide(dom.optionsPanel());
  hide(dom.progressSection());
  hide(dom.resultsSection());
  hide(dom.batchStatus());
  hide(dom.downloadAllBtn());
  dom.fileList().innerHTML = '';
  dom.resultList().innerHTML = '';

  dom.dropZone().querySelector('.drop-zone-content')!.classList.remove('hidden');
  dom.startBtn().disabled = false;
  stopTimer();
  document.title = 'MrVision';
}

function onFilesSelected(files: File[]): void {
  const accepted = files.filter((f) => isImageFile(f) || isPdfFile(f));
  const skipped = files.length - accepted.length;

  if (accepted.length === 0) {
    alert('Unsupported file type. Please select images or PDFs.');
    return;
  }
  if (skipped > 0) {
    alert(`${skipped} file(s) skipped — only images and PDFs are supported.`);
  }

  selectedFiles = accepted;

  // Show the list of selected files
  const list = dom.fileList();
  list.innerHTML = '';
  for (const file of accepted) {
    const li = document.createElement('li');
    li.className = 'file-list-item';

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.name;

    const size = document.createElement('span');
    size.className = 'file-size';
    size.textContent = formatFileSize(file.size);

    li.append(name, size);
    list.appendChild(li);
  }
  show(dom.fileInfo());
  dom.dropZone().querySelector('.drop-zone-content')!.classList.add('hidden');

  // Show PDF-specific options if any selected file is a PDF
  showPdfOptions(accepted.some(isPdfFile));
  show(dom.optionsPanel());

  // Hide previous results
  hide(dom.progressSection());
  hide(dom.resultsSection());
}

async function startOcr(): Promise<void> {
  if (selectedFiles.length === 0) return;

  const options = getOptions();
  const files = selectedFiles;
  const multiple = files.length > 1;

  pdfDownloads = [];
  batchCancelled = false;

  // Transition UI
  hide(dom.optionsPanel());
  show(dom.progressSection());
  show(dom.resultsSection());
  dom.resultList().innerHTML = '';
  hide(dom.downloadAllBtn());
  if (multiple) show(dom.batchStatus());
  else hide(dom.batchStatus());
  dom.startBtn().disabled = true;

  const progress = createProgressCallback();

  // Process each file sequentially. The OCR pipeline already saturates the
  // worker pool for a single document, so running files one at a time keeps
  // memory bounded while still getting through the whole batch.
  for (let i = 0; i < files.length; i++) {
    if (batchCancelled) break;
    const file = files[i];

    if (multiple) {
      dom.batchStatus().textContent = `File ${i + 1} of ${files.length}: ${file.name}`;
    }

    try {
      if (isImageFile(file)) {
        initProgress(1);
        const text = await ocrImage(file, options.language, options.engine, progress, options.preprocess);
        progress.onProgress(1, 1);
        addImageResult(file.name, text);
      } else {
        const fileBytes = await readFileAsArrayBuffer(file);
        // Page count is unknown until the PDF loads; pdf-ocr re-inits the grid.
        initProgress(0);
        const result = await ocrPdf(fileBytes, options, {
          ...progress,
          onLog(msg: string) {
            const pageMatch = msg.match(/PDF loaded: (\d+) pages/);
            if (pageMatch) {
              initProgress(parseInt(pageMatch[1], 10));
            }
            progress.onLog(msg);
          },
        });
        const outputName = file.name.replace(/\.pdf$/i, '') + '_OCR.pdf';
        pdfDownloads.push({ name: outputName, bytes: result.pdfBytes });
        addPdfResult(outputName, result);
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'Cancelled') {
        progress.onLog(`Cancelled: ${file.name}`);
        addErrorResult(file.name, 'Cancelled by user.');
        batchCancelled = true; // stop the rest of the batch too
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        progress.onLog(`Error processing ${file.name}: ${msg}`);
        addErrorResult(file.name, msg);
      }
    }
  }

  stopTimer();
  hide(dom.progressSection());
  hide(dom.batchStatus());

  // Offer a single click to grab every searchable PDF in the batch
  if (pdfDownloads.length > 1) {
    dom.downloadAllBtn().textContent = `Download all ${pdfDownloads.length} PDFs`;
    show(dom.downloadAllBtn());
  }

  dom.startBtn().disabled = false;
}

function resultCardHeader(name: string, badgeText: string, badgeClass: string): HTMLElement {
  const header = document.createElement('div');
  header.className = 'result-card-header';

  const nameEl = document.createElement('span');
  nameEl.className = 'result-card-name';
  nameEl.textContent = name;

  const badge = document.createElement('span');
  badge.className = `result-badge ${badgeClass}`;
  badge.textContent = badgeText;

  header.append(nameEl, badge);
  return header;
}

function addPdfResult(name: string, result: PdfOcrResult): void {
  const card = document.createElement('div');
  card.className = 'result-card';
  card.appendChild(resultCardHeader(name, 'Done', 'success'));

  const stats = document.createElement('div');
  stats.className = 'result-stats';
  for (const text of [
    `${result.pages} pages`,
    formatElapsed(result.elapsedSeconds),
    `${result.confidence.toFixed(1)}% confidence`,
    formatFileSize(result.pdfBytes.length),
  ]) {
    const span = document.createElement('span');
    span.textContent = text;
    stats.appendChild(span);
  }
  card.appendChild(stats);

  const btn = document.createElement('button');
  btn.className = 'btn-primary';
  btn.textContent = 'Download Searchable PDF';
  const bytes = result.pdfBytes;
  btn.addEventListener('click', () => {
    downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), name);
  });
  card.appendChild(btn);

  dom.resultList().appendChild(card);
}

function addImageResult(name: string, text: string): void {
  const card = document.createElement('div');
  card.className = 'result-card';
  card.appendChild(resultCardHeader(name, 'Done', 'success'));

  const pre = document.createElement('pre');
  pre.className = 'ocr-text';
  pre.textContent = text;
  card.appendChild(pre);

  const btn = document.createElement('button');
  btn.className = 'btn-primary';
  btn.textContent = 'Copy to clipboard';
  btn.addEventListener('click', () => {
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = orig), 1500);
    });
  });
  card.appendChild(btn);

  dom.resultList().appendChild(card);
}

function addErrorResult(name: string, message: string): void {
  const card = document.createElement('div');
  card.className = 'result-card';
  card.appendChild(resultCardHeader(name, 'Failed', 'error'));

  const err = document.createElement('div');
  err.className = 'result-error';
  err.textContent = message;
  card.appendChild(err);

  dom.resultList().appendChild(card);
}

function downloadAll(): void {
  for (const dl of pdfDownloads) {
    downloadBlob(new Blob([dl.bytes as BlobPart], { type: 'application/pdf' }), dl.name);
  }
}

// Wire up event handlers
function init(): void {
  initTheme();
  initHardwareStatus();

  const dropZone = dom.dropZone();
  const fileInput = dom.fileInput();

  // Theme toggle
  dom.themeToggle().addEventListener('click', toggleTheme);

  // Drop zone click -> file input
  dropZone.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('#clear-file')) return;
    fileInput.click();
  });

  // File input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      onFilesSelected(Array.from(fileInput.files));
    }
  });

  // Drag and drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer?.files.length) {
      onFilesSelected(Array.from(e.dataTransfer.files));
    }
  });

  // Paste
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) onFilesSelected(files);
  });

  // Clear file
  dom.clearFile().addEventListener('click', (e) => {
    e.stopPropagation();
    resetUI();
    fileInput.value = '';
  });

  // Start OCR
  dom.startBtn().addEventListener('click', startOcr);

  // Cancel — stop the current file and the rest of the batch
  dom.cancelBtn().addEventListener('click', () => {
    batchCancelled = true;
    cancelPipeline();
  });

  // Download all PDFs in the batch
  dom.downloadAllBtn().addEventListener('click', downloadAll);

  // Reset
  dom.resetBtn().addEventListener('click', () => {
    resetUI();
    fileInput.value = '';
  });

  // Offline mode
  if (isCacheApiAvailable()) {
    show(dom.offlineSection());
    updateCacheStatus();

    dom.cacheBtn().addEventListener('click', async () => {
      const lang = dom.langSelect().value;
      const btn = dom.cacheBtn();
      const status = dom.cacheStatus();

      btn.disabled = true;
      status.textContent = 'Downloading...';

      try {
        await prefetchAssets(lang, (completed, total) => {
          const pct = Math.round((completed / total) * 100);
          status.textContent = `Downloading... ${pct}%`;
        });
        status.textContent = `Cached for offline use (${lang})`;
        btn.textContent = 'Re-download';
      } catch (err) {
        status.textContent = `Download failed: ${err instanceof Error ? err.message : err}`;
      }
      btn.disabled = false;
    });

    // Update cache status when language changes
    dom.langSelect().addEventListener('change', updateCacheStatus);
  }
}

async function updateCacheStatus(): Promise<void> {
  const lang = dom.langSelect().value;
  const status = dom.cacheStatus();
  try {
    const cached = await getCacheStatus(lang);
    if (cached.worker && cached.core && cached.langData) {
      status.textContent = `Ready for offline use (${lang})`;
      dom.cacheBtn().textContent = 'Re-download';
    } else {
      status.textContent = 'Not cached for offline use';
      dom.cacheBtn().textContent = 'Download for offline use';
    }
  } catch {
    status.textContent = '';
  }
}

init();
