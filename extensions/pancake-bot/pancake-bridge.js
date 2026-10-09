(() => {
  if (window.__PDB_BRIDGE__) return;
  window.__PDB_BRIDGE__ = true;
  const allowed = ['sleep', 'waitForSelector', 'getUnreadConversations', 'getActiveConversationId', 'clickConversationById', 'getCurrentCustomerName', 'getCurrentTags', 'applyTagByName', 'getReplyTextarea', 'setReplyText', 'clearReplyText', 'findSendButton', 'clickSendButton', 'findMarkUnreadButton', 'markCurrentConversationUnread', 'sanitizeOutgoingText', 'getDomStatus', 'getDomHealth', 'getRecentMessages', 'getLastMessageSender', 'getCustomerOrderStatus'];
  chrome.runtime.sendMessage({ type: 'tab-hello', url: location.href });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'pdb-call') return false;
    (async () => {
      try {
        if (!allowed.includes(message.method) || typeof window.__PDB__?.[message.method] !== 'function') throw Object.assign(new Error('Method not allowed'), { code: 'METHOD_NOT_ALLOWED' });
        if (!Array.isArray(message.args) && message.args !== undefined) throw Object.assign(new Error('Invalid args'), { code: 'INVALID_CALL' });
        const data = await window.__PDB__[message.method](...(message.args || []));
        sendResponse({ type: 'pdb-result', callId: message.callId, ok: true, data });
      } catch (err) { sendResponse({ type: 'pdb-result', callId: message.callId, ok: false, error: { code: err.code || 'BRIDGE_ERROR', message: String(err.message || err).slice(0, 200) } }); }
    })();
    return true;
  });
})();
