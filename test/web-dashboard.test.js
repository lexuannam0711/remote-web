'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDashboardAdapter } = require('../web/public/adapter.js');

function harness(timeoutMs = 100) {
  const page = {};
  global.window = page;
  let listener;
  let removed = false;
  const sent = [];
  const adapter = createDashboardAdapter({
    timeoutMs,
    postMessage(message) { sent.push(message); },
    addListener(callback) { listener = callback; return () => { removed = true; }; }
  });
  return { adapter, sent, emit(data, source = page) { listener({ source, data }); }, removed: () => removed };
}
const result = (callId, fields) => ({ source: 'pdb-bridge', type: 'pdb-result', callId, ...fields });

test('calls correlate by unique callId, including across adapters', async () => {
  const h = harness();
  const one = h.adapter.call('bot1', 'getUnreadConversations');
  const two = h.adapter.call('bot2', 'setReplyText', ['/1']);
  const other = harness();
  const three = other.adapter.call('manual', 'getDomStatus');
  assert.equal(new Set([...h.sent, ...other.sent].map((m) => m.callId)).size, 3);
  assert.deepEqual(h.sent[1], { source: 'pdb-page', type: 'pdb-call', callId: h.sent[1].callId, slot: 'bot2', method: 'setReplyText', args: ['/1'] });
  h.emit(result(h.sent[1].callId, { ok: true, data: 'second' }));
  h.emit(result(h.sent[0].callId, { ok: true, data: ['first'] }));
  other.emit(result(other.sent[0].callId, { ok: true, data: true }));
  assert.deepEqual(await one, ['first']);
  assert.equal(await two, 'second');
  assert.equal(await three, true);
  h.adapter.destroy(); other.adapter.destroy();
});

test('bridge errors retain code and message', async () => {
  const h = harness();
  const pending = h.adapter.call('bot1', 'clickSendButton');
  h.emit(result(h.sent[0].callId, { ok: false, error: { code: 'DOM_DEGRADED', message: 'Missing send button' } }));
  await assert.rejects(pending, { code: 'DOM_DEGRADED', message: 'Missing send button' });
  h.adapter.destroy();
});

test('call timeout rejects TIMEOUT', async () => {
  const h = harness(1);
  let error;
  const pending = h.adapter.call('bot1', 'getDomStatus').catch((e) => { error = e; });
  while (!error) await new Promise((resolve) => setTimeout(resolve, 1));
  await pending;
  assert.equal(error.code, 'TIMEOUT');
  h.adapter.destroy();
});

test('three disconnected slots initially; updates validated, snapshots isolated', () => {
  const h = harness();
  assert.deepEqual(h.adapter.listSlots(), ['bot1', 'bot2', 'manual'].map((slot) => ({ slot, connected: false, url: '' })));
  let update;
  const unsubscribe = h.adapter.onSlotsChanged((slots) => { update = slots; });
  h.emit({ source: 'pdb-bridge', type: 'slots-changed', slots: [{ slot: 'bot2', connected: true, url: 'https://pages.fm/' }, { slot: 'unknown', connected: true }] });
  assert.deepEqual(h.adapter.listSlots()[1], { slot: 'bot2', connected: true, url: 'https://pages.fm/' });
  update[1].url = 'changed';
  assert.equal(h.adapter.listSlots()[1].url, 'https://pages.fm/');
  unsubscribe(); h.adapter.destroy();
});

test('foreign frames, wrong sources, unknown callIds do not settle calls', async () => {
  const h = harness();
  const pending = h.adapter.call('bot1', 'getDomStatus');
  let settled = false;
  pending.then(() => { settled = true; });
  h.emit(result(h.sent[0].callId, { ok: true, data: 'foreign' }), {});
  h.emit({ ...result(h.sent[0].callId, { ok: true }), source: 'other' });
  h.emit(result('missing', { ok: true }));
  await Promise.resolve();
  assert.equal(settled, false);
  h.emit(result(h.sent[0].callId, { ok: true, data: 'valid' }));
  assert.equal(await pending, 'valid');
  h.adapter.destroy();
});

test('ping returns false without pong, true only for same-window pong', async () => {
  const h = harness(1);
  const ping = h.adapter.ping();
  assert.deepEqual(h.sent[0], { source: 'pdb-page', type: 'bridge-ping' });
  h.emit({ source: 'pdb-bridge', type: 'bridge-pong' }, {});
  assert.equal(await ping, false);
  const next = h.adapter.ping();
  h.emit({ source: 'pdb-bridge', type: 'bridge-pong' });
  assert.equal(await next, true);
  h.adapter.destroy();
});

