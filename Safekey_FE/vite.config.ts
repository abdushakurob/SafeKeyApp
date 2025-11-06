import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Plugin to copy manifest.json and popup.html
function copyExtensionFilesPlugin() {
  return {
    name: 'copy-extension-files',
    writeBundle() {
      // Copy manifest.json
      const manifestSrc = path.resolve(__dirname, 'public/extension/manifest.json')
      const manifestDest = path.resolve(__dirname, 'dist/extension/manifest.json')
      
      const destDir = path.dirname(manifestDest)
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }
      
      fs.copyFileSync(manifestSrc, manifestDest)
      console.log('✓ Manifest copied to dist/extension/')

      // Move popup.html from src/popup/popup.html to dist/extension/popup.html
      const popupSrc = path.resolve(__dirname, 'dist/extension/src/popup/popup.html')
      const popupDest = path.resolve(__dirname, 'dist/extension/popup.html')
      
      if (fs.existsSync(popupSrc)) {
        fs.copyFileSync(popupSrc, popupDest)
        console.log('✓ Popup HTML moved to dist/extension/')
      }

      // Move callback.html from src/popup/callback.html to dist/extension/callback.html
      const callbackSrc = path.resolve(__dirname, 'dist/extension/src/popup/callback.html')
      const callbackDest = path.resolve(__dirname, 'dist/extension/callback.html')
      
      if (fs.existsSync(callbackSrc)) {
        fs.copyFileSync(callbackSrc, callbackDest)
        console.log('✓ Callback HTML moved to dist/extension/')
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isExtension = mode === 'extension'

  if (isExtension) {
    return {
      plugins: [react(), copyExtensionFilesPlugin()],
      build: {
        outDir: 'dist/extension',
        emptyOutDir: true,
        rollupOptions: {
          input: {
            popup: path.resolve(__dirname, 'src/popup/popup.html'),
            callback: path.resolve(__dirname, 'src/popup/callback.html'),
            background: path.resolve(__dirname, 'src/background/background.ts'),
            content: path.resolve(__dirname, 'src/content/content.ts'),
          },
          output: {
            entryFileNames: '[name].js',
            chunkFileNames: '[name].js',
            assetFileNames: '[name].[ext]',
          },
        },
      },
    }
  }

  return {
    plugins: [react()],
    build: {
      outDir: 'dist/web',
      emptyOutDir: true,
    },
  }
})
