/**
 * Offline mode support: pre-fetch and cache Tesseract.js assets
 * (WASM binary, worker script, language data) into the Cache API
 * so the app works without network access.
 */

const CACHE_NAME = 'mrvision-offline';

// Tesseract.js v7 CDN URLs
const WORKER_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@v7.0.0/dist/worker.min.js';

// Core WASM variants — we cache all so the worker can pick the right one at runtime
const CORE_BASE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v7.0.0';
const CORE_VARIANTS = [
  'tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-relaxedsimd.wasm.js',
  'tesseract-core-simd.wasm.js',
  'tesseract-core.wasm.js',
];

// Language data URL pattern (LSTM best_int model, gzipped)
function langDataUrl(lang: string): string {
  return `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`;
}

export interface CacheStatus {
  worker: boolean;
  core: boolean;
  langData: boolean;
}

export async function getCacheStatus(language: string): Promise<CacheStatus> {
  try {
    const cache = await caches.open(CACHE_NAME);

    const workerMatch = await cache.match(WORKER_URL);

    // Check if at least one core variant is cached
    let coreMatch = false;
    for (const variant of CORE_VARIANTS) {
      if (await cache.match(`${CORE_BASE}/${variant}`)) {
        coreMatch = true;
        break;
      }
    }

    const langMatch = await cache.match(langDataUrl(language));

    return {
      worker: !!workerMatch,
      core: coreMatch,
      langData: !!langMatch,
    };
  } catch {
    return { worker: false, core: false, langData: false };
  }
}

export async function prefetchAssets(
  language: string,
  onProgress: (completed: number, total: number) => void,
): Promise<void> {
  const cache = await caches.open(CACHE_NAME);

  // Build URL list: worker + core variants + language data
  const urls = [
    WORKER_URL,
    ...CORE_VARIANTS.map((v) => `${CORE_BASE}/${v}`),
    langDataUrl(language),
  ];

  const total = urls.length;
  let completed = 0;

  // Fetch and cache each URL (skip if already cached)
  for (const url of urls) {
    const existing = await cache.match(url);
    if (!existing) {
      const response = await fetch(url);
      if (response.ok) {
        await cache.put(url, response);
      }
      // Non-ok responses for optional WASM variants are expected
      // (e.g., relaxed-simd may not exist on all CDN mirrors)
    }
    completed++;
    onProgress(completed, total);
  }
}

export async function clearCache(): Promise<void> {
  await caches.delete(CACHE_NAME);
}

export function isCacheApiAvailable(): boolean {
  return typeof caches !== 'undefined';
}
