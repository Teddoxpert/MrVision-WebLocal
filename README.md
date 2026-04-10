# MrVision WebLocal

Client-side OCR for images and PDFs. Runs entirely in your browser — files never leave your device.

## Features

- **Image OCR** — drop an image, get extracted text
- **PDF OCR** — drop a scanned PDF, get a searchable/selectable PDF back
- **Parallel processing** — uses all CPU cores via Web Workers (desktop)
- **Mobile support** — memory-safe single-page processing on iPhone/iPad/Android
- **Dark/light theme**
- **No server required** — everything runs locally in your browser

## Tech Stack

- [Tesseract.js](https://github.com/naptha/tesseract.js) — WebAssembly OCR engine
- [pdf.js](https://mozilla.github.io/pdf.js/) — PDF rendering
- [pdf-lib](https://pdf-lib.js.org/) — searchable PDF assembly with invisible text overlay
- [Vite](https://vite.dev/) + TypeScript

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173/MrVision-WebLocal/` in your browser.

## Build & Deploy

```bash
npm run build    # outputs to dist/
npm run preview  # preview production build locally
```

Deployed automatically to GitHub Pages via `.github/workflows/deploy.yml`.

## Next Steps

- **Offline / airplane mode support** — add a "Download all required files" button that pre-fetches and caches the Tesseract WASM binary (~4MB) and language trained data (~4MB per language) into the browser's Cache API or IndexedDB. Once cached, the app would work fully offline with no network access. Currently these files are loaded on-demand from the jsDelivr CDN on first use.

- **GPU-accelerated image preprocessing** — use WebGPU compute shaders for grayscale conversion, contrast enhancement, and adaptive thresholding before OCR. A WGSL shader module (`src/core/gpu-preprocess.ts`) is already written but not yet integrated into the pipeline.

- **Adaptive parallelism based on device capabilities** — instead of the current binary mobile/desktop detection, dynamically determine how many pages to process in parallel based on available memory (`navigator.deviceMemory`), CPU cores (`navigator.hardwareConcurrency`), and device type. Devices with more RAM could handle 2-3 pages in flight while constrained devices stay at 1.

- **WebNN / Neural Engine support** — when browser support matures (currently Windows-only via Chrome/Edge), route OCR inference to NPU hardware via the WebNN API for significant speedup. The hardware detection module (`src/core/hardware.ts`) is already in place.