test('adapter rejects results and pongs from a foreign origin (T5c MAJOR)', async () => {
  const page = { location: { origin: 'https://dashboard.test' } };
  global.window = page;
  let listener;
  const posted = [];
  const adapter = createDashboardAdapter({ timeoutMs: 100, postMessage(message) { posted.push(message); }, addListener(cb) { listener = cb; return () => {}; } });
  const pending = adapter.call('bot1', 'getDomStatus');
  const callId = posted[0].callId;
  let settled = false;
  pending.then(() => { settled = true; });
  listener({ source: page, origin: 'https://attacker.test', data: { source: 'pdb-bridge', type: 'pdb-result', callId, ok: true, data: 'forged' } });
  const foreignPing = adapter.ping();
  listener({ source: page, origin: 'https://attacker.test', data: { source: 'pdb-bridge', type: 'bridge-pong' } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(settled, false);
  listener({ source: page, origin: 'https://dashboard.test', data: { source: 'pdb-bridge', type: 'pdb-result', callId, ok: true, data: 'valid' } });
  assert.equal(await pending, 'valid');
  assert.equal(await foreignPing, false);
  adapter.destroy();
  global.window = undefined;
});

test('invalid calls never post code; destroy rejects outstanding calls and removes listener', async () => {
  const h = harness();
  for (const args of [['other', 'getDomStatus'], ['bot1', 'window.__PDB__.getDomStatus()'], ['bot1', 'eval'], ['bot1', 'getDomStatus', {}]]) {
    await assert.rejects(h.adapter.call(...args), { code: 'INVALID_CALL' });
  }
  assert.equal(h.sent.length, 0);
  assert.deepEqual(await h.adapter.setBotActive({ active: 1 }), { accepted: true, active: true });
  const pending = h.adapter.call('bot1', 'getDomStatus');
  const ping = h.adapter.ping();
  h.adapter.destroy();
  await assert.rejects(pending, { code: 'DESTROYED' });
  assert.equal(await ping, false);
  assert.equal(h.removed(), true);
  await assert.rejects(h.adapter.call('bot1', 'getDomStatus'), { code: 'DESTROYED' });
});

test('env defaults to current origin', () => {
  const context = { window: { location: { origin: 'https://dashboard.example' } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/public/env.js'), 'utf8'), context);
  assert.equal(context.window.PDB_ENV.serverUrl, 'https://dashboard.example');
  assert.equal(context.window.PDB_ENV.webMode, true);
});

for (const name of ['pancakeDom.js', 'pancakeUrlPolicy.js', 'botDecision.js', 'conversationClaims.js', 'conversationProcessing.js']) {
  test(`vendor/${name} byte-identical`, () => {
    assert.deepEqual(fs.readFileSync(path.join(__dirname, '../web/public/vendor', name)), fs.readFileSync(path.join(__dirname, '../src/renderer', name)));
  });
}

function dashboardHarness(options = {}) {
  const html = fs.readFileSync(path.join(__dirname, '../web/public/index.html'), 'utf8');
  const makeNode = () => ({ value: '', style: {}, dataset: {}, hidden: true, classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } }, textContent: '', innerHTML: '', listeners: {}, addEventListener(name, cb) { this.listeners[name] = cb; }, setAttribute() {}, querySelectorAll() { return []; }, appendChild() {}, getBoundingClientRect() { return { top: 0, left: 0, width: 300, height: 600 }; } });
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], makeNode()]));
  const requests = [], calls = [], intervals = new Map();
  let sequence = 0, lease = null, leaseStatus = 200, refuseExtend = false;
  const store = new Map([['pdb-machine-id', 'machine-local']]);
  // Per-tab identity storage (frozen 4ter); separate map from localStorage.
  const sessionStore = options.sessionStore || new Map([['pdb-machine-id', 'machine-local']]);
  const docListeners = {};
  const document = {
    hidden: false,
    body: makeNode(),
    getElementById(id) { return nodes.get(id) || null; },
    querySelectorAll() { return []; },
    querySelector() { return makeNode(); },
    createElement: makeNode,
    addEventListener(name, cb, opts) {
      if (!docListeners[name]) docListeners[name] = [];
      docListeners[name].push({ cb, opts });
    }
  };
  const window = {
    document,
    location: { origin: 'https://dashboard.test', reload() {} },
    PDB_ENV: { serverUrl: 'https://ignored.test', pancakeUrl: 'https://pages.fm/' },
    PDBDashboardAdapter: {
      createDashboardAdapter() {
        return {
          call: async (...args) => { calls.push(args); return {}; },
          listSlots: () => ['bot1', 'bot2', 'manual'].map((slot) => ({ slot, connected: false, url: '' })),
          onSlotsChanged() {},
          ping: async () => true,
          destroy() {},
          setBotActive: async (payload) => ({ accepted: true, active: Boolean(payload?.active) })
        };
      }
    },
    PDBPancakeUrlPolicy: require('../web/public/vendor/pancakeUrlPolicy.js'),
    postMessage() {},
    addEventListener() {},
    open() {},
    __testTabNonce: options.tabNonce
  };
  const context = vm.createContext({
    window,
    document,
    URL,
    FormData,
    AbortSignal,
    Blob,
    console,
    BroadcastChannel: options.BroadcastChannel,
    Audio: options.Audio,
    localStorage: { getItem: (key) => store.get(key), setItem: (key, value) => store.set(key, value) },
    sessionStorage: { getItem: (key) => sessionStore.get(key), setItem: (key, value) => sessionStore.set(key, value) },
    setInterval: (fn, ms) => { intervals.set(++sequence, { fn, ms }); return sequence; },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: () => 0,
    clearTimeout() {},
    fetch: async (url, fetchOpts) => {
      requests.push({ url, options: fetchOpts });
      let data = {}, status = 200;
      if (url === '/api/bot-lease') {
        status = leaseStatus;
        const body = fetchOpts.body && JSON.parse(fetchOpts.body);
        if (body?.action === 'release') { lease = null; data = { ok: true }; }
        else if (body) {
          if (refuseExtend || (lease && lease.owner !== body.machineId)) data = { ok: false, holder: lease?.owner || 'other-machine' };
          else { lease = { owner: body.machineId, expiresAt: new Date(Date.now() + 60000).toISOString() }; data = { ok: true, lease }; }
        } else data = { lease };
      }
      if (url === '/api/settings') {
        if (fetchOpts?.method === 'POST') {
          const body = fetchOpts.body ? JSON.parse(fetchOpts.body) : {};
          if (options.onSaveSettings) options.onSaveSettings(body);
          data = options.mockSettingsSaved || {
            ...body,
            ttsApiKey: '',
            ttsApiKeyMasked: body.ttsApiKey && body.ttsApiKey !== 'CLEAR' ? `••••${body.ttsApiKey.slice(-4)}` : (body.ttsApiKey === 'CLEAR' ? '' : (options.mockSettings?.ttsApiKeyMasked || ''))
          };
        } else {
          data = options.mockSettings || {};
        }
      }
      if (url === '/api/ai/config') {
        if (fetchOpts?.method === 'POST') {
          const body = fetchOpts.body ? JSON.parse(fetchOpts.body) : {};
          data = options.mockAiConfigSaved || {
            ...body,
            aiApiKey: '',
            aiApiKeyMasked: body.aiApiKey ? `••••${body.aiApiKey.slice(-4)}` : (options.mockAiConfig?.aiApiKeyMasked || '')
          };
        } else {
          data = options.mockAiConfig || {};
        }
      }
      if (url === '/api/shortcuts' || url === '/api/examples' || url === '/api/review-queue') data = { items: [] };
      if (url.startsWith('/api/logs')) data = [];
      return { ok: status === 200, status, statusText: String(status), json: async () => data };
    }
  });
  const source = fs.readFileSync(path.join(__dirname, '../web/public/app.js'), 'utf8').replace('init().catch((error) => toast(error.message, 6000));', '');
  vm.runInContext(source, context);
  return { nodes, requests, calls, intervals, docListeners, evaluate: (code) => vm.runInContext(code, context), setLease: (value) => { lease = value; }, setStatus: (value) => { leaseStatus = value; }, refuseExtend: () => { refuseExtend = true; } };
}

