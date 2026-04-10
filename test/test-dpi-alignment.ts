/**
 * Test that OCR text overlay coordinates are correct at various DPIs.
 *
 * Creates a PDF with text at known positions, renders at different DPIs,
 * OCRs each rendering, builds searchable PDFs, and verifies the invisible
 * text overlay coordinates match the original text positions.
 *
 * Run with:  node --experimental-strip-types test/test-dpi-alignment.ts
 */
import { PDFDocument, StandardFonts, rgb, TextRenderingMode, pushGraphicsState, popGraphicsState, setTextRenderingMode } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const TEST_DIR = 'test/artifacts/dpi-test';

// Known text positions in PDF points (72 DPI).
// We'll verify that OCR + overlay places text near these coordinates.
const KNOWN_ITEMS = [
  { text: 'TOP LEFT', x: 50, y: 742, size: 20 },       // near top-left
  { text: 'CENTER TEXT', x: 220, y: 420, size: 18 },    // center of page
  { text: 'BOTTOM RIGHT', x: 350, y: 80, size: 16 },   // near bottom-right
  { text: 'Small text here', x: 50, y: 300, size: 14 }, // smaller text
];

// ── Create test PDF with text at known positions ─────────────────────
async function createTestPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]); // Letter size

  for (const item of KNOWN_ITEMS) {
    page.drawText(item.text, {
      x: item.x, y: item.y, size: item.size, font, color: rgb(0, 0, 0),
    });
  }

  return pdf.save();
}

// ── Render page with pdf.js at given DPI ─────────────────────────────
async function renderPage(
  pdfBytes: Uint8Array,
  dpi: number,
): Promise<{ pngPath: string; width: number; height: number }> {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) }).promise;
  const page = await doc.getPage(1);
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });

  const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx as any, viewport } as any).promise;

  const pngPath = `${TEST_DIR}/page-${dpi}dpi.png`;
  writeFileSync(pngPath, canvas.toBuffer('image/png'));
  return { pngPath, width: canvas.width, height: canvas.height };
}

// ── OCR with system Tesseract ────────────────────────────────────────
interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

function ocrPage(pngPath: string): OcrWord[] {
  const base = pngPath.replace('.png', '');
  execSync(`tesseract ${pngPath} ${base} -l eng tsv`, { stdio: 'pipe' });
  const tsv = execSync(`cat ${base}.tsv`, { encoding: 'utf-8' });

  const words: OcrWord[] = [];
  for (const line of tsv.split('\n').slice(1)) {
    const cols = line.split('\t');
    if (cols.length < 12 || parseInt(cols[0]) !== 5) continue;
    const conf = parseFloat(cols[10]);
    const text = cols[11]?.trim();
    if (!text || conf < 0) continue;
    const x = parseInt(cols[6]);
    const y = parseInt(cols[7]);
    const w = parseInt(cols[8]);
    const h = parseInt(cols[9]);
    words.push({ text, bbox: { x0: x, y0: y, x1: x + w, y1: y + h } });
  }
  return words;
}

// ── Build searchable PDF using same logic as pdf-builder.ts ──────────
async function buildSearchablePdf(
  sourceBytes: Uint8Array,
  words: OcrWord[],
  imgWidth: number,
  imgHeight: number,
  renderDpi: number,
): Promise<{ pdfBytes: Uint8Array; overlayCoords: { text: string; x: number; y: number }[] }> {
  const sourcePdf = await PDFDocument.load(sourceBytes);
  const outputPdf = await PDFDocument.create();
  const font = await outputPdf.embedFont(StandardFonts.Helvetica);

  const [copiedPage] = await outputPdf.copyPages(sourcePdf, [0]);
  outputPdf.addPage(copiedPage);
  const page = outputPdf.getPage(0);

  const pxToPt = 72 / renderDpi;
  const pageHeightPt = imgHeight * pxToPt;

  page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));

  const overlayCoords: { text: string; x: number; y: number }[] = [];

  for (const word of words) {
    const { x0, y0, y1 } = word.bbox;
    const pdfX = x0 * pxToPt;
    const pdfY = pageHeightPt - y1 * pxToPt;
    const wordHeight = (y1 - y0) * pxToPt;
    const fontSize = wordHeight * 0.85;
    if (fontSize < 1 || !word.text.trim()) continue;

    overlayCoords.push({ text: word.text, x: pdfX, y: pdfY });

    try {
      page.drawText(word.text, { x: pdfX, y: pdfY, size: fontSize, font });
    } catch { /* skip */ }
  }

  page.pushOperators(popGraphicsState());

  return { pdfBytes: await outputPdf.save(), overlayCoords };
}

// ── Find the overlay coordinate for a known text item ────────────────
function findOverlayForText(
  overlayCoords: { text: string; x: number; y: number }[],
  searchText: string,
): { x: number; y: number } | null {
  // Search for the first word of the known text
  const firstWord = searchText.split(' ')[0].toUpperCase();
  const match = overlayCoords.find((c) =>
    c.text.toUpperCase() === firstWord || c.text.toUpperCase().includes(firstWord),
  );
  return match || null;
}

