import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
export const host = process.env.BIND_HOST || '127.0.0.1';
export const ports = { gateway: 3000, broker: 4100, identity: 4101, catalog: 4102, orders: 4103, inventory: 4104, payments: 4105 };
export const basePort = Number(process.env.PORT_OFFSET || 0);
export const url = name => process.env[`${name.toUpperCase()}_URL`] || `http://127.0.0.1:${ports[name] + basePort}`;
export const id = () => randomUUID();
export function database(name) {
  const dir = resolve(process.env.DATA_DIR || 'data'); mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(resolve(dir, `${name}.sqlite`));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  return {
    db,
    get(key, fallback) { const r = db.prepare('SELECT value FROM state WHERE key=?').get(key); return r ? JSON.parse(r.value) : structuredClone(fallback); },
    set(key, value) { db.prepare('INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); },
    transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const out = fn(); db.exec('COMMIT'); return out; } catch(e) { db.exec('ROLLBACK'); throw e; } }
  };
}
export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export async function body(req) {
  let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 100_000) fail(413, 'Request too large'); }
  let value; try { value = text ? JSON.parse(text) : {}; } catch { fail(400, 'Invalid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'JSON object required');
  return value;
}
export function json(res, status, data) { res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store' }); res.end(JSON.stringify(data)); }
export async function call(name, path, options = {}) {
  const response = await fetch(url(name) + path, { ...options, signal: AbortSignal.timeout(8000), headers: { 'Content-Type':'application/json', ...options.headers } });
  const data = await response.json(); if (!response.ok) fail(response.status, data.error || 'Service request failed'); return data;
}
export const post = data => ({ method:'POST', body:JSON.stringify(data) });
export const defaults = { locatorMode:'stable', renderDelay:0, apiDelay:0, paymentMode:'approve', paymentDelay:0, pauseInventory:false, pausePayments:false, duplicateEvents:false, stalePrice:false, rateLimit:false, sessionSeconds:3600 };
export const products = [
  { id:'p1', name:'Arc Wireless Headphones', category:'Audio', price:12900, stock:12, icon:'◉', color:'lavender', description:'Room-filling sound. A little space to yourself.' },
  { id:'p2', name:'Orbit Desk Lamp', category:'Workspace', price:7900, stock:8, icon:'◠', color:'peach', description:'A warmer light for your next bright idea.' },
  { id:'p3', name:'Loop Mechanical Keyboard', category:'Workspace', price:14900, stock:5, icon:'▦', color:'mint', description:'Every keystroke, a small satisfaction.' },
  { id:'p4', name:'Field Everyday Backpack', category:'Travel', price:8900, stock:3, icon:'▣', color:'sand', description:'For the commute and the scenic route.' },
  { id:'p5', name:'Still Ceramic Mug', category:'Home', price:2400, stock:20, icon:'◡', color:'rose', description:'Make a little room for your morning ritual.' },
  { id:'p6', name:'Pocket Mini Speaker', category:'Audio', price:5900, stock:1, icon:'▥', color:'blue', description:'Big enough for the soundtrack. Small enough to go.' },
  { id:'p7', name:'Pebble Desk Clock', category:'Workspace', price:4500, stock:7, icon:'◷', color:'sand', description:'A quieter way to keep time.' },
  { id:'p8', name:'Fold Travel Organizer', category:'Travel', price:3500, stock:9, icon:'▤', color:'mint', description:'A place for the little things.' },
  { id:'p9', name:'Halo Glass Vase', category:'Home', price:6200, stock:4, icon:'♧', color:'lavender', description:'Something special for a single stem.' }
];
