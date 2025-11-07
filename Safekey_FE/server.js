/**
 * Simple OAuth Callback Server for SafeKey Extension
 * Run with: node server.js
 * Serves http://localhost:3000/callback for Google OAuth redirects
 */

import http from 'http'
import fs from 'fs'
import path from 'path'
import url from 'url'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3000
const CALLBACK_FILE = path.join(__dirname, 'public/callback.html')

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true)
  const pathname = parsedUrl.pathname

  // CORS headers for extension communication
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')

  if (pathname === '/callback' || pathname === '/callback.html') {
    try {
      const html = fs.readFileSync(CALLBACK_FILE, 'utf-8')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      console.log(`[Server] Callback requested: ${req.url}`)
    } catch (error) {
      res.writeHead(500)
      res.end('Error loading callback page: ' + error.message)
    }
  } else if (pathname === '/') {
    res.writeHead(200)
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>SafeKey - OAuth Server</title></head>
        <body style="font-family: sans-serif; padding: 20px;">
          <h1>🔐 SafeKey OAuth Server</h1>
          <p>OAuth callback server running on port ${PORT}</p>
          <p>Add this redirect URI to Google OAuth Console:</p>
          <code style="background: #f0f0f0; padding: 10px; display: block;">
            http://localhost:${PORT}/callback
          </code>
        </body>
      </html>
    `)
  } else {
    res.writeHead(404)
    res.end('Not found')
  }
})

server.listen(PORT, () => {
  console.log(`[Server] SafeKey OAuth callback server listening on http://localhost:${PORT}`)
  console.log(`[Server] Callback URL: http://localhost:${PORT}/callback`)
  console.log(`[Server] Add this to Google OAuth Console redirect URIs`)
})
