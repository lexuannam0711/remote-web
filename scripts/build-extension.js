#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const defaults = { src: ['https://pages.fm/*', 'https://pancake.vn/*', 'https://*.pages.fm/*', 'https://*.pancake.vn/*'], dashboard: ['http://localhost:8787/*', 'http://127.0.0.1:8787/*', 'https://pancake.xnampersonal.id.vn/*'] };
const values = { src: [], dashboard: [] };
let out = path.join(root, 'extensions/pancake-bot');
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--(src|dashboard)=(.+)$/);
  if (arg.startsWith('--out=')) { out = path.resolve(arg.slice(6)); continue; }
  if (!match) throw new Error(`Unknown flag: ${arg}`);
  const value = match[2];
  if (!/^https?:\/\/(?:\*\.)?[a-z\d](?:[a-z\d.-]*[a-z\d])?(?::\d{1,5})?\/\*$/i.test(value)) throw new Error(`Invalid match: ${value}`);
  const parsed = new URL(value.replace('://*.', '://'));
  if (parsed.hostname.includes('..')) throw new Error(`Invalid match: ${value}`);
  values[match[1]].push(value);
}
const hosts = { src: values.src.length ? values.src : defaults.src, dashboard: values.dashboard.length ? values.dashboard : defaults.dashboard };
const files = [];
function write(file, data) { const target = path.join(out, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data); files.push(file); }
for (const file of ['pancakeDom.js', 'automation.js', 'pancakeUrlPolicy.js']) write(`vendor/${file}`, fs.readFileSync(path.join(root, 'src/renderer', file)));
const manifest = { manifest_version: 3, name: 'Pancake Bot Bridge', version: '1.0.0', action: { default_popup: 'popup.html' }, permissions: ['storage', 'tabs'], host_permissions: [...hosts.src, ...hosts.dashboard], background: { service_worker: 'background.js' }, content_scripts: [{ matches: hosts.src, js: ['vendor/pancakeUrlPolicy.js', 'vendor/pancakeDom.js', 'vendor/automation.js', 'pancake-bridge.js'], run_at: 'document_end' }, { matches: hosts.dashboard, js: ['dashboard-bridge.js'], run_at: 'document_end' }] };
write('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
const sourceDir = path.join(root, 'extensions/pancake-bot');
for (const file of ['pancake-bridge.js', 'background.js', 'dashboard-bridge.js', 'popup.html', 'popup.js']) write(file, fs.readFileSync(path.join(sourceDir, file)));
console.table(files.map((file) => ({ file: path.join(out, file) })));
