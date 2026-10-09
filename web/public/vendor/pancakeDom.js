(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.PDBPancakeDom = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const scanIdentityByDocument = new WeakMap();

  function text(element) {
    return String(element?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isInternallyVisible(element, getStyle) {
    const style = getStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && rect.width > 0
      && rect.height > 0;
  }

  function readActiveTagNames(documentRef, options = {}) {
    const getStyle = options.getComputedStyle || globalThis.getComputedStyle;
    const buttons = Array.from(
      documentRef.querySelectorAll('#listShowTags .btn-tag-item, .btn-tag-item')
    );
    return buttons
      .filter((button) => isInternallyVisible(button, getStyle))
      .filter((button) => Boolean(button.querySelector('.ellipse')))
      .map(text)
      .filter(Boolean);
  }

  function readConversationIdentity(element) {
    const keys = new Set();
    const classes = [element, ...Array.from(element.querySelectorAll('[class*="list_tags_conv_"]'))];
    for (const node of classes) {
      for (const token of String(node.className || '').split(/\s+/)) {
        const match = token.match(/^list_tags_conv_(\d+)_(\d+)$/);
        if (match) keys.add('pancake:' + match[1] + ':' + match[2]);
      }
    }
    for (const avatar of Array.from(element.querySelectorAll('img[src]'))) {
      const src = avatar.getAttribute('src');
      try {
        const match = new URL(src, 'https://pancake.invalid').pathname.match(/^\/api\/v1\/pages\/(\d+)\/avatar\/(\d+)\/?$/);
        if (match) keys.add('pancake:' + match[1] + ':' + match[2]);
      } catch (_) {}
    }
    const id = String(element.id || '');
    const code = keys.size > 1 ? 'IDENTITY_CONFLICT' : (!id && !keys.size ? 'MISSING_IDENTITY' : '');
    if (code) {
      const error = new Error(code);
      error.code = code;
      error.keys = Array.from(keys);
      throw error;
    }
    const key = Array.from(keys)[0] || id;
    return { id: id || key, key };
  }

  function readConversationInfo(element, index) {
    const identity = readConversationIdentity(element);
    const tagElements = Array.from(
      element.querySelectorAll('.list-tags-conv .conversation_tags_item')
    );
    const tags = tagElements.map(text).filter(Boolean);
    return {
      ...(index == null ? {} : { index }),
      id: identity.id,
      ...(identity.key === identity.id ? {} : { identityKey: identity.key }),
      name: text(element.querySelector('.name-text')),
      snippet: text(element.querySelector('.snippet-text')),
      tags,
      hasTags: tags.length > 0
    };
  }

  function collectUnreadConversations(documentRef, options = {}) {
    const getStyle = options.getComputedStyle || globalThis.getComputedStyle;
    const rows = Array.from(documentRef.querySelectorAll('.conversation-list-item.unread'));
    const items = [];
    const scanKeys = new Map();
    let rawCount = 0;
    let malformedCount = 0;
    let rejectedCounts = {};
    const entries = readConversationEntries(documentRef);
    const counts = new Map();
    for (const entry of entries) {
      for (const key of entry.claims) counts.set(key, (counts.get(key) || 0) + 1);
    }
    const reject = (code) => {
      malformedCount += 1;
      rejectedCounts = { ...rejectedCounts, [code]: (rejectedCounts[code] || 0) + 1 };
    };
    for (const row of rows) {
      if (!row?.isConnected) {
        reject('DETACHED');
        continue;
      }
      rawCount += 1;
      try {
        if (!isInternallyVisible(row, getStyle)) {
          rejectedCounts = { ...rejectedCounts, HIDDEN: (rejectedCounts.HIDDEN || 0) + 1 };
          continue;
        }
        const identity = readConversationIdentity(row);
        if (counts.get(identity.id) > 1 || counts.get(identity.key) > 1) {
          reject('DUPLICATE_IDENTITY');
          continue;
        }
        const info = readConversationInfo(row, items.length);
        scanKeys.set(info.id, info.identityKey || info.id);
        items.push(info);
      } catch (error) {
        reject(error.code === 'IDENTITY_CONFLICT' || error.code === 'MISSING_IDENTITY' ? error.code : 'MALFORMED');
      }
    }
    scanIdentityByDocument.set(documentRef, scanKeys);
    return { rawCount, items, malformedCount, rejectedCounts, degraded: rows.length > 0 && items.length === 0 };
  }

  function readConversationEntries(documentRef) {
    const entries = [];
    for (const row of Array.from(documentRef.querySelectorAll('.conversation-list-item'))) {
      if (!row?.isConnected) continue;
      try {
        const identity = readConversationIdentity(row);
        entries.push({ row, ...identity, valid: true, claims: [...new Set([identity.id, identity.key])] });
      } catch (error) {
        const claims = [...new Set([String(row.id || ''), ...(error.keys || [])].filter(Boolean))];
        entries.push({ row, valid: false, claims });
      }
    }
    return entries;
  }

  function findConversationElementById(documentRef, id) {
    const conversationId = String(id || '');
    if (!conversationId) return null;
    const entries = readConversationEntries(documentRef);
    const matches = entries.filter((entry) => entry.valid && entry.id === conversationId);
    if (matches.length !== 1) return null;
    const target = matches[0];
    if (entries.filter((entry) => entry.claims.includes(target.key) || entry.claims.includes(target.id)).length !== 1) return null;
    return target.row;
  }

  async function clickConversationById(documentRef, id, expectedKey = '') {
    const element = findConversationElementById(documentRef, id);
    if (!element) return { ok: false, code: 'STALE_CONVERSATION' };
    const initialIdentity = readConversationIdentity(element);
    const scanKey = String(expectedKey || scanIdentityByDocument.get(documentRef)?.get(String(id)) || initialIdentity.key);
    if (initialIdentity.key !== scanKey) return { ok: false, code: 'STALE_CONVERSATION' };
    const info = readConversationInfo(element);
    if (String(info.id) !== String(id)) return { ok: false, code: 'STALE_CONVERSATION' };
    element.scrollIntoView({ block: 'center' });
    if (findConversationElementById(documentRef, id) !== element) return { ok: false, code: 'STALE_CONVERSATION' };
    try {
      const currentIdentity = readConversationIdentity(element);
      if (!element.isConnected || currentIdentity.id !== initialIdentity.id || currentIdentity.key !== initialIdentity.key || currentIdentity.key !== scanKey) return { ok: false, code: 'STALE_CONVERSATION' };
    } catch (_) {
      return { ok: false, code: 'STALE_CONVERSATION' };
    }
    element.click();
    return { ok: true, info };
  }

  function findMarkUnreadButton(documentRef, options = {}) {
    const getStyle = options.getComputedStyle || globalThis.getComputedStyle;
    const isVisible = (el) => {
      if (!el) return false;
      if (!getStyle) return true;
      try {
        const style = getStyle(el);
        const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : { width: 20, height: 20 };
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && (rect.width == null || rect.width > 0)
          && (rect.height == null || rect.height > 0);
      } catch (_) {
        return true;
      }
    };

    const mailUnread = documentRef.querySelector('g[id="Mail Unread"], [id="Mail Unread"]');
    if (mailUnread) {
      const btn = (typeof mailUnread.closest === 'function' ? mailUnread.closest('.conv-action-btn') : null)
        || (typeof mailUnread.closest === 'function' ? mailUnread.closest('div, button') : null);
      if (btn && isVisible(btn)) return btn;
    }

    const candidates = Array.from(documentRef.querySelectorAll('.conv-action-btn, .pancake-antd-tooltip')).filter(isVisible);
    return candidates.find((el) => {
      if (el.querySelector('g[id="Mail Unread"], [id="Mail Unread"], g[id*="Mail" i], [id*="unread" i]')) return true;
      const d = el.querySelector('path')?.getAttribute('d') || '';
      return d.startsWith('M17.1591') || d.startsWith('M14.5 7') || d.includes('M13.309 7.792') || d.includes('6.373V12.5');
    }) || null;
  }

  return {
    collectUnreadConversations,
    findConversationElementById,
    clickConversationById,
    readActiveTagNames,
    findMarkUnreadButton
  };
});
