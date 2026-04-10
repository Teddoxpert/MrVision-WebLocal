/**
 * End-to-end test: create a PDF with known text, render pages, OCR them,
 * build a searchable PDF, and verify the output.
 *
 * Uses system Tesseract CLI (since tesseract.js needs network for lang data).
 *
 * Run with:  node --experimental-strip-types test/e2e-pdf-ocr.ts
 */
import { PDFDocument, StandardFonts, rgb, TextRenderingMode, pushGraphicsState, popGraphicsState, setTextRenderingMode } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from 'canvas';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const TEST_DIR = 'test/artifacts';

// ── Step 1: Create a test PDF with known text ────────────────────────
async function createTestPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const page1 = pdf.addPage([612, 792]); // Letter size
  page1.drawText('MrVision OCR Test', {
    x: 50, y: 700, size: 28, font, color: rgb(0, 0, 0),
  });
  page1.drawText('The quick brown fox jumps over the lazy dog.', {
    x: 50, y: 650, size: 16, font, color: rgb(0, 0, 0),
  });
  page1.drawText('Page 1 of 2', {
    x: 50, y: 600, size: 14, font, color: rgb(0.3, 0.3, 0.3),
  });

  const page2 = pdf.addPage([612, 792]);
  page2.drawText('Second Page Content', {
    x: 50, y: 700, size: 24, font, color: rgb(0, 0, 0),
  });
  page2.drawText('Hello World from MrVision.', {
    x: 50, y: 650, size: 16, font, color: rgb(0, 0, 0),
  });
  page2.drawText('Page 2 of 2', {
    x: 50, y: 600, size: 14, font, color: rgb(0.3, 0.3, 0.3),
  });

  return pdf.save();
}

// ── Step 2: Load with pdf.js and render pages to PNG ─────────────────
async function renderPdfPages(
  pdfBytes: Uint8Array,
  dpi: number,
): Promise<{ pageNum: number; pngPath: string; width: number; height: number }[]> {
  const doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const results: { pageNum: number; pngPath: string; width: number; height: number }[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const scale = dpi / 72;
    const viewport = page.getViewport({ scale });

    const canvas = createCanvas(
      Math.floor(viewport.width),
      Math.floor(viewport.height),
    );
    const ctx = canvas.getContext('2d');

    await page.render({
      canvasContext: ctx as any,
      viewport,
    } as any).promise;

    const pngPath = `${TEST_DIR}/page-${i}.png`;
    writeFileSync(pngPath, canvas.toBuffer('image/png'));
    results.push({ pageNum: i, pngPath, width: canvas.width, height: canvas.height });
    console.log(`  Rendered page ${i}: ${canvas.width}x${canvas.height}`);
  }

  return results;
}

// ── Step 3: OCR each rendered page with system Tesseract CLI ─────────
interface OcrResult {
  pageNum: number;
  text: string;
  confidence: number;
  words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[];
  imageWidth: number;
  imageHeight: number;
}

function ocrWithTesseractCli(
  pages: { pageNum: number; pngPath: string; width: number; height: number }[],
): OcrResult[] {
  const results: OcrResult[] = [];

  for (const page of pages) {
    // Run tesseract to get TSV output (includes word bounding boxes)
    const tsvPath = `${TEST_DIR}/page-${page.pageNum}`;
    execSync(`tesseract ${page.pngPath} ${tsvPath} -l eng tsv`, { stdio: 'pipe' });
    const tsv = readFileSync(`${tsvPath}.tsv`, 'utf-8');

    // Also get plain text
    execSync(`tesseract ${page.pngPath} ${tsvPath} -l eng`, { stdio: 'pipe' });
    const text = readFileSync(`${tsvPath}.txt`, 'utf-8');

    // Parse TSV for word-level bboxes
    const lines = tsv.split('\n').slice(1); // skip header
    const words: OcrResult['words'] = [];
    let totalConf = 0;
    let wordCount = 0;

    for (const line of lines) {
      const cols = line.split('\t');
      if (cols.length < 12) continue;
      const level = parseInt(cols[0]);
      if (level !== 5) continue; // level 5 = word
      const conf = parseFloat(cols[10]);
      const wordText = cols[11]?.trim();
      if (!wordText || conf < 0) continue;

      const x = parseInt(cols[6]);
      const y = parseInt(cols[7]);
      const w = parseInt(cols[8]);
      const h = parseInt(cols[9]);
      words.push({
        text: wordText,
        bbox: { x0: x, y0: y, x1: x + w, y1: y + h },
      });
      totalConf += conf;
      wordCount++;
    }

    const confidence = wordCount > 0 ? totalConf / wordCount : 0;
    results.push({
      pageNum: page.pageNum,
      text,
      confidence,
      words,
      imageWidth: page.width,
      imageHeight: page.height,
    });
    console.log(
      `  OCR page ${page.pageNum}: confidence=${confidence.toFixed(1)}%, ` +
        `words=${words.length}, text="${text.trim().substring(0, 60)}..."`,
    );
  }

  return results;
}

