/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), '.'),
      },
    },
    test: {
      environment: 'node',
      include: ['**/*.test.ts'],
    },
    server: {
      // HMR stays off -- an AI Studio leftover, where agent edits made the page flicker.
      hmr: false,
      watch: {
        ignored: ['**/health.db*'],
      },
    },
  };
});
