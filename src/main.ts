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

let selectedFile: File | null = null;
let pdfResult: PdfOcrResult | null = null;

function resetUI(): void {
  selectedFile = null;
  pdfResult = null;

  hide(dom.fileInfo());
  hide(dom.optionsPanel());
  hide(dom.progressSection());
  hide(dom.resultsSection());
  hide(dom.imageResult());
  hide(dom.pdfResult());

  dom.dropZone().querySelector('.drop-zone-content')!.classList.remove('hidden');
  dom.startBtn().disabled = false;
  stopTimer();
  document.title = 'MrVision';
}

function onFileSelected(file: File): void {
  if (!isImageFile(file) && !isPdfFile(file)) {
    alert('Unsupported file type. Please select an image or PDF.');
    return;
  }

  selectedFile = file;

  // Show file info
  dom.fileName().textContent = file.name;
  dom.fileSize().textContent = formatFileSize(file.size);
  show(dom.fileInfo());
  dom.dropZone().querySelector('.drop-zone-content')!.classList.add('hidden');

  // Show options (PDF-specific options only for PDFs)
  showPdfOptions(isPdfFile(file));
  show(dom.optionsPanel());

  // Hide previous results
  hide(dom.progressSection());
  hide(dom.resultsSection());
}

async function startOcr(): Promise<void> {
  if (!selectedFile) return;

  const options = getOptions();

  // Transition UI
  hide(dom.optionsPanel());
  show(dom.progressSection());
  hide(dom.resultsSection());
  dom.startBtn().disabled = true;

  const progress = createProgressCallback();

  try {
    if (isImageFile(selectedFile)) {
      // Image OCR path
      initProgress(1);

      const text = await ocrImage(selectedFile, options.language, options.engine, progress, options.preprocess);

      stopTimer();
      progress.onProgress(1, 1);

      // Show image result
      hide(dom.progressSection());
      show(dom.resultsSection());
      show(dom.imageResult());
      hide(dom.pdfResult());
      dom.ocrText().textContent = text;
    } else if (isPdfFile(selectedFile)) {
      // PDF OCR path
      const fileBytes = await readFileAsArrayBuffer(selectedFile);
      // We'll know page count after loading; init with 1 for now, pdf-ocr will update
      initProgress(0);

      const result = await ocrPdf(
        fileBytes,
        options,
        {
          ...progress,
          onLog(msg: string) {
            // Re-init page grid once we know page count
            const pageMatch = msg.match(/PDF loaded: (\d+) pages/);
            if (pageMatch) {
              initProgress(parseInt(pageMatch[1], 10));
            }
            progress.onLog(msg);
          },
        },
      );

      pdfResult = result;
      stopTimer();

      // Show PDF result
      hide(dom.progressSection());
      show(dom.resultsSection());
      hide(dom.imageResult());
      show(dom.pdfResult());

      dom.resultPages().textContent = `${result.pages} pages`;
      dom.resultTime().textContent = formatElapsed(result.elapsedSeconds);
      dom.resultConfidence().textContent = `${result.confidence.toFixed(1)}% confidence`;
      dom.resultSize().textContent = formatFileSize(result.pdfBytes.length);
    }
  } catch (err) {
    stopTimer();
    if (err instanceof Error && err.message === 'Cancelled') {
      progress.onLog('Cancelled by user.');
    } else {
      progress.onLog(`Error: ${err instanceof Error ? err.message : err}`);
    }
    hide(dom.progressSection());
    // Re-show options so user can retry
    show(dom.optionsPanel());
    dom.startBtn().disabled = false;
  }
}

function downloadResult(): void {
  if (!pdfResult || !selectedFile) return;
  const outputName = selectedFile.name.replace(/\.pdf$/i, '') + '_OCR.pdf';
  downloadBlob(new Blob([pdfResult.pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' }), outputName);
}

function copyText(): void {
  const text = dom.ocrText().textContent || '';
  navigator.clipboard.writeText(text).then(() => {
    const btn = dom.copyBtn();
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = orig), 1500);
  });
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
    if (fileInput.files && fileInput.files[0]) {
      onFileSelected(fileInput.files[0]);
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
    if (e.dataTransfer?.files[0]) {
      onFileSelected(e.dataTransfer.files[0]);
    }
  });

  // Paste
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) onFileSelected(file);
        break;
      }
    }
  });

  // Clear file
  dom.clearFile().addEventListener('click', (e) => {
    e.stopPropagation();
    resetUI();
    fileInput.value = '';
  });

  // Start OCR
  dom.startBtn().addEventListener('click', startOcr);

  // Cancel
  dom.cancelBtn().addEventListener('click', () => {
    cancelPipeline();
  });

  // Download
  dom.downloadBtn().addEventListener('click', downloadResult);

  // Copy text
  dom.copyBtn().addEventListener('click', copyText);

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
