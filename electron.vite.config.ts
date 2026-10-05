import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// PDF.js loads image decoders by their fixed filenames at runtime. Keep those
// names when Vite emits the assets, otherwise `wasmUrl` cannot point PDF.js at
// a usable directory in the packaged Electron app.
const pdfjsWasmAssets = new Set([
  'jbig2.wasm',
  'jbig2_nowasm_fallback.js',
  'openjpeg.wasm',
  'openjpeg_nowasm_fallback.js',
  'qcms_bg.wasm',
  'quickjs-eval.js',
  'quickjs-eval.wasm'
])

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          assetFileNames: (asset) =>
            pdfjsWasmAssets.has(asset.name ?? '')
              ? 'assets/pdfjs-wasm/[name][extname]'
              : 'assets/[name]-[hash][extname]'
        }
      }
    }
  }
})
