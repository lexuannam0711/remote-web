(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PDBDashboardAdapter = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  let nextCallId = 0;
  const slotNames = ['bot1', 'bot2', 'manual'];
  const methods = new Set([
    'sleep', 'waitForSelector', 'getUnreadConversations', 'getActiveConversationId',
    'clickConversationById', 'getCurrentCustomerName', 'getCurrentTags', 'applyTagByName',
    'getReplyTextarea', 'setReplyText', 'clearReplyText', 'findSendButton', 'clickSendButton',
    'findMarkUnreadButton', 'markCurrentConversationUnread', 'sanitizeOutgoingText',
    'getDomStatus', 'getDomHealth', 'getRecentMessages', 'getLastMessageSender', 'getCustomerOrderStatus'
  ]);
  const failure = (code, message) => Object.assign(new Error(message), { code });

  function createDashboardAdapter({ postMessage, addListener, timeoutMs = 15000 }) {
    if (typeof postMessage !== 'function' || typeof addListener !== 'function'
        || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Invalid adapter options');
    const page = window;
    const calls = new Map();
    const pings = new Set();
    const subscribers = new Set();
    let destroyed = false;
    let slots = slotNames.map((slot) => ({ slot, connected: false, url: '' }));
    const listSlots = () => slots.map((slot) => ({ ...slot }));

    function updateSlots(incoming) {
      if (!Array.isArray(incoming)) return;
      slots = slotNames.map((slot) => {
        const records = incoming.filter((item) => item && item.slot === slot);
        const item = records.length === 1 ? records[0] : null;
        return { slot, connected: item?.connected === true, url: typeof item?.url === 'string' ? item.url : '' };
      });
      for (const cb of subscribers) cb(listSlots());
    }

    const unsubscribe = addListener((event) => {
      if (destroyed || event.source !== page || event.data?.source !== 'pdb-bridge') return;
      // Same-origin gate (frozen §4bis A): a same-window message forged from a
      // cross-origin context must never settle a pending call.
      if (event.origin !== page.location?.origin) return;
      const message = event.data;
      if (['slots-changed', 'bridge-ready', 'bridge-pong'].includes(message.type)) updateSlots(message.slots);
      if (message.type === 'bridge-pong') {
        for (const done of pings) done(true);
      }
      if (message.type !== 'pdb-result' || typeof message.ok !== 'boolean') return;
      const pending = calls.get(message.callId);
      if (!pending) return;
      clearTimeout(pending.timer);
      calls.delete(message.callId);
      if (message.ok) pending.resolve(message.data);
      else pending.reject(failure(typeof message.error?.code === 'string' ? message.error.code : 'BRIDGE_ERROR',
        typeof message.error?.message === 'string' ? message.error.message : 'Bridge call failed'));
    });

    function call(slot, method, args = []) {
      if (destroyed) return Promise.reject(failure('DESTROYED', 'Adapter destroyed'));
      if (!slotNames.includes(slot) || !methods.has(method) || !Array.isArray(args)) {
        return Promise.reject(failure('INVALID_CALL', 'Invalid slot, method or args'));
      }
      const callId = `pdb-call-${++nextCallId}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          calls.delete(callId);
          reject(failure('TIMEOUT', `Bridge call timed out: ${method}`));
        }, timeoutMs);
        calls.set(callId, { resolve, reject, timer });
        try { postMessage({ source: 'pdb-page', type: 'pdb-call', callId, slot, method, args }, page.location?.origin); }
        catch (error) { clearTimeout(timer); calls.delete(callId); reject(error); }
      });
    }

    function ping() {
      if (destroyed) return Promise.resolve(false);
      return new Promise((resolve) => {
        const done = (value) => { clearTimeout(timer); pings.delete(done); resolve(value); };
        const timer = setTimeout(() => done(false), timeoutMs);
        pings.add(done);
        try { postMessage({ source: 'pdb-page', type: 'bridge-ping' }, page.location?.origin); }
        catch (_) { done(false); }
      });
    }

    function navigateTab(slot, url) {
      if (destroyed) return Promise.reject(failure('DESTROYED', 'Adapter destroyed'));
      if (!slotNames.includes(slot) || typeof url !== 'string' || !url) {
        return Promise.reject(failure('INVALID_CALL', 'Invalid slot or url'));
      }
      const callId = `pdb-call-${++nextCallId}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          calls.delete(callId);
          reject(failure('TIMEOUT', 'Bridge call timed out: navigate-tab'));
        }, timeoutMs);
        calls.set(callId, { resolve, reject, timer });
        try { postMessage({ source: 'pdb-page', type: 'navigate-tab', callId, slot, url }, page.location?.origin); }
        catch (error) { clearTimeout(timer); calls.delete(callId); reject(error); }
      });
    }

    function reloadTab(slot) {
      if (destroyed) return Promise.reject(failure('DESTROYED', 'Adapter destroyed'));
      if (!slotNames.includes(slot)) {
        return Promise.reject(failure('INVALID_CALL', 'Invalid slot'));
      }
      const callId = `pdb-call-${++nextCallId}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          calls.delete(callId);
          reject(failure('TIMEOUT', 'Bridge call timed out: reload-pancake-tab'));
        }, timeoutMs);
        calls.set(callId, { resolve, reject, timer });
        try { postMessage({ source: 'pdb-page', type: 'reload-pancake-tab', callId, slot }, page.location?.origin); }
        catch (error) { clearTimeout(timer); calls.delete(callId); reject(error); }
      });
    }

    function openTab(url, slot) {
      if (destroyed) return Promise.reject(failure('DESTROYED', 'Adapter destroyed'));
      if (url !== undefined && (typeof url !== 'string' || !url)) {
        return Promise.reject(failure('INVALID_CALL', 'Invalid url'));
      }
      if (slot !== undefined && !slotNames.includes(slot)) {
        return Promise.reject(failure('INVALID_CALL', 'Invalid slot'));
      }
      const callId = `pdb-call-${++nextCallId}`;
      const payload = { source: 'pdb-page', type: 'open-pancake-tab', callId };
      if (typeof url === 'string' && url) payload.url = url;
      if (slot !== undefined) payload.slot = slot;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          calls.delete(callId);
          reject(failure('TIMEOUT', 'Bridge call timed out: open-pancake-tab'));
        }, timeoutMs);
        calls.set(callId, { resolve, reject, timer });
        try { postMessage(payload, page.location?.origin); }
        catch (error) { clearTimeout(timer); calls.delete(callId); reject(error); }
      });
    }

    return {
      call, ping, listSlots, navigateTab, reloadTab, openTab,
      setBotActive: (payload) => Promise.resolve({ accepted: true, active: Boolean(payload && payload.active) }),
      onSlotsChanged(cb) {
        if (typeof cb !== 'function') throw new TypeError('Expected callback');
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (typeof unsubscribe === 'function') unsubscribe();
        for (const pending of calls.values()) {
          clearTimeout(pending.timer);
          pending.reject(failure('DESTROYED', 'Adapter destroyed'));
        }
        calls.clear();
        for (const done of pings) done(false);
        subscribers.clear();
      }
    };
  }
  return { createDashboardAdapter };
});
