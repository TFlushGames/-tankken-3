import { defineConfig } from 'vitest/config';

// base './' – działa zarówno lokalnie, jak i na GitHub Pages pod dowolną nazwą repozytorium.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.ts'] },
});
