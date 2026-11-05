import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
await build({ entryPoints: [`${root}src/preview.js`], bundle: true, outfile: `${root}artifacts/preview.js`, format: 'esm', logLevel: 'warning' });
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png' };
http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (!/^\/[\w./-]*$/.test(path) || path.includes('..')) { res.writeHead(400).end(); return; }
  try {
    const file = path === '/preview.js' ? `${root}artifacts/preview.js` : `${root}dist${path === '/' ? '/popup.html' : path}`;
    let data = await readFile(file);
    if (file.endsWith('popup.html')) data = Buffer.from(data.toString().replace('src="popup.js"', 'src="/preview.js"'));
    res.writeHead(200, { 'Content-Type': types[file.split('.').pop()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(43817, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:43817 (synthetic data only)'));