test('dashboard initializes copied panel using real HTML IDs and same-origin APIs', async () => {
  const h = dashboardHarness();
  await h.evaluate('init()');
  for (const endpoint of ['/api/settings', '/api/shortcuts', '/api/logs', '/api/examples', '/api/ai/config', '/api/bot-lease']) assert.ok(h.requests.some((r) => r.url.split('?')[0] === endpoint), endpoint);
  assert.ok(h.requests.every((r) => r.url.startsWith('/') && r.options.credentials === 'same-origin'));
  assert.equal(h.nodes.get('bot1Status').textContent, 'Disconnected');
  await h.evaluate("window.pancakeDesktop.openExtensionsFolder()");
  assert.equal(h.nodes.get('toast').textContent, 'Chỉ có ở bản desktop');
});

test('lease badge distinguishes foreign, own, empty, 404', async () => {
  const h = dashboardHarness();
  h.setLease({ owner: 'machine A', expiresAt: Date.now() + 60000 });
  await h.evaluate('loadLease()');
  assert.equal(h.nodes.get('leaseWarning').hidden, false);
  assert.equal(h.nodes.get('leaseWarning').textContent, 'machine A đang giữ bot lease');
  h.setLease({ owner: 'machine-local', expiresAt: Date.now() + 60000 });
  await h.evaluate('loadLease()');
  assert.equal(h.nodes.get('leaseWarning').hidden, true);
  h.setLease(null); h.setStatus(404);
  await h.evaluate('loadLease()');
  assert.equal(h.nodes.get('leaseWarning').hidden, true);
});

