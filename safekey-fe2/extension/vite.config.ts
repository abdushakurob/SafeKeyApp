import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Plugin to copy manifest.json and other extension files
function copyExtensionFilesPlugin() {
  return {
    name: 'copy-extension-files',
    writeBundle() {
      // Copy manifest.json
      const manifestSrc = path.resolve(__dirname, 'public/manifest.json')
      const manifestDest = path.resolve(__dirname, 'dist/manifest.json')
      
      const destDir = path.dirname(manifestDest)
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }
      
      if (fs.existsSync(manifestSrc)) {
        fs.copyFileSync(manifestSrc, manifestDest)
        console.log('✓ Manifest copied to dist/')
      }

      // Copy popup.html to root if it's in a subdirectory
      const popupSrc = path.resolve(__dirname, 'dist/src/popup/popup.html')
      const popupDest = path.resolve(__dirname, 'dist/popup.html')
      if (fs.existsSync(popupSrc) && !fs.existsSync(popupDest)) {
        fs.copyFileSync(popupSrc, popupDest)
        console.log('✓ Popup.html copied to dist/')
      }

      // Copy icons if they exist
      const iconsDir = path.resolve(__dirname, 'public/icons')
      const iconsDest = path.resolve(__dirname, 'dist/icons')
      if (fs.existsSync(iconsDir)) {
        if (!fs.existsSync(iconsDest)) {
          fs.mkdirSync(iconsDest, { recursive: true })
        }
        fs.readdirSync(iconsDir).forEach(file => {
          fs.copyFileSync(
            path.resolve(iconsDir, file),
            path.resolve(iconsDest, file)
          )
        })
        console.log('✓ Icons copied to dist/icons/')
      }
    },
  }
}

export default defineConfig({
  plugins: [copyExtensionFilesPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: path.resolve(__dirname, 'src/background/background.ts'),
        content: path.resolve(__dirname, 'src/content/content.ts'),
        'web-app-bridge': path.resolve(__dirname, 'src/content/web-app-bridge.ts'),
        popup: path.resolve(__dirname, 'src/popup/popup.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'popup.html') {
            return '[name][extname]'
          }
          return '[name].[ext]'
        },
      },
    },
  },
})