// ── Step 4: Build searchable PDF (same logic as pdf-builder.ts) ──────
async function buildSearchablePdf(
  sourceBytes: Uint8Array,
  ocrResults: OcrResult[],
  renderDpi: number,
): Promise<Uint8Array> {
  const sourcePdf = await PDFDocument.load(sourceBytes);
  const outputPdf = await PDFDocument.create();
  const font = await outputPdf.embedFont(StandardFonts.Helvetica);
  const pageCount = sourcePdf.getPageCount();
  const pxToPt = 72 / renderDpi;

  for (let i = 0; i < pageCount; i++) {
    const [copiedPage] = await outputPdf.copyPages(sourcePdf, [i]);
    outputPdf.addPage(copiedPage);
    const page = outputPdf.getPage(i);

    const ocrResult = ocrResults.find((r) => r.pageNum === i + 1);
    if (!ocrResult || ocrResult.words.length === 0) continue;

    const pageHeightPt = ocrResult.imageHeight * pxToPt;

    page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
    for (const word of ocrResult.words) {
      const { x0, y0, y1 } = word.bbox;
      const pdfX = x0 * pxToPt;
      const pdfY = pageHeightPt - y1 * pxToPt;
      const wordHeight = (y1 - y0) * pxToPt;
      const fontSize = wordHeight * 0.85;
      if (fontSize < 1 || !word.text.trim()) continue;
      try {
        page.drawText(word.text, {
          x: pdfX, y: pdfY, size: fontSize, font,
        });
      } catch { /* skip unencodable */ }
    }
    page.pushOperators(popGraphicsState());
  }

  return outputPdf.save();
}

// ── Step 5: Run it all ───────────────────────────────────────────────
async function main() {
  console.log('\n=== MrVision E2E PDF OCR Test ===\n');

  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });

  // Create test PDF
  console.log('[1] Creating test PDF with pdf-lib...');
  const testPdfBytes = await createTestPdf();
  writeFileSync(`${TEST_DIR}/test-input.pdf`, testPdfBytes);
  console.log(`  Created test-input.pdf (${testPdfBytes.length} bytes, 2 pages)\n`);

  // Render pages with pdf.js + node-canvas
  console.log('[2] Rendering PDF pages at 300 DPI (pdf.js + node-canvas)...');
  const renderedPages = await renderPdfPages(testPdfBytes, 300);
  console.log(`  Saved ${renderedPages.length} page images\n`);

  // OCR with system Tesseract
  console.log('[3] Running OCR (system Tesseract CLI)...');
  const ocrResults = ocrWithTesseractCli(renderedPages);
  console.log();

  // Verify OCR results
  console.log('[4] Verifying OCR accuracy...');
  const expectedTexts = [
    ['MrVision', 'quick brown fox', 'lazy dog', 'Page 1'],
    ['Second Page', 'Hello World', 'MrVision', 'Page 2'],
  ];

  let allFound = true;
  for (let i = 0; i < expectedTexts.length; i++) {
    const pageText = ocrResults[i]?.text || '';
    for (const expected of expectedTexts[i]) {
      const found = pageText.toLowerCase().includes(expected.toLowerCase());
      const status = found ? 'PASS' : 'FAIL';
      console.log(`  [${status}] Page ${i + 1} contains "${expected}"`);
      if (!found) {
        allFound = false;
        console.log(`    Actual text: "${pageText.trim().substring(0, 120)}"`);
      }
    }
  }
  console.log();

  // Build searchable PDF with pdf-lib
  console.log('[5] Building searchable PDF (pdf-lib)...');
  // Re-read from disk to get a fresh buffer (pdf.js may have detached the original)
  const freshPdfBytes = new Uint8Array(readFileSync(`${TEST_DIR}/test-input.pdf`));
  const outputBytes = await buildSearchablePdf(freshPdfBytes, ocrResults, 300);
  writeFileSync(`${TEST_DIR}/test-output-ocr.pdf`, outputBytes);
  console.log(`  Created test-output-ocr.pdf (${outputBytes.length} bytes)\n`);

  // Verify output PDF
  console.log('[6] Verifying output PDF...');
  const verifyPdf = await PDFDocument.load(outputBytes);
  const pageCount = verifyPdf.getPageCount();
  console.log(`  Output PDF has ${pageCount} pages`);
  console.log(`  Input size:  ${freshPdfBytes.length} bytes`);
  console.log(`  Output size: ${outputBytes.length} bytes`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Pages processed: ${ocrResults.length}`);
  const avgConf = ocrResults.reduce((s, r) => s + r.confidence, 0) / ocrResults.length;
  console.log(`Average confidence: ${avgConf.toFixed(1)}%`);
  const totalWords = ocrResults.reduce((s, r) => s + r.words.length, 0);
  console.log(`Total words detected: ${totalWords}`);
  console.log(`OCR text verification: ${allFound ? 'ALL PASSED' : 'SOME FAILED'}`);
  console.log(`Output PDF valid: ${pageCount === 2 ? 'YES' : 'NO'}`);

  if (!allFound || pageCount !== 2) {
    console.log('\n*** TEST FAILED ***');
    process.exit(1);
  } else {
    console.log('\n*** ALL TESTS PASSED ***');
  }
}

main().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
