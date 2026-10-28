import { renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ports, basePort } from './common.mjs';
import { createConnection } from 'node:net';
const active=await Promise.all(Object.values(ports).map(port=>new Promise(resolve=>{
  const socket=createConnection({host:'127.0.0.1',port:port+basePort});socket.setTimeout(500);
  socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>resolve(false));socket.on('timeout',()=>{socket.destroy();resolve(false);});
})));
if(active.some(Boolean)){console.error('Stop all lab services before resetting. No data changed.');process.exit(1);}
const path=resolve(process.env.DATA_DIR || 'data');
if(existsSync(path)){const backup=`${path}.backup-${Date.now()}`;renameSync(path,backup);console.log(`Existing data preserved in ${backup}`);}else console.log('No local data to reset.');
console.log('Run npm start to seed a fresh laboratory. Docker volumes are managed separately.');
