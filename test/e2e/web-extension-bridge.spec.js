'use strict';
const { test, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { startBridgeServers } = require('./fixture/web-extension-bridge-server');

const extension = path.resolve(__dirname, '../../extensions/pancake-bot');
const dashboardUrl = 'http://127.0.0.1:8787';
const unread = [
  { index: 0, id: 'pancake:101:201', name: 'Synthetic Customer', snippet: 'Synthetic unread', tags: ['VIP'], hasTags: true },
  { index: 1, id: 'pancake:101:202', name: 'Synthetic Second', snippet: 'Second unread', tags: [], hasTags: false }
];
function installedChromium() {
  if (fs.existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const versions = fs.readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  const found = versions.map(name => path.join(cache, name, 'chrome-win64/chrome.exe')).find(file => fs.existsSync(file));
  if (!found) throw new Error('Installed full Chromium unavailable; no installation or headful fallback permitted');
  return found;
}
async function call(page, slot, method, args = []) {
  return page.evaluate(async payload => {
    try { return await adapter.call(payload.slot, payload.method, payload.args); }
    catch (error) { return { code: error.code }; }
  }, { slot, method, args });
}
// Select the real extension isolated world; never replace bridge code.
async function isolatedRequest(context, page, message) {
  const session = await context.newCDPSession(page);
  const worlds = [];
  session.on('Runtime.executionContextCreated', ({ context: world }) => worlds.push(world));
  try {
    await session.send('Runtime.enable');
    const world = worlds.find(item => item.origin.startsWith('chrome-extension://') && !item.auxData?.isDefault);
    if (!world) throw new Error('Extension isolated world missing');
    const result = await session.send('Runtime.evaluate', {
      contextId: world.id, expression: `chrome.runtime.sendMessage(${JSON.stringify(message)})`, awaitPromise: true, returnByValue: true
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  } finally { await session.detach(); }
}

test('real MV3 bridge: DOM calls, lease epoch, whitelist layers, slot limits and reconnect', async () => {
  test.setTimeout(60000);
  const servers = await startBridgeServers();
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(servers.temporary, 'profile'), {
      executablePath: installedChromium(), headless: true, chromiumSandbox: false, ignoreHTTPSErrors: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        `--host-resolver-rules=MAP pages.fm 127.0.0.1:${servers.fixturePort}`, '--ignore-certificate-errors', '--test-type', '--no-proxy-server']
    });
    // Only ancillary dashboard APIs are synthetic. Real login, lease, env,
    // assets, extension runtime and DOM calls remain untouched. Never read
    // private store data or write customer logs during dashboard initialization.
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (!['127.0.0.1', 'pages.fm'].includes(url.hostname)) return route.abort();
      if (url.hostname === '127.0.0.1' && (url.pathname === '/health' || (url.pathname.startsWith('/api/') && !/^\/api\/(auth(?:\/|$)|bot-lease$|env$)/.test(url.pathname)))) {
        const body = url.pathname === '/api/logs' ? [] : url.pathname === '/api/settings' ? { botEnabled: false, autoSend: false } : { items: [], ok: true };
        return route.fulfill({ json: body });
      }
      return route.continue();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
    const dashboard = await context.newPage();
    await dashboard.goto(dashboardUrl);
    await expect(dashboard).toHaveURL(`${dashboardUrl}/api/auth/login`);
    await dashboard.locator('input[name="token"]').fill('synthetic-e2e-token');
    await dashboard.locator('button').click();
    await expect(dashboard).toHaveURL(`${dashboardUrl}/`);
    await dashboard.waitForLoadState('load');
    expect(await dashboard.evaluate(() => adapter.ping())).toBe(true);
    expect(await call(dashboard, 'bot1', 'getUnreadConversations')).toEqual({ code: 'NO_TAB' });
    const pancake = await context.newPage();
    await pancake.goto('https://pages.fm/');
    expect(new URL(pancake.url()).port).toBe('');
    await expect.poll(() => dashboard.evaluate(() => adapter.listSlots()[0].connected)).toBe(true);
    expect(await call(dashboard, 'bot1', 'getUnreadConversations')).toEqual(unread);
    expect(await call(dashboard, 'bot1', 'getCurrentCustomerName')).toBe('Synthetic Customer');
    expect(await call(dashboard, 'bot1', 'getCurrentTags')).toEqual(['VIP']);
    expect(await call(dashboard, 'bot1', 'findMarkUnreadButton')).toBe(true);
    expect(await call(dashboard, 'bot1', 'getReplyTextarea')).toBe(true);

    await dashboard.evaluate(() => acquireBotLease());
    const owner = await dashboard.evaluate(() => getMachineId());
    expect(await dashboard.evaluate(async () => (await api('/api/bot-lease')).lease.owner)).toBe(owner);
    const second = await context.newPage();
    await second.goto(dashboardUrl);
    await second.waitForLoadState('load');
    expect(await second.evaluate(() => getMachineId())).not.toBe(owner);
    expect(await second.evaluate(async () => {
      try { await acquireBotLease(); return 'unexpected'; } catch (_) { return ownsLease(); }
    })).toBe(false);
    expect(await second.evaluate(async () => {
      try { await executeInTab('bot1', 'setReplyText', ['/1']); return 'unexpected'; } catch (error) { return error.code; }
    })).toBe('BOT_LEASE_REQUIRED');
    await expect(pancake.locator('#replyBoxComposer')).toHaveValue('');
    await dashboard.evaluate(() => executeInTab('bot1', 'setReplyText', ['/1']));
    await expect(pancake.locator('#replyBoxComposer')).toHaveValue('/1');

    // Delay a genuine extend response until after leaseEpoch has changed.
    let releaseResponse;
    let observedResponse;
    const observed = new Promise(resolve => { observedResponse = resolve; });
    const release = new Promise(resolve => { releaseResponse = resolve; });
    const holdExtend = async route => {
      if (route.request().postDataJSON()?.action !== 'extend') return route.continue();
      const response = await route.fetch();
      observedResponse();
      await release;
      await route.fulfill({ response });
    };
    await dashboard.route('**/api/bot-lease', holdExtend);
    await dashboard.evaluate(() => { window.pendingExtend = extendBotLease(); });
    await observed;
    await dashboard.evaluate(() => loseLease());
    releaseResponse();
    await dashboard.evaluate(() => window.pendingExtend);
    await dashboard.unroute('**/api/bot-lease', holdExtend);
    expect(await dashboard.evaluate(() => ownsLease())).toBe(false);
    expect(await dashboard.evaluate(async () => {
      try { await executeInTab('bot1', 'clearReplyText'); return 'unexpected'; } catch (error) { return error.code; }
    })).toBe('BOT_LEASE_REQUIRED');
    await expect(pancake.locator('#replyBoxComposer')).toHaveValue('/1');

    expect(await call(dashboard, 'bot1', 'notAllowed')).toEqual({ code: 'INVALID_CALL' });
    const denied = await dashboard.evaluate(() => new Promise(resolve => {
      const listener = event => {
        if (event.source === window && event.data?.source === 'pdb-bridge' && event.data.callId === 'deny') {
          window.removeEventListener('message', listener); resolve(event.data);
        }
      };
      window.addEventListener('message', listener);
      window.postMessage({ source: 'pdb-page', type: 'pdb-call', callId: 'deny', slot: 'bot1', method: 'notAllowed', args: [] }, location.origin);
    }));
    expect(denied.error.code).toBe('METHOD_NOT_ALLOWED');
    const forbidden = { type: 'pdb-call', callId: 'deny-inner', slot: 'bot1', method: 'notAllowed', args: [] };
    expect((await isolatedRequest(context, dashboard, forbidden)).error.code).toBe('METHOD_NOT_ALLOWED');
    const contentDenied = await worker.evaluate(async message => {
      const tabs = await chrome.tabs.query({ url: 'https://pages.fm/*' });
      return chrome.tabs.sendMessage(tabs[0].id, message);
    }, forbidden);
    expect(contentDenied.error.code).toBe('METHOD_NOT_ALLOWED');

    for (let index = 0; index < 2; index++) {
      const page = await context.newPage();
      await page.goto(`https://pages.fm/?slot=${index}`);
      await expect.poll(() => dashboard.evaluate(() => adapter.listSlots().filter(slot => slot.connected).length)).toBe(index + 2);
    }
    const overflow = await context.newPage();
    await overflow.goto('https://pages.fm/?overflow');
    expect((await isolatedRequest(context, overflow, { type: 'tab-hello' })).error.code).toBe('SLOT_FULL');
    expect(await dashboard.evaluate(() => adapter.listSlots().filter(slot => slot.connected).length)).toBe(3);
    await pancake.close();
    await expect.poll(() => dashboard.evaluate(() => adapter.listSlots()[0].connected)).toBe(false);
    expect(await call(dashboard, 'bot1', 'getUnreadConversations')).toEqual({ code: 'NO_TAB' });
    const reopened = await context.newPage();
    await reopened.goto('https://pages.fm/?reopened');
    await expect.poll(() => dashboard.evaluate(() => adapter.listSlots()[0].connected)).toBe(true);
    expect(await call(dashboard, 'bot1', 'getUnreadConversations')).toEqual(unread);
  } finally {
    try { if (context) await context.close(); } finally { await servers.stop(); }
  }
});
