import Tesseract from 'tesseract.js';
import type { OcrPageResult, OcrWord, ProgressCallback } from '../types/index.js';

let scheduler: Tesseract.Scheduler | null = null;

export function isMobile(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

/**
 * Determine max concurrency based on device capabilities.
 * Uses navigator.deviceMemory when available, falls back to UA-based detection.
 */
export function getMaxConcurrency(): number {
  const cores = navigator.hardwareConcurrency || 4;
  const mem: number | undefined = (navigator as any).deviceMemory;

  if (mem != null) {
    if (mem <= 2) return 1;
    if (mem <= 4) return Math.min(cores, 2);
    return Math.min(cores, 4);
  }

  // Fallback: UA-based mobile detection
  return isMobile() ? 1 : Math.min(cores, 4);
}

export async function initWorkerPool(
  language: string,
  progress: ProgressCallback,
): Promise<void> {
  const cores = navigator.hardwareConcurrency || 4;
  // Adaptive worker count based on device memory and cores
  const numWorkers = getMaxConcurrency();
  const memLabel = (navigator as any).deviceMemory != null
    ? ` [${(navigator as any).deviceMemory}GB RAM]`
    : isMobile() ? ' [mobile mode]' : '';
  progress.onLog(`Initializing ${numWorkers} OCR worker${numWorkers > 1 ? 's' : ''} (${language})${memLabel}...`);
  progress.onStep(`Loading OCR engine...`);

  scheduler = Tesseract.createScheduler();

  const workerPromises: Promise<void>[] = [];
  for (let i = 0; i < numWorkers; i++) {
    workerPromises.push(
      Tesseract.createWorker(language).then((worker) => {
        scheduler!.addWorker(worker);
      }),
    );
  }
  await Promise.all(workerPromises);
  progress.onLog(`${cores} OCR workers ready.`);
}

/**
 * Extract words with bounding boxes from tesseract.js v7 result.
 * In v7, words are nested: blocks[] → paragraphs[] → lines[] → words[].
 * (Older versions had a flat `data.words` array which no longer exists.)
 */
function extractWords(data: any): OcrWord[] {
  const words: OcrWord[] = [];

  const blocks = data.blocks;
  if (!blocks || !Array.isArray(blocks)) return words;

  for (const block of blocks) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        for (const word of line.words || []) {
          if (!word.text?.trim() || !word.bbox) continue;
          words.push({
            text: word.text,
            bbox: {
              x0: word.bbox.x0,
              y0: word.bbox.y0,
              x1: word.bbox.x1,
              y1: word.bbox.y1,
            },
            confidence: word.confidence ?? 0,
          });
        }
      }
    }
  }

  return words;
}

export async function ocrPage(
  imageData: Blob | string,
  pageNum: number,
  imageWidth: number,
  imageHeight: number,
): Promise<OcrPageResult> {
  if (!scheduler) throw new Error('Worker pool not initialized');

  const result = await scheduler.addJob('recognize', imageData, {}, { text: true, blocks: true });
  const data = result.data as any;
  const words = extractWords(data);

  return {
    pageNum,
    text: data.text,
    words,
    confidence: data.confidence,
    imageWidth,
    imageHeight,
  };
}

export async function destroyWorkerPool(): Promise<void> {
  if (scheduler) {
    await scheduler.terminate();
    scheduler = null;
  }
}
