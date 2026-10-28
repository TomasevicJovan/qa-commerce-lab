import { createServer } from 'node:http';
import { database, defaults, body, json, ports, basePort, host, fail } from './common.mjs';
const store = database('broker');
store.db.exec('CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL)');
createServer(async(req,res) => { try {
  const path = new URL(req.url, 'http://local');
  if (path.pathname === '/health') return json(res,200,{status:'ok',service:'broker',transport:process.env.EVENT_TRANSPORT || 'local'});
  if (req.method === 'GET' && path.pathname === '/config') return json(res,200,store.get('config',defaults));
  if (req.method === 'POST' && path.pathname === '/config') {
    const value = await body(req); const config = {...store.get('config',defaults)};
    for (const [key,v] of Object.entries(value)) {
      if (!Object.hasOwn(defaults,key)) fail(400,`Unknown setting ${key}`);
      if (typeof v !== typeof defaults[key]) fail(400,`Invalid type for ${key}`);
      if (typeof v === 'number' && (!Number.isInteger(v) || v < (key === 'sessionSeconds' ? 1 : 0) || v > (key === 'sessionSeconds' ? 86400 : 5000))) fail(400,`Invalid range for ${key}`);
      if (key === 'locatorMode' && !['stable','dynamic'].includes(v)) fail(400,'Invalid locator mode');
      if (key === 'paymentMode' && !['approve','decline','timeout'].includes(v)) fail(400,'Invalid payment mode');
      config[key] = v;
    }
    store.set('config',config); return json(res,200,config);
  }
  if (req.method === 'POST' && path.pathname === '/events') {
    const event = await body(req); if (!event.id || !event.type || !event.orderId) fail(400,'Event id, type and orderId required');
    store.db.prepare('INSERT OR IGNORE INTO events (id,payload) VALUES (?,?)').run(event.id,JSON.stringify(event)); return json(res,202,{accepted:true});
  }
  if (req.method === 'GET' && path.pathname === '/events') {
    const after = Number(path.searchParams.get('after') || 0);
    const rows = store.db.prepare('SELECT seq,payload FROM events WHERE seq>? ORDER BY seq LIMIT 500').all(Number.isFinite(after) ? after : 0);
    return json(res,200,rows.map(r=>({seq:r.seq,...JSON.parse(r.payload)})));
  }
  if (req.method === 'GET' && path.pathname === '/recent') {
    return json(res,200,store.db.prepare('SELECT seq,payload FROM events ORDER BY seq DESC LIMIT 100').all().map(r=>({seq:r.seq,...JSON.parse(r.payload)})));
  }
  json(res,404,{error:'Not found'});
} catch(e) { json(res,e.status || 500,{error:e.message}); } }).listen(ports.broker+basePort,host);
