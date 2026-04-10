import {
  PDFDocument,
  PDFName,
  StandardFonts,
  TextRenderingMode,
  pushGraphicsState,
  popGraphicsState,
  beginText,
  endText,
  setFontAndSize,
  setTextRenderingMode,
  setTextMatrix,
  showText,
} from 'pdf-lib';
import type { OcrPageResult } from '../types/index.js';

export async function buildSearchablePdf(
  sourceBytes: ArrayBuffer,
  ocrResults: Map<number, OcrPageResult>,
  _renderDpi: number,
): Promise<Uint8Array> {
  const sourcePdf = await PDFDocument.load(sourceBytes);
  const outputPdf = await PDFDocument.create();
  const font = await outputPdf.embedFont(StandardFonts.Helvetica);
  const fontKey = 'F-mrvision-ocr';

  const pageCount = sourcePdf.getPageCount();

  for (let i = 0; i < pageCount; i++) {
    // Embed the source page as a form XObject
    const [embeddedPage] = await outputPdf.embedPages(
      sourcePdf.getPages().slice(i, i + 1),
    );

    // Create a fresh page with the same visual dimensions
    const epWidth = embeddedPage.width;
    const epHeight = embeddedPage.height;
    const page = outputPdf.addPage([epWidth, epHeight]);

    // Draw the original page content
    page.drawPage(embeddedPage, { x: 0, y: 0, width: epWidth, height: epHeight });

    const ocrResult = ocrResults.get(i + 1);
    if (!ocrResult || !ocrResult.text.trim()) continue;

    // Compute coordinate mapping.
    // embeddedPage.width/height are the VISUAL dimensions (accounting for
    // rotation and CropBox). The rendered image was at renderDpi.
    // pxToPt converts OCR pixel coordinates to PDF points.
    const imgW = ocrResult.imageWidth;
    const imgH = ocrResult.imageHeight;
    const scaleX = epWidth / imgW;
    const scaleY = epHeight / imgH;

    // Register font for raw operators on this fresh page
    page.node.setFontDictionary(PDFName.of(fontKey), font.ref);

    // Draw invisible OCR text using raw PDF operators.
    // This is a fresh page with identity CTM — no risk of inherited transforms.
    page.pushOperators(pushGraphicsState());

    if (ocrResult.words.length > 0) {
      for (const word of ocrResult.words) {
        const { x0, y1 } = word.bbox;
        const y0 = word.bbox.y0;

        const pdfX = x0 * scaleX;
        const pdfY = epHeight - y1 * scaleY;
        const wordHeight = (y1 - y0) * scaleY;
        const fontSize = wordHeight * 0.85;

        if (fontSize < 1 || !word.text.trim()) continue;

        try {
          const encoded = font.encodeText(word.text);
          page.pushOperators(
            beginText(),
            setTextRenderingMode(TextRenderingMode.Invisible),
            setFontAndSize(fontKey, fontSize),
            setTextMatrix(1, 0, 0, 1, pdfX, pdfY),
            showText(encoded),
            endText(),
          );
        } catch {
          // Skip words with characters the font can't encode
        }
      }
    } else {
      // Page-level text (neural engine path)
      const lines = ocrResult.text.split('\n').filter((l) => l.trim());
      const fontSize = 10;
      const lineHeight = fontSize * 1.4;
      const margin = 36;
      let y = epHeight - margin;

      for (const line of lines) {
        if (y < margin) break;
        try {
          const encoded = font.encodeText(line);
          page.pushOperators(
            beginText(),
            setTextRenderingMode(TextRenderingMode.Invisible),
            setFontAndSize(fontKey, fontSize),
            setTextMatrix(1, 0, 0, 1, margin, y),
            showText(encoded),
            endText(),
          );
        } catch { /* skip */ }
        y -= lineHeight;
      }
    }

    page.pushOperators(popGraphicsState());
  }

  return outputPdf.save();
}