test('writes require lease; loss stops runtimes and blocks all subsequent writes', async () => {
  const h = dashboardHarness();
  await assert.rejects(h.evaluate("executeInTab('bot1','clickSendButton')"), { code: 'BOT_LEASE_REQUIRED' });
  assert.equal(h.calls.length, 0);
  await h.evaluate("executeInTab('bot1','getRecentMessages',[5])");
  assert.equal(h.calls.length, 1);
  await h.evaluate('acquireBotLease()');
  assert.ok([...h.intervals.values()].some((i) => i.ms === 20000));
  await h.evaluate("executeInTab('bot1','setReplyText',['/1'])");
  assert.deepEqual(Array.from(h.calls[1]).slice(0, 2), ['bot1', 'setReplyText']);
  h.evaluate('webviewTabs.bot1.runtime.botRunning = true; webviewTabs.bot2.runtime.autoClickRunning = true;');
  h.refuseExtend();
  await h.evaluate('extendBotLease()');
  assert.equal(h.evaluate('anyRuntimeBotRunning() || anyRuntimeAutoClickRunning()'), false);
  assert.equal([...h.intervals.values()].some((i) => i.ms === 20000), false);
  await assert.rejects(h.evaluate("executeInTab('bot2','clickSendButton')"), { code: 'BOT_LEASE_REQUIRED' });
});

test('late extend response cannot resurrect a lost lease (T5c MAJOR)', async () => {
  const h = dashboardHarness();
  await h.evaluate('acquireBotLease()');
  assert.equal(h.evaluate('ownsLease()'), true);
  // Hold the extend call in flight; the lease is lost BEFORE its (successful)
  // response arrives. The epoch guard must ignore that response entirely.
  await h.evaluate(`
    window.__realApi = api;
    window.__defer = new Promise((resolve) => { window.__release = resolve; });
    api = async (url, options) => {
      const body = options && options.body ? JSON.parse(options.body) : null;
      if (url === '/api/bot-lease' && body && body.action === 'extend') await window.__defer;
      return window.__realApi(url, options);
    };
  `);
  const extendPromise = h.evaluate('extendBotLease()');
  h.evaluate('loseLease()');
  await h.evaluate('window.__release()');
  await extendPromise;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(h.evaluate('ownsLease()'), false);
  await assert.rejects(h.evaluate("executeInTab('bot1','clickSendButton')"), { code: 'BOT_LEASE_REQUIRED' });
});

