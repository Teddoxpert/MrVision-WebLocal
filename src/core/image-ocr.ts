import Tesseract from 'tesseract.js';
import type { OcrEngine } from '../types/index.js';
import type { ProgressCallback } from '../types/index.js';
import { neuralOcrImage, initNeuralOcr, destroyNeuralOcr, neuralOcrPage } from './neural-ocr.js';
import { preprocessPageImage } from './gpu-preprocess.js';

export async function ocrImage(
  file: File,
  language: string,
  engine: OcrEngine,
  progress: ProgressCallback,
  preprocess: boolean = false,
): Promise<string> {
  // Neural engine (TrOCR) only when explicitly selected — it's a text-line
  // model and works best on cropped text images, not full pages/photos.
  if (engine === 'gpu' || engine === 'npu') {
    if (preprocess) {
      return neuralOcrImageWithPreprocess(file, engine, progress);
    }
    return neuralOcrImage(file, engine, progress);
  }

  // Auto and CPU both use Tesseract — proven for full-page/photo OCR
  progress.onLog('Starting image OCR (Tesseract)...');
  progress.onStep('Loading OCR engine...');

  const worker = await Tesseract.createWorker(language);

  progress.onLog('OCR engine loaded. Recognizing text...');
  progress.onStep('Recognizing text...');

  // Optional preprocessing (defensive — never blocks OCR)
  let input: File | Blob = file;
  if (preprocess) {
    try {
      progress.onStep('Enhancing image...');
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();

      const pp = await preprocessPageImage(canvas, 0.5);
      progress.onLog(`Image preprocessed on ${pp.usedGpu ? 'GPU' : 'CPU'}`);
      progress.onStep('Recognizing text...');

      // Convert preprocessed canvas to blob for Tesseract
      const blob = await new Promise<Blob>((resolve, reject) => {
        pp.canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Blob conversion failed'))),
          'image/png',
        );
      });
      input = blob;

      // Release canvases
      canvas.width = 0; canvas.height = 0;
      if (pp.canvas !== canvas) { pp.canvas.width = 0; pp.canvas.height = 0; }
    } catch (err) {
      progress.onLog('Preprocessing failed, using original image');
      input = file;
    }
  }

  const result = await worker.recognize(input);
  const text = result.data.text;
  const confidence = result.data.confidence;

  await worker.terminate();

  progress.onLog(`Done. Confidence: ${confidence.toFixed(1)}%`);
  return text;
}

async function neuralOcrImageWithPreprocess(
  file: File,
  engine: OcrEngine,
  progress: ProgressCallback,
): Promise<string> {
  const desc = await initNeuralOcr(engine, progress);

  progress.onLog(`Running OCR on ${desc}...`);
  progress.onStep('Enhancing image...');

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  let ocrCanvas = canvas;
  try {
    const pp = await preprocessPageImage(canvas, 0.5);
    ocrCanvas = pp.canvas;
    progress.onLog(`Image preprocessed on ${pp.usedGpu ? 'GPU' : 'CPU'}`);
  } catch {
    progress.onLog('Preprocessing failed, using original image');
  }

  progress.onStep('Recognizing text...');
  const result = await neuralOcrPage(ocrCanvas, 1);

  // Cleanup
  canvas.width = 0; canvas.height = 0;
  if (ocrCanvas !== canvas) { ocrCanvas.width = 0; ocrCanvas.height = 0; }
  await destroyNeuralOcr();

  progress.onLog(`Done (${desc}).`);
  return result.text;
}
