import { defineConfig } from 'vite';

export default defineConfig({
  base: '/MrVision-WebLocal/',
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
});

