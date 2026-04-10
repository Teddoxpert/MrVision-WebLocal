import * as pdfjsLib from 'pdfjs-dist';

// Configure pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export type PdfDoc = pdfjsLib.PDFDocumentProxy;

export async function loadPdf(data: ArrayBuffer): Promise<PdfDoc> {
  const loadingTask = pdfjsLib.getDocument({
    data,
    enableHWA: true,    // Hardware-accelerated canvas rendering
  } as any);
  return loadingTask.promise;
}

export async function renderPageToCanvas(
  pdfDoc: PdfDoc,
  pageNum: number,
  targetDpi: number,
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const page = await pdfDoc.getPage(pageNum);
  const scale = targetDpi / 72;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;

  return { canvas, width: canvas.width, height: canvas.height };
}

export async function renderPageToBlob(
  pdfDoc: PdfDoc,
  pageNum: number,
  targetDpi: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const { canvas, width, height } = await renderPageToCanvas(pdfDoc, pageNum, targetDpi);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to convert canvas to blob'))),
      'image/png',
    );
  });
  // Release canvas memory immediately — the blob holds the compressed data
  canvas.width = 0;
  canvas.height = 0;
  return { blob, width, height };
}
