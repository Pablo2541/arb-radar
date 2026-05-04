import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function serveFile(filePath, res) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath);
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let filePath = url.pathname;

    // API route: /api/dolar → proxy to dolarapi.com
    if (filePath === '/api/dolar') {
      try {
        const apiRes = await fetch('https://dolarapi.com/v1/dolares', {
          signal: AbortSignal.timeout(10000),
        });
        if (!apiRes.ok) throw new Error(`API returned ${apiRes.status}`);
        const data = await apiRes.json();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' });
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: true, message: err.message || 'Failed to fetch' }));
      }
      return;
    }

    // Static chunks: /_next/static/* → .next/static/*
    if (filePath.startsWith('/_next/static/')) {
      const diskPath = path.join(__dirname, '.next', 'static', filePath.replace('/_next/static/', ''));
      if (serveFile(diskPath, res)) return;
    }

    // Build ID-based paths: /_next/BUILD_ID/* 
    if (filePath.startsWith('/_next/') && !filePath.startsWith('/_next/static/')) {
      // Try .next/server first, then .next root
      const relativePath = filePath.replace('/_next/', '');
      const diskPath1 = path.join(__dirname, '.next', relativePath);
      const diskPath2 = path.join(__dirname, '.next', 'server', relativePath);
      if (serveFile(diskPath1, res)) return;
      if (serveFile(diskPath2, res)) return;
    }

    // Public folder files
    if (filePath !== '/') {
      const publicPath = path.join(__dirname, 'public', filePath);
      if (serveFile(publicPath, res)) return;
    }

    // SPA fallback: serve the pre-rendered index.html
    const indexPath = path.join(__dirname, '.next', 'server', 'app', 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Custom lightweight server running on http://0.0.0.0:${PORT}`);
  console.log(`Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
});