test('loop heartbeat self-heals a stalled leaseTimer instead of failing writes (BOT_LOOP_ERROR fix)', async () => {
  const h = dashboardHarness();
  await h.evaluate('acquireBotLease()');
  assert.ok([...h.intervals.values()].some((i) => i.ms === 20000));
  const extendCount = () => h.requests.filter((r) => r.url === '/api/bot-lease' && r.options.body && JSON.parse(r.options.body).action === 'extend').length;
  // Heartbeat khỏe (timer 20s sống, TTL còn xa): piggyback không phát request.
  const before = extendCount();
  await h.evaluate('keepLeaseFresh()');
  assert.equal(extendCount(), before);
  // Sự cố thực tế 2026-10-11: leaseTimer chết im lặng (sleep/freeze/fetch treo)
  // trong khi vòng lặp vẫn chạy → TTL hết hạn → BOT_LOOP_ERROR. Giờ piggyback
  // tự gia hạn ngay trong vòng lặp, lease được server cấp lại cho đúng owner.
  h.evaluate('leaseTimer = null;');
  await h.evaluate('keepLeaseFresh()');
  assert.equal(extendCount(), before + 1);
  assert.equal(h.evaluate('ownsLease()'), true);
  // Heartbeat phải có abort signal giới hạn để fetch treo không âm thầm làm hỏng lease.
  const lastExtend = h.requests.filter((r) => r.url === '/api/bot-lease' && r.options.body && JSON.parse(r.options.body).action === 'extend').at(-1);
  assert.ok(lastExtend.options.signal && lastExtend.options.signal.aborted === false);
});

test('loop heartbeat stays terminal when another machine holds the lease', async () => {
  const h = dashboardHarness();
  await h.evaluate('acquireBotLease()');
  h.evaluate('webviewTabs.bot1.runtime.botRunning = true;');
  // Server báo người khác đang giữ; lease local sắp hết hạn → piggyback extend
  // → !ok → loseLease terminal (frozen §4ter), dừng runtime, không tự hồi sinh.
  h.setLease({ owner: 'other-machine', expiresAt: Date.now() + 60000 });
  h.evaluate('heldLease = { owner: machineId, expiresAt: new Date(Date.now() + 3000).toISOString() };');
  await h.evaluate('keepLeaseFresh()');
  assert.equal(h.evaluate('ownsLease()'), false);
  assert.equal(h.evaluate('anyRuntimeBotRunning()'), false);
  assert.equal([...h.intervals.values()].some((i) => i.ms === 20000), false);
  await assert.rejects(h.evaluate("executeInTab('bot1','clickSendButton')"), { code: 'BOT_LEASE_REQUIRED' });
});

test('expired lease with live timer handle self-heals (sleep/freeze incident shape)', async () => {
  const h = dashboardHarness();
  await h.evaluate('acquireBotLease()');
  const extendCount = () => h.requests.filter((r) => r.url === '/api/bot-lease' && r.options.body && JSON.parse(r.options.body).action === 'extend').length;
  // Hình dạng sự cố thực 2026-10-11: máy sleep / tab freeze khiến timer handle
  // VẪN còn sống (truthy) nhưng không chạy; sau khi thức, heldLease đã quá hạn
  // TTL (expiresAt là mốc tuyệt đối) và server cũng đã quên lease in-memory.
  assert.equal(h.evaluate('Boolean(leaseTimer)'), true);
  h.setLease(null);
  h.evaluate('heldLease = { owner: machineId, expiresAt: new Date(Date.now() - 1000).toISOString() };');
  await h.evaluate('keepLeaseFresh()');
  // Nhánh TTL ≤ 25s kích hoạt piggyback; server cấp lại cho đúng owner qua
  // extend (chính hợp đồng frozen §4ter) → bot tự hồi phục, không BOT_LOOP_ERROR.
  assert.equal(h.evaluate('ownsLease()'), true);
  assert.equal(extendCount(), 1);
  // In-flight guard: hai piggyback dồn lại chỉ phát đúng MỘT request extend.
  h.setLease(null);
  h.evaluate('heldLease = { owner: machineId, expiresAt: new Date(Date.now() - 1000).toISOString() };');
  await Promise.all([h.evaluate('keepLeaseFresh()'), h.evaluate('keepLeaseFresh()')]);
  assert.equal(extendCount(), 2);
});

test('bot and autoclick loops re-heartbeat the lease every iteration', () => {
  const source = fs.readFileSync(path.join(__dirname, '../web/public/app.js'), 'utf8');
  for (const guard of ['while (runtime.botRunning)', 'while (runtime.autoClickRunning)']) {
    const at = source.indexOf(guard);
    assert.ok(at > 0, guard);
    assert.match(source.slice(at, at + 400), /await keepLeaseFresh\(\)/, `${guard} must refresh the lease each iteration`);
  }
});

