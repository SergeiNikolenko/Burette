import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { ketcherRaphaelImportShimPlugin } from '../desktop/vite/build-plugins'

export default defineConfig({
  base: './',
  plugins: [react(), tailwind(), ketcherRaphaelImportShimPlugin()],
  define: { global: 'globalThis', process: JSON.stringify({ env: {} }), 'process.env': '{}' },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      input: { index: fileURLToPath(new URL('./index.html', import.meta.url)), formats: fileURLToPath(new URL('./src/formats.ts', import.meta.url)) },
      output: { entryFileNames: chunk => chunk.name === 'formats' ? 'molecular-formats.js' : 'assets/[name]-[hash].js' },
    },
  },
})
