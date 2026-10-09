const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'extensions/pancake-bot');
const vendor = ['pancakeDom.js', 'automation.js', 'pancakeUrlPolicy.js'];
const scripts = ['background.js', 'pancake-bridge.js', 'dashboard-bridge.js', 'popup.js'];
const src = ['https://pages.fm/*', 'https://pancake.vn/*', 'https://*.pages.fm/*', 'https://*.pancake.vn/*'];
const dashboard = ['http://localhost:8787/*', 'http://127.0.0.1:8787/*'];

function build(t, args = []) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'pdb-extension-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/build-extension.js'), `--out=${output}`, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { output, manifest: JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8')) };
}

test('MV3 build copies bytes, scopes hosts, packages popup and syntax-valid scripts', (t) => {
  const { output, manifest } = build(t);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.deepEqual(manifest.permissions, ['storage', 'tabs']);
  assert.deepEqual(manifest.host_permissions, [...src, ...dashboard]);
  assert.ok(!manifest.host_permissions.includes('<all_urls>'));
  assert.deepEqual(manifest.content_scripts[0].js, ['vendor/pancakeUrlPolicy.js', 'vendor/pancakeDom.js', 'vendor/automation.js', 'pancake-bridge.js']);
  assert.equal(manifest.content_scripts[0].run_at, 'document_end');
  assert.deepEqual(manifest.content_scripts[1].js, ['dashboard-bridge.js']);
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.ok(fs.readFileSync(path.join(output, 'popup.html'), 'utf8').includes('popup.js'));
  for (const file of vendor) assert.deepEqual(fs.readFileSync(path.join(output, 'vendor', file)), fs.readFileSync(path.join(root, 'src/renderer', file)));
  for (const file of scripts) {
    const result = spawnSync(process.execPath, ['--check', path.join(output, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('repeated flags replace defaults, reject broad or malformed hosts', (t) => {
  const { manifest } = build(t, ['--src=https://pages.fm/*', '--src=https://pancake.vn/*', '--dashboard=https://dashboard.example/*']);
  assert.deepEqual(manifest.content_scripts[0].matches, src.slice(0, 2));
  assert.deepEqual(manifest.content_scripts[1].matches, ['https://dashboard.example/*']);
  for (const flag of ['--src=<all_urls>', '--dashboard=https://*/*', '--src=https://user:pass@pages.fm/*', '--src=javascript:alert(1)', '--typo=x']) {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/build-extension.js'), flag], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, flag);
  }
});

function load(file, context) {
  vm.runInNewContext(fs.readFileSync(path.join(extension, file), 'utf8'), context, { filename: path.join(extension, file) });
}

test('Pancake bridge guards injection, allows own functions, returns async results and errors', async () => {
  let listener;
  const sent = [];
  const window = { __PDB__: { getDomStatus: async (value) => value, getDomHealth: () => { throw Object.assign(new Error('broken'), { code: 'DOM_DEGRADED' }); } } };
  const context = { window, location: { href: 'https://pages.fm/' }, chrome: { runtime: { sendMessage: async (m) => sent.push(m), onMessage: { addListener: (fn) => { listener = fn; } } } } };
  load('pancake-bridge.js', context);
  load('pancake-bridge.js', context);
  assert.equal(sent.length, 1);
  async function call(method, args) {
    return new Promise((resolve) => assert.equal(listener({ type: 'pdb-call', callId: 'c1', method, args }, {}, resolve), true));
  }
  assert.equal((await call('getDomStatus', ['ready'])).data, 'ready');
  assert.equal((await call('getDomHealth')).error.code, 'DOM_DEGRADED');
  assert.equal((await call('toString')).error.code, 'METHOD_NOT_ALLOWED');
  assert.equal((await call('getDomStatus', 'bad')).error.code, 'INVALID_CALL');
});

function background() {
  let listener, removed, updated;
  let state = {};
  const sent = [];
  const local = { bridgeEnabled: true };
  const transport = { fail: false };
  const created = [];
  const chrome = {
    runtime: { getURL: (file) => `chrome-extension://extension/${file}`, getManifest: () => ({ content_scripts: [{ matches: src }, { matches: dashboard }] }), onMessage: { addListener: (fn) => { listener = fn; } } },
    storage: { local: { get: async () => local, set: async (value) => Object.assign(local, value) }, session: { get: async () => state, set: async (value) => { state = value; } } },
    tabs: { create: async (options) => { created.push(options); return { id: 20 }; }, sendMessage: async (id, message) => { sent.push({ id, message }); if (transport.fail) throw new Error('No receiver'); return { type: 'pdb-result', callId: message.callId, ok: true, data: 'result' }; }, onRemoved: { addListener: (fn) => { removed = fn; } }, onUpdated: { addListener: (fn) => { updated = fn; } } }
  };
  function restart() { load('background.js', { chrome, URL, Date, Map, Set }); }
  restart();
  const call = (message, id, url, frameId = 0) => new Promise((resolve) => assert.equal(listener(message, { id: 'extension', ...(id === undefined ? {} : { tab: { id } }), url, frameId }, resolve), true));
  return { call, sent, restart, remove: async (id) => removed(id), update: async (id, changeInfo, tab) => updated(id, changeInfo, tab), local, transport, created };
}

test('background slots: limit, relay, trusted senders, release, restart and toggle', async () => {
  const bg = background();
  const hello = (id) => bg.call({ type: 'tab-hello', url: 'https://pages.fm/chat' }, id, 'https://pages.fm/chat');
  assert.equal((await hello(1)).slot, 'bot1');
  assert.equal((await hello(1)).slot, 'bot1');
  assert.equal((await hello(2)).slot, 'bot2');
  assert.equal((await hello(3)).slot, 'manual');
  assert.equal((await hello(4)).error.code, 'SLOT_FULL');
  await bg.call({ type: 'dashboard-hello' }, 10, 'http://localhost:8787/');
  const request = { type: 'pdb-call', slot: 'bot1', callId: 'x', method: 'getDomStatus', args: [] };
  assert.equal((await bg.call(request, 10, 'http://localhost:8787/')).data, 'result');
  assert.equal((await bg.call(request, 11, 'https://evil.example/')).error.code, 'UNTRUSTED_SENDER');
  assert.equal((await bg.call({ type: 'tab-hello' }, 12, 'https://pages.fm.evil.example/')).error.code, 'UNTRUSTED_SENDER');
  bg.restart();
  assert.equal((await bg.call({ type: 'get-slots' }, 10, 'http://localhost:8787/')).slots.length, 3);
  await bg.remove(1);
  assert.equal((await bg.call(request, 10, 'http://localhost:8787/')).error.code, 'NO_TAB');
  assert.equal((await hello(4)).slot, 'bot1');
  bg.local.bridgeEnabled = false;
  assert.equal((await bg.call(request, 10, 'http://localhost:8787/')).error.code, 'BRIDGE_DISABLED');
  assert.ok(bg.sent.some(({ id, message }) => id === 10 && message.type === 'slots-changed'));
});

test('tab navigating off Pancake releases its slot; staying on Pancake keeps it (T5b MAJOR)', async () => {
  const bg = background();
  assert.equal((await bg.call({ type: 'tab-hello', url: 'https://pages.fm/chat' }, 1, 'https://pages.fm/chat')).slot, 'bot1');
  await bg.call({ type: 'dashboard-hello' }, 10, 'http://localhost:8787/');
  // Reload on a Pancake URL: slot survives.
  await bg.update(1, { status: 'complete', url: 'https://pancake.vn/multi_pages' }, { url: 'https://pancake.vn/multi_pages' });
  assert.equal((await bg.call({ type: 'get-slots' }, 10, 'http://localhost:8787/')).slots[0].connected, true);
  // Navigate to an unrelated site: slot must be released.
  await bg.update(1, { url: 'https://evil.example/' }, { url: 'https://evil.example/' });
  const slots = (await bg.call({ type: 'get-slots' }, 10, 'http://localhost:8787/')).slots;
  assert.equal(slots[0].connected, false);
  const request = { type: 'pdb-call', slot: 'bot1', callId: 'x', method: 'getDomStatus', args: [] };
  assert.equal((await bg.call(request, 10, 'http://localhost:8787/')).error.code, 'NO_TAB');
  // A fresh Pancake tab takes the freed bot1 slot again.
  assert.equal((await bg.call({ type: 'tab-hello', url: 'https://pages.fm/' }, 2, 'https://pages.fm/')).slot, 'bot1');
  // Unknown tab updates are ignored.
  await bg.update(99, { url: 'https://evil.example/' }, {});
});

test('dashboard bridge enforces the method whitelist as a third layer (T5b MAJOR)', async () => {
  let pageListener;
  const posts = [], sent = [];
  const window = { location: { origin: 'http://localhost:8787' }, addEventListener: (name, fn) => { pageListener = fn; }, postMessage: (message, origin) => posts.push({ message, origin }) };
  const chrome = { runtime: { sendMessage: async (message) => { sent.push(message); return { ok: true, callId: message.callId, data: 42, slots: [] }; }, onMessage: { addListener() {} } } };
  load('dashboard-bridge.js', { window, chrome });
  await new Promise(setImmediate);
  await pageListener({ source: window, origin: window.location.origin, data: { source: 'pdb-page', type: 'pdb-call', callId: 'bad', slot: 'bot1', method: 'constructor', args: [] } });
  const denied = posts.at(-1).message;
  assert.equal(denied.type, 'pdb-result');
  assert.equal(denied.callId, 'bad');
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'METHOD_NOT_ALLOWED');
  assert.equal(sent.length, 1); // only dashboard-hello reached the background
  await pageListener({ source: window, origin: window.location.origin, data: { source: 'pdb-page', type: 'pdb-call', callId: 'good', slot: 'bot1', method: 'getDomStatus', args: [] } });
  assert.equal(sent.length, 2);
  assert.equal(posts.at(-1).message.data, 42);
});

test('pancake bridge reports a non-empty error code and bounded message (T5b MAJOR)', async () => {
  let listener;
  const window = { __PDB__: {
    getDomStatus: () => { throw new Error(`plain failure ${'x'.repeat(500)}`); },
    getDomHealth: async () => { throw Object.assign(new Error('stale'), { code: 'STALE_CONVERSATION' }); }
  } };
  const context = { window, location: { href: 'https://pages.fm/' }, chrome: { runtime: { sendMessage: async () => ({}), onMessage: { addListener: (fn) => { listener = fn; } } } } };
  load('pancake-bridge.js', context);
  const call = (method) => new Promise((resolve) => listener({ type: 'pdb-call', callId: 'c', method, args: [] }, {}, resolve));
  const plain = await call('getDomStatus');
  assert.equal(plain.error.code, 'BRIDGE_ERROR');
  assert.ok(plain.error.message.length <= 200);
  assert.match(plain.error.message, /plain failure/);
  assert.equal((await call('getDomHealth')).error.code, 'STALE_CONVERSATION');
});

test('dashboard bridge frames same-window requests and broadcasts ready/slots', async () => {
  let pageListener, runtimeListener;
  const posts = [], sent = [];
  const window = { location: { origin: 'http://localhost:8787' }, addEventListener: (name, fn) => { pageListener = fn; }, postMessage: (message, origin) => posts.push({ message, origin }) };
  const chrome = { runtime: { sendMessage: async (message) => { sent.push(message); return { ok: true, callId: message.callId, data: 42, slots: [] }; }, onMessage: { addListener: (fn) => { runtimeListener = fn; } } } };
  load('dashboard-bridge.js', { window, chrome });
  await new Promise(setImmediate);
  assert.ok(posts.some(({ message }) => message.type === 'bridge-ready'));
  await pageListener({ source: {}, data: { source: 'pdb-page', type: 'pdb-call' } });
  assert.equal(sent.length, 1);
  await pageListener({ source: window, origin: window.location.origin, data: { source: 'pdb-page', type: 'pdb-call', callId: 'c', slot: 'bot1', method: 'getDomStatus', args: [] } });
  assert.equal(posts.at(-1).message.data, 42);
  assert.equal(posts.at(-1).origin, window.location.origin);
  runtimeListener({ type: 'slots-changed', slots: [{ slot: 'bot1', tabId: 1 }] });
  assert.equal(posts.at(-1).message.type, 'slots-changed');
  await pageListener({ source: window, origin: window.location.origin, data: { source: 'pdb-page', type: 'bridge-ping' } });
  assert.equal(posts.at(-1).message.type, 'bridge-pong');
  await pageListener({ source: window, origin: window.location.origin, data: { source: 'pdb-page', type: 'get-slots' } });
  assert.equal(posts.at(-1).message.type, 'slots-changed');
  const count = sent.length;
  await pageListener({ source: window, origin: 'https://evil.example', data: { source: 'pdb-page', type: 'pdb-call' } });
  await pageListener({ source: window, origin: window.location.origin, data: { source: 'pdb-page', type: 'eval' } });
  assert.equal(sent.length, count);
});

test('background rejects invalid calls without relay; exposes slot status, ping and safe open', async () => {
  const bg = background();
  const url = 'http://localhost:8787/';
  const request = { type: 'pdb-call', callId: 'x', slot: 'bot1', method: 'getDomStatus', args: [] };
  const ping = await bg.call({ type: 'bridge-ping' }, 10, url);
  assert.equal(ping.type, 'bridge-pong');
  assert.ok(ping.slots.every((slot) => slot.connected === false));
  assert.equal((await bg.call(request, 10, url, 1)).error.code, 'UNTRUSTED_SENDER');
  assert.equal((await bg.call({ ...request, method: 'toString' }, 10, url)).error.code, 'METHOD_NOT_ALLOWED');
  assert.equal((await bg.call({ ...request, args: 'code' }, 10, url)).error.code, 'INVALID_CALL');
  assert.equal((await bg.call({ ...request, callId: '' }, 10, url)).error.code, 'INVALID_CALL');
  assert.equal((await bg.call({ type: 'evil' }, 10, url)).error.code, 'INVALID_CALL');
  assert.equal((await bg.call({ type: 'get-slots' }, undefined, 'chrome-extension://extension/popup.html')).ok, true);
  bg.local.pancakeUrl = 'https://evil.example/';
  assert.equal((await bg.call({ type: 'open-pancake-tab' }, 10, url)).error.code, 'INVALID_URL');
  assert.equal(bg.created.length, 0);
  bg.local.pancakeUrl = 'https://pages.fm/';
  assert.equal((await bg.call({ type: 'open-pancake-tab' }, 10, url)).tabId, 20);
  await bg.call({ type: 'tab-hello' }, 1, 'https://shop.pages.fm/chat');
  bg.transport.fail = true;
  assert.equal((await bg.call(request, 10, url)).error.code, 'NAVIGATION');
});

test('whitelists accept every function in the actual desktop __PDB__ API', async () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/renderer/automation.js'), 'utf8'), { window });
  const names = Object.keys(window.__PDB__);
  const bg = background();
  await bg.call({ type: 'tab-hello' }, 1, 'https://pages.fm/');
  let listener;
  window.__PDB__ = Object.fromEntries(names.map((name) => [name, () => name]));
  load('pancake-bridge.js', { window, location: { href: 'https://pages.fm/' }, chrome: { runtime: { sendMessage: async () => ({}), onMessage: { addListener: (fn) => { listener = fn; } } } } });
  for (const method of names) {
    const request = { type: 'pdb-call', callId: 'x', slot: 'bot1', method, args: [] };
    const result = await new Promise((resolve) => listener(request, {}, resolve));
    assert.equal(result.data, method);
    assert.equal((await bg.call(request, 10, 'http://localhost:8787/')).ok, true, method);
  }
});

test('popup displays URLs as text, toggles storage and opens through background', async () => {
  const elements = {};
  for (const id of ['slots', 'toggle', 'open', 'status']) elements[id] = { textContent: '', setAttribute() {}, replaceChildren(...children) { this.children = children; }, addEventListener(type, fn) { this.click = fn; } };
  const document = { getElementById: (id) => elements[id], createElement: () => ({ textContent: '' }) };
  const settings = { bridgeEnabled: true };
  const requests = [];
  const chrome = { storage: { local: { get: async () => settings, set: async (value) => Object.assign(settings, value) } }, runtime: { sendMessage: async (message) => { requests.push(message); return { ok: true, slots: [{ slot: 'bot1', url: 'https://pages.fm/<img>' }, { slot: 'bot2' }, { slot: 'manual' }] }; }, onMessage: { addListener() {} } } };
  load('popup.js', { document, chrome });
  await new Promise(setImmediate);
  assert.equal(elements.slots.children.length, 3);
  assert.equal(elements.slots.children[0].textContent, 'Bot 1: https://pages.fm/<img>');
  await elements.toggle.click();
  assert.equal(settings.bridgeEnabled, false);
  assert.equal(elements.toggle.textContent, 'Bat bridge');
  await elements.open.click();
  assert.equal(requests.at(-1).type, 'open-pancake-tab');
});
