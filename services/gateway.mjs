import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { call, post, defaults, fail, body, json, url, ports, basePort, host } from './common.mjs';
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
const limits=new Map();
const server=createServer(async(req,res)=>{try {
  const u=new URL(req.url,'http://local'),path=u.pathname;
  const allowedHosts=[`localhost:${ports.gateway+basePort}`,`127.0.0.1:${ports.gateway+basePort}`];
  if (!allowedHosts.includes(req.headers.host)) fail(403,'Use the localhost URL');
  if (req.headers.origin && !allowedHosts.some(h=>req.headers.origin===`http://${h}`)) fail(403,'Cross-origin requests are disabled');
  if (req.method==='OPTIONS') return json(res,200,{});
  if (path==='/api/lab/status' && req.method==='GET') {
    const services=await Promise.all(['broker','identity','catalog','orders','inventory','payments'].map(async name=>{try{return await call(name,'/health');}catch{return {service:name,status:'unavailable'};}}));
    return json(res,200,{transport:process.env.EVENT_TRANSPORT || 'local',services});
  }
  if (path==='/api/lab/config') {
    if (!['GET','POST'].includes(req.method)) fail(405,'Method not allowed');
    return json(res,200,await call('broker','/config',req.method==='POST'?post(await body(req)):{}));
  }
  if (path==='/api/lab/events' && req.method==='GET') return json(res,200,await call('broker','/recent'));
  if (path==='/api/lab/defaults' && req.method==='POST') return json(res,200,await call('broker','/config',post(defaults)));
  if (path==='/api/openapi.json' && req.method==='GET') {res.writeHead(200,{'Content-Type':'application/json'});return res.end(await readFile(new URL('../docs/openapi.json',import.meta.url)));}
  if (path.startsWith('/api/')) {
    const config=await call('broker','/config');
    if (config.apiDelay) await new Promise(r=>setTimeout(r,config.apiDelay));
    if (config.rateLimit) {
      const key=req.headers.authorization || req.socket.remoteAddress; const now=Date.now(); const entry=limits.get(key) || {start:now,count:0};
      if (now-entry.start>=10000) {entry.start=now;entry.count=0;} entry.count++; limits.set(key,entry);
      if (entry.count>12) {res.setHeader('Retry-After',String(Math.max(1,Math.ceil((10000-(now-entry.start))/1000))));fail(429,'Scenario rate limit: 12 requests per 10 seconds');}
    }
    const service=path.startsWith('/api/auth/')?'identity':path.startsWith('/api/products')?'catalog':path.startsWith('/api/inventory')?'inventory':path.startsWith('/api/payments/')?'payments':(path.startsWith('/api/cart') || path.startsWith('/api/orders'))?'orders':null;
    if (!service) fail(404,'Endpoint not found');
    const input=['GET','HEAD'].includes(req.method)?undefined:JSON.stringify(await body(req));
    const upstream=await fetch(url(service)+req.url,{method:req.method,body:input,headers:{'Content-Type':'application/json',authorization:req.headers.authorization || '','Idempotency-Key':req.headers['idempotency-key'] || ''},signal:AbortSignal.timeout(10000)});
    res.writeHead(upstream.status,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(await upstream.text());
  }
  const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
  if (req.method!=='GET' || !files[path]) fail(404,'Not found');
  const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8'};
  res.writeHead(200,{'Content-Type':types[files[path].split('.').pop()],'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",'Cache-Control':'no-store'});
  res.end(await readFile(publicDir+files[path]));
}catch(e){json(res,e.status || 503,{error:e.status?e.message:'A backend service is unavailable. Check service status.'});}});
server.listen(ports.gateway+basePort,host,()=>console.log(`Storefront ready: ${url('gateway')}`));
