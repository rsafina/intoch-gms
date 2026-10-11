const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {html,root}=require('./demo-session-fixture.cjs');
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});return res.end(html());}
 const relative=decodeURIComponent(url.pathname).slice(1),file=path.resolve(root,relative);
 if(!file.startsWith(root+path.sep)||!['js/','css/','assets/'].some(prefix=>relative.startsWith(prefix))||!fs.existsSync(file)){res.writeHead(404);return res.end();}
 const types={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
}).listen(8080,'127.0.0.1',()=>console.log('Backend-free one-hour demo fixture: http://127.0.0.1:8080/?demo=1'));
