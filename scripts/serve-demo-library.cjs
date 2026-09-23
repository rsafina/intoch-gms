// Local-only preview of the sales routes. No database or build configuration.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const rewrites = fs.readFileSync(path.join(root, '_redirects'), 'utf8').split(/\r?\n/)
  .map(line => line.trim()).filter(line => line && !line.startsWith('#'))
  .map(line => line.split(/\s+/));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end(); return; }
  const rewrite = rewrites.find(([source]) => source.endsWith('*') ? pathname.startsWith(source.slice(0, -1)) : pathname === source);
  if (rewrite) pathname = rewrite[1];
  // Model the host's extension-removal redirect, including rewritten targets.
  if (pathname === '/demo-library.html') {
    response.writeHead(307, { Location: '/demo-library' }).end(); return;
  }
  if (pathname === '/demo-library') pathname = '/demo-library.html';
  if (pathname === '/landing') pathname = '/landing.html';
  const allowed = /^\/(?:demo-library\.html|landing\.html|css\/[\w.-]+\.css|js\/(?:demo-library(?:-data)?|page-loading)\.js|assets\/[\w.-]+)$/;
  if (!allowed.test(pathname)) { response.writeHead(404).end('Not found'); return; }
  fs.readFile(path.join(root, pathname), (error, content) => {
    if (error) { response.writeHead(404).end('Not found'); return; }
    response.writeHead(200, { 'Content-Type': types[path.extname(pathname)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(content);
  });
});
if (require.main === module) server.listen(Number(process.env.DEMO_PORT || 8088), '127.0.0.1', () => console.log('Demo library: http://127.0.0.1:' + server.address().port + '/demo/reactivation'));
module.exports = server;
