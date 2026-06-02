import { defineConfig } from 'vitest/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import commonjs from '@rollup/plugin-commonjs'

const FIREFOX_EXTENSION_ID = 'local-compile-for-overleaf@dominik-peters.de'

export default defineConfig(({ mode }) => {
  const browserTarget = mode === 'firefox' ? 'firefox' : 'chrome'
  return {
    plugins: [
      commonjs({
        include: [
          /overleaf-ce-source\/overleaf-main\/libraries\/overleaf-editor-core/,
          /node_modules/,
        ],
        transformMixedEsModules: true,
      }),
      manifestVariantPlugin(browserTarget),
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
      outDir: browserTarget === 'firefox' ? 'dist-firefox' : 'dist',
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
  }
})

type BrowserTarget = 'chrome' | 'firefox'

function manifestVariantPlugin(browserTarget: BrowserTarget) {
  return {
    name: 'lcfo-manifest-variant',
    writeBundle(options: { dir?: string }) {
      const outDir =
        options.dir || resolve(__dirname, browserTarget === 'firefox' ? 'dist-firefox' : 'dist')
      const manifestPath = resolve(__dirname, 'public/manifest.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      if (browserTarget === 'firefox') {
        manifest.background = {
          scripts: ['background.js'],
          type: 'module',
        }
        manifest.browser_specific_settings = {
          gecko: {
            id: FIREFOX_EXTENSION_ID,
            strict_min_version: '121.0',
            data_collection_permissions: {
              required: ['websiteContent'],
            },
          },
        }
      }
      writeFileSync(
        resolve(outDir, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`
      )
    },
  }
}
