(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.PDBPancakeUrlPolicy = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const PANCAKE_CHAT_URL = 'https://pancake.vn/multi_pages';

  function parseHttpsUrl(value) {
    try {
      const parsed = new URL(String(value || '').trim());
      return parsed.protocol === 'https:' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function isAllowedAutomationUrl(value) {
    const parsed = parseHttpsUrl(value);
    if (!parsed) return false;
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'pages.fm') return true;
    return host === 'pancake.vn'
      && (parsed.pathname === '/multi_pages' || parsed.pathname.startsWith('/multi_pages/'));
  }

  function normalizeBotUrl(value) {
    const parsed = parseHttpsUrl(value);
    if (!parsed) return '';
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    if (host === 'pages.fm' && path === '/') return PANCAKE_CHAT_URL;
    if (host === 'pancake.vn' && (path === '/' || path === '/dashboard')) return PANCAKE_CHAT_URL;
    return isAllowedAutomationUrl(parsed.href) ? parsed.href : '';
  }

  return { PANCAKE_CHAT_URL, isAllowedAutomationUrl, normalizeBotUrl };
});
