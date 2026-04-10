import { pipeline, type ImageToTextPipeline } from '@huggingface/transformers';
import { resolveDevice, describeDevice, detectHardware } from './hardware.js';
import type { OcrEngine, OcrPageResult, ProgressCallback } from '../types/index.js';

const MODEL_ID = 'Xenova/trocr-small-printed';

let pipe: ImageToTextPipeline | null = null;
let currentDevice = '';

export async function initNeuralOcr(
  engine: OcrEngine,
  progress: ProgressCallback,
): Promise<string> {
  const hw = await detectHardware();
  const device = resolveDevice(engine, hw);
  const desc = describeDevice(device);

  progress.onLog(`Initializing neural OCR on ${desc}...`);
  progress.onStep(`Loading OCR model (${desc})...`);

  // Dispose previous pipeline if device changed
  if (pipe && currentDevice !== device) {
    await pipe.dispose();
    pipe = null;
  }

  if (!pipe) {
    pipe = await pipeline('image-to-text', MODEL_ID, {
      device: device as any,
      dtype: device === 'wasm' ? 'q8' as any : 'fp32' as any,
    }) as ImageToTextPipeline;
    currentDevice = device;
  }

  progress.onLog(`Model loaded on ${desc}.`);
  return desc;
}

export async function neuralOcrPage(
  canvas: HTMLCanvasElement,
  pageNum: number,
): Promise<OcrPageResult> {
  if (!pipe) throw new Error('Neural OCR not initialized');

  const result = await (pipe as any)(canvas, {
    max_new_tokens: 512,
  });

  const text = Array.isArray(result)
    ? result.map((r: any) => r.generated_text).join('\n')
    : (result as any).generated_text || '';

  return {
    pageNum,
    text,
    words: [],  // Neural engine returns full text, no word-level bboxes
    confidence: 95, // TrOCR doesn't return confidence per-word
    imageWidth: canvas.width,
    imageHeight: canvas.height,
  };
}

export async function neuralOcrImage(
  file: File,
  engine: OcrEngine,
  progress: ProgressCallback,
): Promise<string> {
  const desc = await initNeuralOcr(engine, progress);

  progress.onLog(`Running OCR on ${desc}...`);
  progress.onStep('Recognizing text...');

  // Create an image bitmap and draw to canvas for the pipeline
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const result = await (pipe as any)(canvas, {
    max_new_tokens: 512,
  });

  const text = Array.isArray(result)
    ? result.map((r: any) => r.generated_text).join('\n')
    : (result as any).generated_text || '';

  progress.onLog(`Done (${desc}).`);
  return text;
}

export async function destroyNeuralOcr(): Promise<void> {
  if (pipe) {
    await pipe.dispose();
    pipe = null;
    currentDevice = '';
  }
}
