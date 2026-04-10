import Tesseract from 'tesseract.js';
import type { OcrEngine } from '../types/index.js';
import type { ProgressCallback } from '../types/index.js';
import { neuralOcrImage } from './neural-ocr.js';

export async function ocrImage(
  file: File,
  language: string,
  engine: OcrEngine,
  progress: ProgressCallback,
): Promise<string> {
  // Neural engine (TrOCR) only when explicitly selected — it's a text-line
  // model and works best on cropped text images, not full pages/photos.
  if (engine === 'gpu' || engine === 'npu') {
    return neuralOcrImage(file, engine, progress);
  }

  // Auto and CPU both use Tesseract — proven for full-page/photo OCR
  progress.onLog('Starting image OCR (Tesseract)...');
  progress.onStep('Loading OCR engine...');

  const worker = await Tesseract.createWorker(language);

  progress.onLog('OCR engine loaded. Recognizing text...');
  progress.onStep('Recognizing text...');

  const result = await worker.recognize(file);
  const text = result.data.text;
  const confidence = result.data.confidence;

  await worker.terminate();

  progress.onLog(`Done. Confidence: ${confidence.toFixed(1)}%`);
  return text;
}
