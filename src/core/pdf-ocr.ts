import { loadPdf, renderPageToCanvas } from './pdf-renderer.js';
import { initWorkerPool, ocrPage, destroyWorkerPool } from './worker-pool.js';
import { initNeuralOcr, neuralOcrPage, destroyNeuralOcr } from './neural-ocr.js';
import { preprocessPageImage, isGpuPreprocessAvailable } from './gpu-preprocess.js';
import { buildSearchablePdf } from './pdf-builder.js';
import { estimateTime, formatElapsed } from '../utils/time.js';
import { formatFileSize } from '../utils/file.js';
import type { OcrPageResult, PipelineOptions, ProgressCallback } from '../types/index.js';

export interface PdfOcrResult {
  pdfBytes: Uint8Array;
  pages: number;
  confidence: number;
  elapsedSeconds: number;
}

let cancelled = false;

export function cancelPipeline(): void {
  cancelled = true;
}

function useNeuralEngine(engine: string): boolean {
  return engine === 'gpu' || engine === 'npu';
}

export async function ocrPdf(
  fileBytes: ArrayBuffer,
  options: PipelineOptions,
  progress: ProgressCallback,
): Promise<PdfOcrResult> {
  cancelled = false;
  const startTime = Date.now();
  const neural = useNeuralEngine(options.engine);

  // Step 1: Load PDF
  progress.onStep('Loading PDF...');
  progress.onLog('Loading PDF...');
  const pdfDoc = await loadPdf(fileBytes.slice(0));
  const totalPages = pdfDoc.numPages;
  const cores = navigator.hardwareConcurrency || 4;
  const est = estimateTime(totalPages, cores);
  progress.onLog(
    `PDF loaded: ${totalPages} pages. Estimated time: ~${formatElapsed(est)} (${cores} CPU cores).`,
  );

  // Warn about large documents
  if (totalPages > 50) {
    progress.onLog(
      `Large document (${totalPages} pages). Processing in memory-efficient streaming mode.`,
    );
  }

  if (cancelled) throw new Error('Cancelled');

  // Step 2: Initialize OCR engine
  // Tesseract is the proven engine for full-page OCR with word-level bboxes.
  // The neural engine (TrOCR) is a text-line model — it doesn't handle full
  // pages well. So Auto mode always uses Tesseract. GPU/NPU are opt-in only.
  let engineDesc: string;
  if (neural) {
    engineDesc = await initNeuralOcr(options.engine, progress);
  } else {
    engineDesc = 'CPU (Tesseract)';
    await initWorkerPool(options.language, progress);
  }

  const isNeuralActive = engineDesc !== 'CPU (Tesseract)';

  if (cancelled) {
    if (isNeuralActive) await destroyNeuralOcr();
    else await destroyWorkerPool();
    throw new Error('Cancelled');
  }

  // Step 3: Streaming render + OCR pipeline
  // Memory-efficient: render pages one at a time, submit to OCR scheduler,
  // and let the scheduler distribute across workers. Only keep a small
  // number of rendered images in flight (concurrency window).
  const renderDpi = options.dpi;

  // Check GPU preprocessing availability
  const gpuPreprocess = await isGpuPreprocessAvailable();
  if (gpuPreprocess) {
    progress.onLog('GPU preprocessing enabled (WebGPU compute shaders).');
  }

  progress.onLog(`Rendering at ${renderDpi} DPI, OCR on ${engineDesc}...`);
  progress.onStep(`Processing 0/${totalPages} pages...`);

  const results = new Map<number, OcrPageResult>();
  let completed = 0;
  let totalConfidence = 0;

  if (isNeuralActive) {
    // Neural engine: strictly sequential (one model instance)
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (cancelled) break;

      progress.onPageStatus(pageNum, 'rendering');
      const rendered = await renderPageToCanvas(pdfDoc, pageNum, renderDpi);
      const { width, height } = rendered;

      if (cancelled) { rendered.canvas.width = 0; rendered.canvas.height = 0; break; }

      // GPU preprocess if available (skip on failure)
      let canvas = rendered.canvas;
      if (gpuPreprocess) {
        try {
          const pp = await preprocessPageImage(rendered.canvas, 0.5);
          canvas = pp.canvas;
          rendered.canvas.width = 0; rendered.canvas.height = 0;
        } catch {
          canvas = rendered.canvas;
        }
      }

      progress.onPageStatus(pageNum, 'ocr');
      try {
        const result = await neuralOcrPage(canvas, pageNum);
        result.imageWidth = width;
        result.imageHeight = height;
        results.set(pageNum, result);
        totalConfidence += result.confidence;
      } catch (err) {
        progress.onPageStatus(pageNum, 'error');
        progress.onLog(`Page ${pageNum} failed: ${err instanceof Error ? err.message : err}`);
      }

      // Release canvas memory immediately
      canvas.width = 0;
      canvas.height = 0;

      completed++;
      progress.onPageStatus(pageNum, results.has(pageNum) ? 'done' : 'error');
      progress.onProgress(completed, totalPages);
      progress.onStep(`Processing ${completed}/${totalPages} pages...`);
    }

    await destroyNeuralOcr();
  } else {
    // Tesseract path: use a sliding window to limit memory.
    // Render pages one at a time and feed blobs to the scheduler.
    // The scheduler distributes jobs across N workers internally.
    // We keep at most `maxInFlight` OCR jobs pending to bound memory.
    const maxInFlight = Math.min(cores, 4); // Keep at most 4 pages in memory
    const pendingJobs: Promise<void>[] = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (cancelled) break;

      progress.onPageStatus(pageNum, 'rendering');

      // Render page to canvas, optionally preprocess on GPU, convert to blob
      const { canvas, width, height } = await renderPageToCanvas(pdfDoc, pageNum, renderDpi);
      if (cancelled) { canvas.width = 0; canvas.height = 0; break; }

      // GPU preprocessing: grayscale + contrast enhancement
      // If it fails for any reason, use the original canvas
      let ocrCanvas = canvas;
      if (gpuPreprocess) {
        try {
          const pp = await preprocessPageImage(canvas, 0.5);
          ocrCanvas = pp.canvas;
        } catch {
          // GPU preprocessing failed, use original
          ocrCanvas = canvas;
        }
      }

      // If GPU canvas is invalid, fall back to original
      if (!ocrCanvas.width || !ocrCanvas.height) {
        ocrCanvas = canvas;
      }

      // Convert to blob and release canvases
      const blob = await new Promise<Blob>((resolve, reject) => {
        ocrCanvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
          'image/png',
        );
      });
      if (ocrCanvas !== canvas) { ocrCanvas.width = 0; ocrCanvas.height = 0; }
      canvas.width = 0; canvas.height = 0;

      if (cancelled) break;

      progress.onPageStatus(pageNum, 'ocr');

      // Submit OCR job (non-blocking — scheduler queues it)
      const job = (async (pn: number) => {
        try {
          const result = await ocrPage(blob, pn, width, height);
          results.set(pn, result);
          totalConfidence += result.confidence;
          progress.onPageStatus(pn, 'done');
        } catch (err) {
          if (!cancelled) {
            progress.onPageStatus(pn, 'error');
            progress.onLog(`Page ${pn} failed: ${err instanceof Error ? err.message : err}`);
          }
        }
        completed++;
        progress.onProgress(completed, totalPages);
        progress.onStep(`Processing ${completed}/${totalPages} pages...`);
      })(pageNum);

      pendingJobs.push(job);

      // If we've hit the concurrency limit, wait for the oldest job
      // before rendering the next page. This bounds memory usage.
      if (pendingJobs.length >= maxInFlight) {
        await pendingJobs.shift();
      }
    }

    // Wait for remaining jobs
    await Promise.all(pendingJobs);
    await destroyWorkerPool();
  }

  if (cancelled) throw new Error('Cancelled');

  const avgConfidence = results.size > 0 ? totalConfidence / results.size : 0;
  const totalWords = Array.from(results.values()).reduce((s, r) => s + r.words.length, 0);
  progress.onLog(
    `OCR complete. ${results.size}/${totalPages} pages, ${totalWords} words detected, ` +
    `average confidence: ${avgConfidence.toFixed(1)}%.`,
  );

  // Step 4: Build searchable PDF
  progress.onStep('Building searchable PDF...');
  progress.onLog('Building searchable PDF...');

  const pdfBytes = await buildSearchablePdf(fileBytes, results, renderDpi);

  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  progress.onLog(
    `Done! Output size: ${formatFileSize(pdfBytes.length)}. Time: ${formatElapsed(elapsed)}.`,
  );

  return {
    pdfBytes,
    pages: totalPages,
    confidence: avgConfidence,
    elapsedSeconds: elapsed,
  };
}
