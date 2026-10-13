const pancakeTabs = new Map();
const dashboardTabs = new Set();
const slotNames = ['bot1', 'bot2', 'manual'];
const methods = ['sleep', 'waitForSelector', 'getUnreadConversations', 'getActiveConversationId', 'clickConversationById', 'getCurrentCustomerName', 'getCurrentTags', 'applyTagByName', 'getReplyTextarea', 'setReplyText', 'clearReplyText', 'findSendButton', 'clickSendButton', 'findMarkUnreadButton', 'markCurrentConversationUnread', 'sanitizeOutgoingText', 'getDomStatus', 'getDomHealth', 'getRecentMessages', 'getLastMessageSender', 'getCustomerOrderStatus'];
const config = chrome.runtime.getManifest().content_scripts;

function matches(url, patterns) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    return patterns.some((pattern) => {
      const target = new URL(pattern.replace('://*.', '://'));
      const host = parsed.hostname === target.hostname || (pattern.includes('://*.') && parsed.hostname.endsWith(`.${target.hostname}`));
      return host && parsed.protocol === target.protocol && parsed.port === target.port;
    });
  } catch (_) { return false; }
}
const ready = chrome.storage.session.get(['pancakeTabs', 'dashboardTabs']).then((state) => {
  for (const [id, value] of state.pancakeTabs || []) {
    if (Number.isInteger(id) && slotNames.includes(value?.slot) && matches(value.url, config[0].matches)) pancakeTabs.set(id, value);
  }
  for (const id of state.dashboardTabs || []) if (Number.isInteger(id)) dashboardTabs.add(id);
});
function snapshot() {
  return slotNames.map((slot) => {
    const found = [...pancakeTabs.entries()].find(([, value]) => value.slot === slot);
    return found ? { ...found[1], tabId: found[0], connected: true } : { slot, tabId: null, url: '', lastSeen: null, connected: false };
  });
}
async function broadcast() {
  await chrome.storage.session.set({ pancakeTabs: [...pancakeTabs], dashboardTabs: [...dashboardTabs] });
  const message = { type: 'slots-changed', slots: snapshot() };
  await Promise.all([...dashboardTabs].map((id) => chrome.tabs.sendMessage(id, message).catch(() => undefined)));
}
function failure(callId, code, message = code) {
  return { type: 'pdb-result', callId, ok: false, error: { code, message } };
}
async function handleMessage(message, sender) {
  await ready;
  if (!message || typeof message !== 'object') return failure(undefined, 'INVALID_CALL');
  const id = sender.tab?.id;
  const trustedFrame = sender.frameId === undefined || sender.frameId === 0;
  const url = sender.url || sender.tab?.url;
  const pancake = trustedFrame && Number.isInteger(id) && matches(url, config[0].matches);
  const dashboard = trustedFrame && Number.isInteger(id) && matches(url, config[1].matches);
  const popup = !sender.tab && sender.url === chrome.runtime.getURL?.('popup.html');
  if (message.type === 'tab-hello') {
    if (!pancake) return failure(message.callId, 'UNTRUSTED_SENDER');
    const slot = pancakeTabs.get(id)?.slot || slotNames.find((name) => ![...pancakeTabs.values()].some((value) => value.slot === name));
    if (!slot) return failure(message.callId, 'SLOT_FULL');
    pancakeTabs.set(id, { url, slot, lastSeen: Date.now() });
    await broadcast();
    return { ok: true, slot };
  }
  if (!dashboard && !popup) return failure(message.callId, 'UNTRUSTED_SENDER');
  if (dashboard) dashboardTabs.add(id);
  if (message.type === 'dashboard-hello' || message.type === 'get-slots' || message.type === 'bridge-ping') {
    await broadcast();
    return { type: message.type === 'bridge-ping' ? 'bridge-pong' : 'slots-changed', ok: true, slots: snapshot() };
  }
  const settings = await chrome.storage.local.get({ bridgeEnabled: true, pancakeUrl: 'https://pages.fm/' });
  if (message.type === 'open-pancake-tab') {
    const targetUrl = message.url !== undefined ? message.url : settings.pancakeUrl;
    if (typeof targetUrl !== 'string' || !matches(targetUrl, config[0].matches)) return failure(message.callId, 'INVALID_URL');
    const tab = await chrome.tabs.create({ url: targetUrl });
    return { ok: true, tabId: tab.id };
  }
  if (message.type === 'navigate-tab') {
    if (!slotNames.includes(message.slot)) return failure(message.callId, 'INVALID_CALL');
    if (typeof message.url !== 'string' || !matches(message.url, config[0].matches)) return failure(message.callId, 'INVALID_URL');
    const entry = [...pancakeTabs.entries()].find(([, value]) => value.slot === message.slot);
    if (!entry) return failure(message.callId, 'NO_TAB');
    const tabId = entry[0];
    await chrome.tabs.update(tabId, { url: message.url });
    entry[1].url = message.url;
    entry[1].lastSeen = Date.now();
    await broadcast();
    return { ok: true, tabId };
  }
  if (message.type === 'reload-pancake-tab') {
    if (!slotNames.includes(message.slot)) return failure(message.callId, 'INVALID_CALL');
    const entry = [...pancakeTabs.entries()].find(([, value]) => value.slot === message.slot);
    if (!entry) return failure(message.callId, 'NO_TAB');
    const tabId = entry[0];
    await chrome.tabs.reload(tabId);
    return { ok: true };
  }
  if (message.type !== 'pdb-call') return failure(message.callId, 'INVALID_CALL');
  if (!settings.bridgeEnabled) return failure(message.callId, 'BRIDGE_DISABLED');
  if (typeof message.callId !== 'string' || !message.callId || !slotNames.includes(message.slot) || (message.args !== undefined && !Array.isArray(message.args))) return failure(message.callId, 'INVALID_CALL');
  if (!methods.includes(message.method)) return failure(message.callId, 'METHOD_NOT_ALLOWED');
  const entry = [...pancakeTabs.entries()].find(([, value]) => value.slot === message.slot);
  if (!entry) return failure(message.callId, 'NO_TAB');
  try {
    const result = await chrome.tabs.sendMessage(entry[0], { type: 'pdb-call', callId: message.callId, method: message.method, args: message.args || [] });
    if (!result || result.callId !== message.callId || typeof result.ok !== 'boolean') return failure(message.callId, 'NAVIGATION');
    return { type: 'pdb-result', callId: message.callId, ok: result.ok, ...(result.ok ? { data: result.data } : { error: result.error }) };
  } catch (_) { return failure(message.callId, 'NAVIGATION', 'Pancake tab unavailable'); }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse, (error) => sendResponse(failure(message?.callId, error.code || 'BRIDGE_ERROR', String(error.message || error))));
  return true;
});
chrome.tabs.onRemoved.addListener(async (id) => {
  await ready;
  pancakeTabs.delete(id);
  dashboardTabs.delete(id);
  await broadcast();
});
// A Pancake tab that navigates away (or reloads onto a non-Pancake URL) must
// release its slot immediately: otherwise the slot stays "connected" while the
// tab is gone, and a new Pancake tab gets the leftover slot instead.
chrome.tabs.onUpdated.addListener(async (id, changeInfo, tab) => {
  await ready;
  if (!pancakeTabs.has(id)) return;
  const url = changeInfo.url || tab?.url || tab?.pendingUrl;
  if (url === undefined) return;
  if (!matches(url, config[0].matches)) {
    pancakeTabs.delete(id);
    await broadcast();
  }
});