test('machine identity is per tab: sessionStorage identity, reload-stable in that tab (T5a MINOR)', async () => {
  const sharedSession = new Map();
  const first = dashboardHarness({ sessionStore: sharedSession });
  await first.evaluate('acquireBotLease()');
  const firstId = JSON.parse(first.requests.find((r) => r.url === '/api/bot-lease' && r.options.body).options.body).machineId;
  const second = dashboardHarness({ sessionStore: sharedSession });
  await second.evaluate('acquireBotLease()');
  const secondId = JSON.parse(second.requests.find((r) => r.url === '/api/bot-lease' && r.options.body).options.body).machineId;
  assert.equal(secondId, firstId);
  const otherTab = dashboardHarness({ sessionStore: new Map() });
  await otherTab.evaluate('acquireBotLease()');
  const otherId = JSON.parse(otherTab.requests.find((r) => r.url === '/api/bot-lease' && r.options.body).options.body).machineId;
  assert.notEqual(otherId, firstId);
});

test('lease refusal and 404 remain fail closed; release uses frozen contract', async () => {
  const h = dashboardHarness();
  h.setLease({ owner: 'other-machine', expiresAt: Date.now() + 60000 });
  await assert.rejects(h.evaluate('acquireBotLease()'), /other-machine/);
  h.setLease(null); h.setStatus(404);
  await assert.rejects(h.evaluate('acquireBotLease()'), /404/);
  assert.equal(h.evaluate('ownsLease()'), false);
  h.setStatus(200);
  await h.evaluate('acquireBotLease();');
  await h.evaluate('releaseBotLease();');
  assert.equal(h.evaluate('ownsLease()'), false);
  assert.deepEqual(JSON.parse(h.requests.at(-1).options.body), { action: 'release', machineId: 'machine-local' });
});

test('starting automation acquires lease before any business writes; stopping releases it', async () => {
  const h = dashboardHarness();
  h.evaluate('botLoop = async (runtime) => { runtime.botRunning = true; }; autoClickLoop = async (runtime) => { runtime.autoClickRunning = true; };');
  await h.evaluate('startBot()');
  assert.equal(JSON.parse(h.requests[0].options.body).action, 'acquire');
  assert.equal(h.evaluate('ownsLease()'), true);
  await h.evaluate('stopBot()');
  assert.equal(h.evaluate('ownsLease()'), false);
  await h.evaluate('startAutoClick()');
  assert.equal(h.evaluate('ownsLease()'), true);
  await h.evaluate('stopAutoClick()');
  assert.equal(h.evaluate('ownsLease()'), false);
});

