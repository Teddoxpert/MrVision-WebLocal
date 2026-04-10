import Tesseract from 'tesseract.js';
import type { OcrPageResult, OcrWord, ProgressCallback } from '../types/index.js';

let scheduler: Tesseract.Scheduler | null = null;

export async function initWorkerPool(
  language: string,
  progress: ProgressCallback,
): Promise<void> {
  const cores = navigator.hardwareConcurrency || 4;
  progress.onLog(`Initializing ${cores} OCR workers (${language})...`);
  progress.onStep(`Loading OCR engine...`);

  scheduler = Tesseract.createScheduler();

  const workerPromises: Promise<void>[] = [];
  for (let i = 0; i < cores; i++) {
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