// ── Main test ────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== DPI Alignment Test ===\n');

  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });

  const testPdfBytes = await createTestPdf();
  writeFileSync(`${TEST_DIR}/test-input.pdf`, testPdfBytes);

  const dpis = [150, 200, 300];
  let allPassed = true;
  const tolerance = 15; // Allow 15pt tolerance for OCR bbox imprecision

  for (const dpi of dpis) {
    console.log(`\n--- Testing at ${dpi} DPI ---`);

    // Render
    const { pngPath, width, height } = await renderPage(testPdfBytes, dpi);
    console.log(`  Rendered: ${width}x${height} px`);

    // OCR
    const words = ocrPage(pngPath);
    console.log(`  OCR: ${words.length} words detected`);

    // Build searchable PDF
    const { pdfBytes, overlayCoords } = await buildSearchablePdf(
      testPdfBytes, words, width, height, dpi,
    );
    writeFileSync(`${TEST_DIR}/output-${dpi}dpi.pdf`, pdfBytes);

    // Verify page height matches
    const expectedPageHeight = 792; // Letter height in points
    const computedPageHeight = height * 72 / dpi;
    const heightDiff = Math.abs(computedPageHeight - expectedPageHeight);
    const heightOk = heightDiff < 1;
    console.log(`  Page height: computed=${computedPageHeight.toFixed(1)}pt expected=${expectedPageHeight}pt ${heightOk ? 'OK' : 'MISMATCH'}`);
    if (!heightOk) allPassed = false;

    // Verify each known text item's overlay position
    for (const known of KNOWN_ITEMS) {
      const overlay = findOverlayForText(overlayCoords, known.text);
      if (!overlay) {
        console.log(`  [FAIL] "${known.text}" — not found in OCR output`);
        allPassed = false;
        continue;
      }

      const dx = Math.abs(overlay.x - known.x);
      const dy = Math.abs(overlay.y - known.y);
      const ok = dx < tolerance && dy < tolerance;

      console.log(
        `  [${ok ? 'PASS' : 'FAIL'}] "${known.text}" — ` +
          `expected (${known.x}, ${known.y}), got (${overlay.x.toFixed(1)}, ${overlay.y.toFixed(1)}), ` +
          `delta (${dx.toFixed(1)}, ${dy.toFixed(1)})`
      );
      if (!ok) allPassed = false;
    }
  }

  // ── A4 page size test ──────────────────────────────────────────────
  console.log('\n--- Testing with A4 page size (595 x 842 pt) at 150 DPI ---');
  {
    const a4Pdf = await PDFDocument.create();
    const a4Font = await a4Pdf.embedFont(StandardFonts.Helvetica);
    const a4Page = a4Pdf.addPage([595, 842]); // A4
    a4Page.drawText('HEADER TEXT', { x: 50, y: 790, size: 20, font: a4Font, color: rgb(0, 0, 0) });
    a4Page.drawText('FOOTER TEXT', { x: 50, y: 50, size: 20, font: a4Font, color: rgb(0, 0, 0) });
    const a4Bytes = await a4Pdf.save();
    writeFileSync(`${TEST_DIR}/test-a4.pdf`, a4Bytes);

    const a4Rendered = await renderPage(a4Bytes, 150);
    console.log(`  Rendered: ${a4Rendered.width}x${a4Rendered.height} px`);
    const a4Words = ocrPage(a4Rendered.pngPath);
    console.log(`  OCR: ${a4Words.length} words`);

    const a4Result = await buildSearchablePdf(a4Bytes, a4Words, a4Rendered.width, a4Rendered.height, 150);
    writeFileSync(`${TEST_DIR}/output-a4.pdf`, a4Result.pdfBytes);

    const computedH = a4Rendered.height * 72 / 150;
    console.log(`  Page height: computed=${computedH.toFixed(1)}pt expected=842pt`);

    const topOverlay = findOverlayForText(a4Result.overlayCoords, 'HEADER TEXT');
    const bottomOverlay = findOverlayForText(a4Result.overlayCoords, 'FOOTER TEXT');

    if (topOverlay) {
      const ok = Math.abs(topOverlay.x - 50) < tolerance && Math.abs(topOverlay.y - 790) < tolerance;
      console.log(`  [${ok ? 'PASS' : 'FAIL'}] "HEADER" — expected (50, 790), got (${topOverlay.x.toFixed(1)}, ${topOverlay.y.toFixed(1)})`);
      if (!ok) allPassed = false;
    } else { console.log('  [FAIL] "HEADER" not found'); allPassed = false; }

    if (bottomOverlay) {
      const ok = Math.abs(bottomOverlay.x - 50) < tolerance && Math.abs(bottomOverlay.y - 50) < tolerance;
      console.log(`  [${ok ? 'PASS' : 'FAIL'}] "FOOTER" — expected (50, 50), got (${bottomOverlay.x.toFixed(1)}, ${bottomOverlay.y.toFixed(1)})`);
      if (!ok) allPassed = false;
    } else { console.log('  [FAIL] "FOOTER" not found'); allPassed = false; }
  }

  console.log(`\n=== ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'} ===\n`);
  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