test('strict CSP, local scripts, no desktop automation transport', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/public/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../web/public/app.js'), 'utf8');
  assert.match(html, /default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'/);
  assert.doesNotMatch(html, /<webview/);
  assert.doesNotMatch(app, /executeJavaScript|\.webview\b|eval\(|new Function|window\.__PDB__/);
  for (const match of html.matchAll(/<script src="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(__dirname, '../web/public', match[1])), match[1]);
});

test('CSP audio: media-src self blob added and script-src self preserved (P1.1)', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/public/index.html'), 'utf8');
  assert.match(html, /media-src\s+'self'\s+blob:/);
  assert.match(html, /script-src\s+'self'/);
  assert.match(html, /connect-src\s+'self'/);
  assert.doesNotMatch(html, /script-src[^;]*'unsafe-inline'/);
});

test('duplicate-tab: BroadcastChannel causes younger tab to mint new machineId; without channel it fails-soft (P1.3)', async () => {
  // Without BroadcastChannel: fails soft, does not crash
  const noChannelTab = dashboardHarness();
  assert.equal(typeof noChannelTab.evaluate('getMachineId()'), 'string');
  assert.equal(noChannelTab.evaluate('initDuplicateTabGuard()'), null);

  // Shared bus for mock BroadcastChannel
  const bus = [];
  class MockBroadcastChannel {
    constructor(name) {
      this.name = name;
      bus.push(this);
    }
    postMessage(data) {
      for (const ch of [...bus]) {
        if (ch !== this && ch.name === this.name) {
          const event = { data };
          if (typeof ch.onmessage === 'function') ch.onmessage(event);
        }
      }
    }
    close() {
      const idx = bus.indexOf(this);
      if (idx !== -1) bus.splice(idx, 1);
    }
  }

  // Tab 1 (older tab, tabNonce = 1000)
  const tab1 = dashboardHarness({
    sessionStore: new Map([['pdb-machine-id', 'shared-tab-id']]),
    BroadcastChannel: MockBroadcastChannel,
    tabNonce: 1000
  });
  const id1 = tab1.evaluate('getMachineId()');
  assert.equal(id1, 'shared-tab-id');

  // Tab 2 (younger tab, cloned session from duplicate tab, tabNonce = 2000)
  const tab2 = dashboardHarness({
    sessionStore: new Map([['pdb-machine-id', 'shared-tab-id']]),
    BroadcastChannel: MockBroadcastChannel,
    tabNonce: 2000
  });
  const id2 = tab2.evaluate('getMachineId()');
  // Younger tab mints new ID and updates its sessionStorage
  assert.notEqual(id2, id1);
  assert.equal(tab2.evaluate("sessionStorage.getItem('pdb-machine-id')"), id2);
  // Older tab retains its original ID
  assert.equal(tab1.evaluate('getMachineId()'), id1);
});

test('primeTtsAudio: registered on gesture and Audio.play rejection fails soft with user status (P1.2)', async () => {
  let playAttempted = false;
  class RejectingAudio {
    constructor(url) { this.src = url; this.volume = 1; }
    async play() {
      playAttempted = true;
      const error = new Error('NotAllowedError: play() failed because user did not interact');
      error.name = 'NotAllowedError';
      throw error;
    }
  }

  const h = dashboardHarness({ Audio: RejectingAudio });
  // Verify audio priming is registered on user gestures
  assert.ok(h.docListeners['click']?.some((l) => l.opts?.once));
  assert.ok(h.docListeners['keydown']?.some((l) => l.opts?.once));

  // Verify play rejection is caught and sets status instead of breaking app
  const result = await h.evaluate('primeTtsAudio()');
  assert.equal(result, false);
  assert.equal(playAttempted, true);
  assert.equal(h.nodes.get('ttsAudioStatus').textContent, 'Cần bấm vào trang để bật âm thanh');
  assert.equal(h.nodes.get('toast').textContent, 'Cần bấm vào trang để bật âm thanh');

  // Verify successful play marks primed
  class SuccessAudio {
    constructor(url) { this.src = url; }
    async play() { return Promise.resolve(); }
  }
  const h2 = dashboardHarness({ Audio: SuccessAudio });
  const successResult = await h2.evaluate('primeTtsAudio()');
  assert.equal(successResult, true);
  assert.equal(h2.evaluate('ttsAudioPrimed'), true);
});

test('settings masked: empty key + masked renders placeholder; save preserves empty or sends CLEAR', async () => {
  const h = dashboardHarness({
    mockSettings: {
      botEnabled: false,
      ttsApiKey: '',
      ttsApiKeyMasked: '••••1234',
      ttsModel: 'google-tts/vi'
    },
    mockAiConfig: {
      aiApiKey: '',
      aiApiKeyMasked: '••••5678',
      aiModel: 'gpt-4o'
    }
  });

  await h.evaluate('loadSettings()');
  // Placeholder shows mask, input is empty
  assert.equal(h.nodes.get('ttsApiKey').value, '');
  assert.equal(h.nodes.get('ttsApiKey').placeholder, '••••1234');

  await h.evaluate('loadAiConfig()');
  assert.equal(h.nodes.get('aiApiKey').value, '');
  assert.equal(h.nodes.get('aiApiKey').placeholder, '••••5678');

  // Case 1: user doesn't touch ttsApiKey -> sends '' to preserve existing key
  await h.evaluate('saveSettingsFromUi()');
  const req1 = h.requests.filter((r) => r.url === '/api/settings' && r.options.method === 'POST').at(-1);
  const body1 = JSON.parse(req1.options.body);
  assert.equal(body1.ttsApiKey, '');

  // Case 2: user types 'CLEAR' -> sends 'CLEAR' to delete key
  h.nodes.get('ttsApiKey').value = 'CLEAR';
  await h.evaluate('saveSettingsFromUi()');
  const req2 = h.requests.filter((r) => r.url === '/api/settings' && r.options.method === 'POST').at(-1);
  const body2 = JSON.parse(req2.options.body);
  assert.equal(body2.ttsApiKey, 'CLEAR');
  // After saving, input is cleared and placeholder updated from response
  assert.equal(h.nodes.get('ttsApiKey').value, '');
});
