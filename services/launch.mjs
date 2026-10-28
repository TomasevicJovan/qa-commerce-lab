import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { url } from './common.mjs';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const children = [];
function stop() { for (const child of children) child.kill(); }
process.on('SIGINT', () => { stop(); process.exit(); }); process.on('SIGTERM', () => { stop(); process.exit(); });
for (const name of ['broker','identity','catalog','orders','inventory','payments','gateway']) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', `services/${name === 'broker' || name === 'gateway' ? name : 'service'}.mjs`], { stdio:'inherit', env:{ ...process.env, SERVICE:name } });
  children.push(child); child.on('exit', code => { if (code) { console.error(`${name} exited with ${code}`); stop(); process.exitCode = code; } });
}
console.log(`\nQA Commerce → ${url('gateway')}\nCtrl+C stops all services.\n`);
