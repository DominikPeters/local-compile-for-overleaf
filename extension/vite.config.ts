import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import commonjs from '@rollup/plugin-commonjs'

export default defineConfig({
  plugins: [
    commonjs({
      include: [
        /overleaf-ce-source\/overleaf-main\/libraries\/overleaf-editor-core/,
        /node_modules/,
      ],
      transformMixedEsModules: true,
    }),
  ],
  resolve: {
    alias: {
      'overleaf-editor-core': resolve(__dirname, 'src/vendor/overleaf-editor-core.ts'),
      'overleaf-editor-core-source': resolve(
        __dirname,
        '../overleaf-ce-source/overleaf-main/libraries/overleaf-editor-core/index.js'
      ),
      '@overleaf/o-error': resolve(__dirname, 'src/vendor/o-error.cjs'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        content: resolve(__dirname, 'src/content.ts'),
        'page-shim': resolve(__dirname, 'src/page-shim.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
})
