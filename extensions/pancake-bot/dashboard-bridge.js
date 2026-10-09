(() => {
  if (window.__PDB_DASHBOARD_BRIDGE__) return;
  window.__PDB_DASHBOARD_BRIDGE__ = true;
  // Third whitelist layer (frozen §4bis E): the dashboard bridge itself rejects
  // unknown methods before they ever reach the background relay.
  const allowedMethods = ['sleep', 'waitForSelector', 'getUnreadConversations', 'getActiveConversationId', 'clickConversationById', 'getCurrentCustomerName', 'getCurrentTags', 'applyTagByName', 'getReplyTextarea', 'setReplyText', 'clearReplyText', 'findSendButton', 'clickSendButton', 'findMarkUnreadButton', 'markCurrentConversationUnread', 'sanitizeOutgoingText', 'getDomStatus', 'getDomHealth', 'getRecentMessages', 'getLastMessageSender', 'getCustomerOrderStatus'];
  const post = (message) => window.postMessage({ source: 'pdb-bridge', ...message }, window.location.origin);
  chrome.runtime.sendMessage({ type: 'dashboard-hello' }).then((result) => {
    if (result?.ok) post({ type: 'bridge-ready', slots: result.slots });
  }).catch(() => post({ type: 'bridge-error', error: { code: 'BRIDGE_ERROR', message: 'Extension unavailable' } }));
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== 'pdb-page') return;
    const { type, callId, slot, method, args } = event.data;
    if (!['pdb-call', 'get-slots', 'bridge-ping', 'open-pancake-tab'].includes(type)) return;
    if (type === 'pdb-call' && !allowedMethods.includes(method)) {
      post({ type: 'pdb-result', callId, ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
      return;
    }
    try {
      const result = await chrome.runtime.sendMessage({ type, callId, slot, method, args });
      if (type === 'bridge-ping' || type === 'get-slots') {
        if (result?.ok) post({ type: type === 'bridge-ping' ? 'bridge-pong' : 'slots-changed', slots: result.slots });
        return;
      }
      post({ type: 'pdb-result', callId, ok: result?.ok === true, ...(result?.ok ? { data: type === 'open-pancake-tab' ? { tabId: result.tabId } : result.data } : { error: result?.error || { code: 'BRIDGE_ERROR', message: 'Bridge request failed' } }) });
    } catch (_) { post({ type: 'pdb-result', callId, ok: false, error: { code: 'BRIDGE_ERROR', message: 'Extension unavailable' } }); }
  });
  chrome.runtime.onMessage.addListener((message) => { if (message?.type === 'slots-changed') post(message); });
})();
