import { dom } from './dom.js';
import type { PageStatus, ProgressCallback } from '../types/index.js';
import { formatElapsed } from '../utils/time.js';

let startTime = 0;
let timerHandle = 0;

export function initProgress(totalPages: number): void {
  startTime = Date.now();
  dom.progressStep().textContent = 'Initializing...';
  dom.progressBar().style.width = '0%';
  dom.progressPercent().textContent = '0%';
  dom.log().textContent = '';

  // Build page grid dots
  const grid = dom.pageGrid();
  grid.innerHTML = '';
  for (let i = 0; i < totalPages; i++) {
    const dot = document.createElement('div');
    dot.className = 'page-dot';
    dot.dataset.page = String(i + 1);
    grid.appendChild(dot);
  }

  // Start elapsed timer
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    dom.progressTime().textContent = formatElapsed(elapsed);
    document.title = `MrVision - ${dom.progressPercent().textContent}`;
  }, 1000);
}

export function stopTimer(): void {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = 0;
  }
  document.title = 'MrVision';
}

export function getElapsedSeconds(): number {
  return Math.floor((Date.now() - startTime) / 1000);
}

export function createProgressCallback(): ProgressCallback {
  return {
    onLog(message: string) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const logEl = dom.log();
      logEl.textContent += `[${formatElapsed(elapsed)}] ${message}\n`;
      logEl.scrollTop = logEl.scrollHeight;
    },
    onStep(step: string) {
      dom.progressStep().textContent = step;
    },
    onProgress(completed: number, total: number) {
      const pct = Math.round((completed / total) * 100);
      dom.progressBar().style.width = `${pct}%`;
      dom.progressPercent().textContent = `${pct}%`;
    },
    onPageStatus(pageNum: number, status: PageStatus) {
      const dot = dom.pageGrid().querySelector(`[data-page="${pageNum}"]`);
      if (dot) {
        dot.className = 'page-dot';
        if (status !== 'pending') dot.classList.add(status);
      }
    },
  };
}
