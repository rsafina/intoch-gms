// Local read-only fixture server. Does not serve config, credentials, SQL or live data.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { html, root } = require('./demo-tour-fixture.cjs');
const online = process.argv.includes('--online') ? require('./demo-booking-fixture.cjs') : null;
const types = {'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const server = http.createServer((request,response) => {
  const pathname = new URL(request.url,'http://127.0.0.1').pathname;
  if(online && ['/reserve.html','/reservation-created.html'].includes(pathname)) {
    response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});response.end(pathname==='/reserve.html'?online.formHtml():online.createdHtml());return;
  }
  if(pathname==='/' || pathname==='/__demo-tour-fixture') {
    response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});response.end(online?online.staffHtml():html());return;
  }
  const allowed = /^\/(css\/[^/]+\.css|js\/(demo|demo-tour|demo-tour-environment|demo-booking-tour)\.js|assets\/(?:vendor\/driverjs\/1\.9\.0\/[^/]+|[^.][^]*\.(?:svg|png|webp)))$/.test(pathname);
  const file = path.resolve(root,'.'+decodeURIComponent(pathname));
  if(!allowed || !file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404);response.end();return;
  }
  response.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain','Cache-Control':'no-store'});
  fs.createReadStream(file).pipe(response);
});
if(require.main===module) server.listen(8080,'127.0.0.1',()=>console.log('Backend-free tour fixture: http://127.0.0.1:8080/__demo-tour-fixture'));
module.exports = server;
