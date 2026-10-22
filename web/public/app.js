// Web transport. Business logic below is a mechanical desktop port.
// ponytail: copied loop keeps desktop behavior; T4 verifies real bridge, recovery and concurrent dashboard tabs.
const adapter = window.PDBDashboardAdapter.createDashboardAdapter({
  postMessage: (message) => window.postMessage(message, window.location.origin),
  addListener: (listener) => {
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }
});
const desktopOnly = async () => { toast('Chỉ có ở bản desktop'); return []; };
function openExternal(url) {
  const parsed = new URL(url, window.location.origin);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('URL không hợp lệ');
  return window.open(parsed.href, '_blank', 'noopener,noreferrer');
}
window.pancakeDesktop = {
  getEnv: async () => window.PDB_ENV,
  setBotActive: (payload) => adapter.setBotActive(payload),
  openExternal,
  showMessage: async (message) => toast(typeof message === 'string' ? message : message?.message || ''),
  onVisibilityChange: (callback) => {
    const listener = () => callback(document.hidden ? 'hidden' : 'visible');
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
  listExtensions: desktopOnly, reloadExtensions: desktopOnly, openExtensionsFolder: desktopOnly
};

function openPancakeTab(url = pancakeUrl, slot) {
  if (!window.PDBPancakeUrlPolicy.isAllowedAutomationUrl(url)) throw new Error('URL Pancake không hợp lệ');
  return (async () => {
    try {
      const alive = await adapter.ping();
      if (alive) {
        await adapter.openTab(url);
        return;
      }
    } catch (_) {}
    openExternal(url);
  })();
}

async function checkBridge() {
  const alive = await adapter.ping();
  $('webviewStatus').textContent = alive ? 'Bridge connected' : 'Bridge disconnected';
  toast(alive ? 'Bridge đang hoạt động' : 'Bridge chưa kết nối');
  return alive;
}

function renderSlots(slots) {
  for (const slot of slots) {
    $(`${slot.slot}Status`).textContent = slot.connected ? 'Connected' : 'Disconnected';
    $(`${slot.slot}Url`).textContent = slot.url || 'Chưa có tab Pancake';
  }
}

let machineId = '';
let heldLease = null;
let leaseTimer = null;
// leaseEpoch increments on every loseLease(): in-flight extend responses that
// come back AFTER a loss are ignored, so a late success can never resurrect the
// lease and re-open the write gate. Loss is terminal only on a definitive
// conflict (another machine holds it); transient network/5xx errors retry.
let leaseEpoch = 0;
const leaseWrites = new Set(['clickConversationById', 'setReplyText', 'clickSendButton', 'applyTagByName', 'markCurrentConversationUnread', 'clearReplyText']);
function leaseExpiresAt(lease) {
  return typeof lease?.expiresAt === 'number' ? lease.expiresAt : Date.parse(lease?.expiresAt);
}
function ownsLease() {
  return heldLease?.owner === machineId && leaseExpiresAt(heldLease) > Date.now();
}

// Nonce định danh thời điểm mở tab (tabNonce lớn hơn = tab sinh sau)
const tabNonce = (typeof window !== 'undefined' && window.__testTabNonce) || (Date.now() + Math.random());
let tabChannel = null;

function mintMachineId() {
  return (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function')
    ? window.crypto.randomUUID()
    : `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Phát hiện và xử lý trùng lặp machineId khi Duplicate Tab (P1.3 parity):
// Khi user Duplicate Tab trên Chrome, sessionStorage được sao chép nguyên trạng sang tab mới.
// Cả hai tab sẽ cùng mang một machineId -> đều tưởng mình giữ bot-lease và chạy trùng bot.
// Dùng BroadcastChannel để các tab cùng origin chào nhau (hello { machineId, tabNonce }).
// Nếu nhận được hello cùng machineId từ một tab khác (khác tabNonce):
// - Tab sinh sau (tabNonce lớn hơn) sẽ tự sinh machineId MỚI và lưu lại sessionStorage của nó.
// - Tab sinh trước (tabNonce nhỏ hơn) phát lại hello để tab sinh sau nhận biết.
// Code fail-soft: nếu BroadcastChannel không tồn tại thì giữ nguyên hành vi cũ, không làm hỏng dashboard.
function initDuplicateTabGuard() {
  if (tabChannel) return tabChannel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    tabChannel = new BroadcastChannel('pdb-tabs');
    const onMessage = (event) => {
      const data = event?.data;
      if (!data || data.type !== 'hello') return;
      if (data.machineId === machineId && data.tabNonce !== tabNonce) {
        if (tabNonce > data.tabNonce) {
          // Tab sinh sau -> tự sinh machineId MỚI và cập nhật sessionStorage
          machineId = mintMachineId();
          const store = typeof sessionStorage !== 'undefined' ? sessionStorage : localStorage;
          if (store && typeof store.setItem === 'function') {
            store.setItem('pdb-machine-id', machineId);
          }
          try {
            tabChannel.postMessage({ type: 'hello', machineId, tabNonce });
          } catch (_) {}
        } else {
          // Tab sinh trước -> phát lại hello để tab sinh sau biết mà đổi
          try {
            tabChannel.postMessage({ type: 'hello', machineId, tabNonce });
          } catch (_) {}
        }
      }
    };
    if (typeof tabChannel.addEventListener === 'function') {
      tabChannel.addEventListener('message', onMessage);
    }
    tabChannel.onmessage = onMessage;
    // Khi tải, tab phát hello { machineId, tabNonce }
    const currentId = machineId || getMachineId();
    tabChannel.postMessage({ type: 'hello', machineId: currentId, tabNonce });
    return tabChannel;
  } catch (_) {
    return null;
  }
}

function getMachineId() {
  if (machineId) return machineId;
  // Per-tab identity (frozen §4ter): sessionStorage so two tabs in the same
  // browser are distinct lease holders; localStorage only as a fallback when
  // sessionStorage is unavailable (private mode), keeping reload-stable identity.
  const store = typeof sessionStorage !== 'undefined' ? sessionStorage : localStorage;
  const stored = store ? store.getItem('pdb-machine-id') : null;
  // crypto.randomUUID needs a secure context; plain-http LAN access falls back
  // to a weaker-but-sufficient random id (it is a lease owner label, not a secret).
  machineId = stored || mintMachineId();
  if (store && !stored) store.setItem('pdb-machine-id', machineId);
  initDuplicateTabGuard();
  return machineId;
}
function loseLease() {
  leaseEpoch += 1;
  heldLease = null;
  clearInterval(leaseTimer);
  leaseTimer = null;
  forEachBotTab((tab) => { tab.runtime.botRunning = false; tab.runtime.autoClickRunning = false; });
  refreshActiveTabRuntimeUi();
}
async function loadLease() {
  const warning = $('leaseWarning');
  try {
    const { lease } = await api('/api/bot-lease');
    const foreign = lease && lease.owner !== getMachineId() && leaseExpiresAt(lease) > Date.now();
    warning.hidden = !foreign;
    warning.textContent = foreign ? `${lease.owner} đang giữ bot lease` : '';
    if (!heldLease) return;
    if (foreign) { loseLease(); return; }
    // Server quên lease (restart, TTL) nhưng không ai giữ: acquire lại thay vì
    // dừng bot. Nếu người khác vừa chiếm, extend trả !ok và loseLease ở đó.
    if (!lease) await extendBotLease();
  } catch (error) {
    warning.hidden = error.status === 404;
    warning.textContent = error.status === 404 ? '' : 'Không xác minh được bot lease';
    // Lỗi mạng/5xx là tạm thời: giữ lease và thử lại nhịp sau. Chỉ dừng khi
    // phiên đăng nhập mất hiệu lực (401/403).
    if (heldLease && (error.status === 401 || error.status === 403)) loseLease();
  }
}
let extendInFlight = null;
async function extendBotLease() {
  // Một heartbeat mỗi lúc: vòng lặp bot và timer 20s cùng gọi extend,
  // gộp lại một request để không chồng chất và không lỗi "muộn" giả.
  if (extendInFlight) return extendInFlight;
  const epoch = leaseEpoch;
  extendInFlight = (async () => {
    try {
      const data = await api('/api/bot-lease', {
        method: 'POST',
        body: JSON.stringify({ action: 'extend', machineId: getMachineId() }),
        // Fetch treo vĩnh viễn từng làm lease âm thầm hết hạn TTL; chặn 8s để
        // mất lease luôn được PHÁT HIỆN, không phải đoán qua TTL hết hạn.
        signal: (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') ? AbortSignal.timeout(8000) : undefined
      });
      // A late response after a loss must not resurrect the lease (MAJOR T5c).
      if (epoch !== leaseEpoch) return;
      if (!data.ok || data.lease?.owner !== machineId) {
        loseLease();
        toast('Mất bot lease: Emergency Stop', 5000);
        return;
      }
      heldLease = data.lease;
    } catch (error) {
      if (epoch !== leaseEpoch) return;
      const status = Number(error?.status || 0);
      // Chỉ dừng khi server từ chối dứt khoát (4xx, trừ timeout/rate-limit).
      // Lỗi mạng hoặc 5xx (server restart, tab bị throttle) là tạm thời:
      // giữ lease và thử lại ở nhịp heartbeat/vòng lặp kế tiếp.
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        loseLease();
        toast('Mất bot lease: Emergency Stop', 5000);
      }
    } finally { extendInFlight = null; }
  })();
  return extendInFlight;
}
// Heartbeat piggyback (vá BOT_LOOP_ERROR "Cần giữ bot lease"): timer 20s có
// thể ngừng chạy mà handle vẫn còn sống (máy sleep/resume, tab bị freeze,
// timer bị throttle) hoặc handle bị dọn (pagehide); trong khi đó vòng lặp bot
// vẫn chạy. Mỗi vòng lặp tự gia hạn khi TTL còn lại ≤ 25s — đây là nhánh bắt
// được sự cố thật vì expiresAt là mốc thời gian tuyệt đối — hoặc khi handle
// timer đã mất. Server luôn là trọng tài: người khác giữ lease → extend trả
// !ok → loseLease terminal (frozen §4ter: mất là mất vĩnh viễn); lease
// rỗng/hết hạn → server cấp lại cho đúng owner theo chính hợp đồng extend —
// bot tự hồi phục thay vì dừng đột ngột.
async function keepLeaseFresh() {
  if (!heldLease) return;
  if (leaseTimer && leaseExpiresAt(heldLease) - Date.now() > 25000) return;
  await extendBotLease();
}
let leaseAcquirePromise = null;
async function acquireBotLease() {
  if (ownsLease()) return;
  if (leaseAcquirePromise) return leaseAcquirePromise;
  leaseAcquirePromise = (async () => {
    const data = await api('/api/bot-lease', { method: 'POST', body: JSON.stringify({ action: 'acquire', machineId: getMachineId() }) });
    if (!data.ok || data.lease?.owner !== machineId || leaseExpiresAt(data.lease) <= Date.now()) {
      throw new Error(data.holder ? `${data.holder} đang giữ bot lease` : 'Không lấy được bot lease');
    }
    heldLease = data.lease;
    clearInterval(leaseTimer);
    leaseTimer = setInterval(extendBotLease, 20000);
    await loadLease();
    if (!ownsLease()) throw new Error('Không xác minh được bot lease');
  })();
  try { await leaseAcquirePromise; } finally { leaseAcquirePromise = null; }
}
async function releaseBotLease() {
  const owned = Boolean(heldLease);
  loseLease();
  if (owned) await api('/api/bot-lease', { method: 'POST', body: JSON.stringify({ action: 'release', machineId: getMachineId() }) });
}

function bindWebSession() {
  document.querySelectorAll('[data-open-slot]').forEach((btn) => btn.addEventListener('click', () => {
    try { openPancakeTab(pancakeUrl, btn.dataset.openSlot); } catch (error) { toast(error.message); }
  }));
  document.querySelectorAll('[data-ping-slot]').forEach((btn) => btn.addEventListener('click', checkBridge));
  $('acquireLeaseBtn').addEventListener('click', async () => {
    try { await acquireBotLease(); toast('Đã giữ bot lease'); } catch (error) { toast(error.message, 5000); }
  });
  // Đăng nhập theo mode của server: unconfigured → pdb (cổ điển); bootstrap →
  // pdb (1 lần duy nhất) + tài khoản Supabase; active → chỉ Supabase.
  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const tokenInput = $('accessToken');
    try {
      let accessToken = '';
      const useSupa = authMode.mode !== 'unconfigured';
      if (useSupa && ($('loginEmail').value || authMode.mode === 'bootstrap')) accessToken = await supabasePasswordGrant();
      const route = authMode.mode === 'bootstrap' ? '/api/auth/bootstrap'
        : accessToken ? '/api/auth/supabase-login' : '/api/auth/login';
      const body = route === '/api/auth/bootstrap' ? { token: tokenInput.value, accessToken }
        : accessToken ? { accessToken } : { token: tokenInput.value };
      await api(route, { method: 'POST', body: JSON.stringify(body) });
      $('loginError').textContent = '';
      window.location.reload();
    } catch (error) {
      if (error.status === 403) $('loginError').textContent = 'Tài khoản đã ghi nhận — chờ quản trị duyệt.';
      else $('loginError').textContent = error.message;
    } finally { tokenInput.value = ''; $('loginPassword').value = ''; }
  });
  $('logoutBtn').addEventListener('click', async () => {
    try {
      await releaseBotLease();
      await api('/api/auth/logout', { method: 'POST' });
      window.location.reload();
    } catch (error) { toast(error.message); }
  });
}

// ---- Máy trạng thái đăng nhập (song hành với src/server/supabaseAuth.js) ----
// unconfigured: chỉ pdb (cổ điển). bootstrap: pdb 1 lần + Supabase.
// active: chỉ Supabase (thêm pdb khi break-glass). Mật khẩu Supabase chỉ đi
// thẳng lên Supabase; server của ta chỉ nhận access_token đã verify.
let authMode = { mode: 'unconfigured', supabaseUrl: null, supabaseAnonKey: null, emergencyPdb: false };

function applyLoginMode() {
  const useSupa = authMode.mode !== 'unconfigured';
  const showPdb = !useSupa || authMode.mode === 'bootstrap' || authMode.emergencyPdb === true;
  $('loginTokenLabel').hidden = !showPdb;
  $('accessToken').hidden = !showPdb;
  $('accessToken').required = showPdb;
  $('loginEmailLabel').hidden = !useSupa;
  $('loginEmail').hidden = !useSupa;
  $('loginEmail').required = useSupa && authMode.mode === 'bootstrap';
  $('loginPasswordLabel').hidden = !useSupa;
  $('loginPassword').hidden = !useSupa;
  $('loginPassword').required = useSupa;
  const hint = $('loginModeHint');
  hint.hidden = authMode.mode !== 'bootstrap';
  hint.textContent = authMode.mode === 'bootstrap'
    ? 'Đăng nhập lần đầu: dán token + tài khoản Supabase. Token chỉ dùng đúng 1 lần này.'
    : '';
}

async function loadAuthMode() {
  try { authMode = await api('/api/auth/mode'); } catch (_) { authMode = { mode: 'unconfigured' }; }
  applyLoginMode();
  return authMode;
}

async function supabasePasswordGrant() {
  const response = await fetch(`${authMode.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: authMode.supabaseAnonKey },
    body: JSON.stringify({ email: $('loginEmail').value.trim(), password: $('loginPassword').value })
  });
  if (!response.ok) throw Object.assign(new Error('Sai email hoặc mật khẩu Supabase'), { status: response.status });
  return String((await response.json()).access_token || '');
}

// Card quản lý user: chỉ owner thấy (api trả 403 với người thường → ẩn card).
async function loadUsersCard() {
  try {
    const data = await api('/api/auth/users');
    if (!data || !Array.isArray(data.users)) return;
    $('usersOwnerInfo').textContent = data.owner?.email ? `Chủ máy: ${data.owner.email}` : 'Chủ máy';
    const list = $('usersList');
    list.textContent = '';
    if (!data.users.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Chưa có ai chờ duyệt.';
      list.appendChild(empty);
    }
    for (const user of data.users) {
      const row = document.createElement('div');
      row.className = 'user-row';
      const info = document.createElement('span');
      info.textContent = `${user.email || user.userId} — ${user.status === 'approved' ? 'đã duyệt' : 'chờ duyệt'}`;
      row.appendChild(info);
      if (user.status === 'pending') {
        for (const decision of ['approve', 'reject']) {
          const btn = document.createElement('button');
          btn.className = decision === 'approve' ? 'btn' : 'btn ghost';
          btn.type = 'button';
          btn.textContent = decision === 'approve' ? 'Duyệt' : 'Từ chối';
          btn.addEventListener('click', async () => {
            try {
              await api('/api/auth/users/decide', { method: 'POST', body: JSON.stringify({ userId: user.userId, decision }) });
              await loadUsersCard();
            } catch (e) { toast(e.message, 5000); }
          });
          row.appendChild(btn);
        }
      }
      list.appendChild(row);
    }
    $('usersCard').hidden = false;
  } catch (_) {
    $('usersCard').hidden = true;
  }
}

// ===========================================================================
// Pancake Desktop AI Shortcut Bot — renderer
// Sections: state, helpers, server API, bridge automation, AI & learning,
// extensions, bot loop, UI bindings, init.
// ===========================================================================

const $ = (id) => document.getElementById(id);
const SHORTCUT_RE = /^\/\d+$/; // a valid shortcut is "/" followed by digits

// --- Mutable state ---
let pancakeUrl = 'https://pages.fm/';
let settings = {};
let shortcuts = [];
let examplesCache = [];
let learnedCount = 0;
let lastAnalysis = null;
let lastCustomerMessage = ''; // most recent analyzed message (used for learning)
let currentContextMessage = ''; // tin mới nhất của khách Trợ lý vừa đọc (live-suggest-fill)
let activeWvTab = 'bot1'; // 'bot1'/'bot2' run bot, 'manual' is clean/manual
let pageVisible = true;
let reviewQueueTimer = null;   // setInterval handle while the queue tab is open
let reviewQueueCache = [];     // last rendered pending items (kept on load error)
const timers = [];

// Cap the processed-conversation cache so a long-running bot session cannot
// grow memory without bound. Entries also expire by time (PROCESSED_TTL_MS).
const PROCESSED_MAX_ENTRIES = 200;
const PROCESSED_TTL_MS = 60000;

// --- Auto Click (chế độ tốc độ cao, độc lập hoàn toàn với Bot AI) ---
// State TÁCH BIỆT với botRunning/processed của Bot AI (không gộp chung).
const AUTOCLICK_PROCESSED_TTL_MS = 60000;
const AUTOCLICK_PROCESSED_MAX_ENTRIES = 200;

function createBotRuntime(tabId) {
  return {
    tabId,
    botRunning: false,
    botLoopPromise: null,
    processed: new Map(),
    lastAnalysis: null,
    lastCustomerMessage: '',
    currentContextMessage: '',
    autoClickRunning: false,
    autoClickLoopPromise: null,
    autoClickProcessed: new Map()
  };
}

// Three bridge slots; independent business runtimes retained.
const webviewTabs = {
  bot1: { id: 'bot1', label: 'Bot 1', botCapable: true, runtime: createBotRuntime('bot1') },
  bot2: { id: 'bot2', label: 'Bot 2', botCapable: true, runtime: createBotRuntime('bot2') },
  manual: { id: 'manual', label: 'Tab 3', botCapable: false, runtime: null }
};

const processed = webviewTabs.bot1.runtime.processed;
const autoClickProcessed = webviewTabs.bot1.runtime.autoClickProcessed;
let botRunning = false;
let botLoopPromise = null;
let autoClickRunning = false;
let autoClickLoopPromise = null;

// --- Trợ lý gợi ý real-time (suggest-only, độc lập botLoop) ---
let assistantEnabled = false;   // Công_Tắc_Trợ_Lý, mặc định TẮT (Req 4.2)
let assistantTimer = null;      // interval đọc id cuộc đang mở (1.2s)
let assistantDebounce = null;   // setTimeout debounce 1s (Req 6.2)
let lastConversationId = '';    // id cuộc xử lý gần nhất (phát hiện đổi cuộc)
const suggestCache = new Map(); // key: nội dung tin mới nhất -> analysis (Req 6.3/6.4)
const SUGGEST_CACHE_MAX = 100;  // chặn phình bộ nhớ

// Tạo khóa dedupe ổn định từ một unread conversation (Req 7.1).
// Ưu tiên id; thiếu id thì dùng tổ hợp name + snippet. An toàn khi conv null/undefined.
function makeDedupeKey(conv) {
  if (conv && conv.id) return String(conv.id);
  const name = (conv && conv.name) || '';
  const snippet = (conv && conv.snippet) || '';
  return `${name}-${snippet}`;
}

// Quyết định có bỏ qua khách vì đã có thẻ hay không (Req 4.1).
// Trả về true KHI VÀ CHỈ KHI hasTags === true HOẶC tags có ≥ 1 phần tử.
// An toàn khi info null/undefined → false.
function shouldSkipByTags(info) {
  if (window.PDBBotDecision?.shouldSkipByTags) return window.PDBBotDecision.shouldSkipByTags(info);
  if (!info) return false;
  return Boolean(info.hasTags || (info.tags || []).length > 0);
}

// Ghi key + timestamp vào autoClickProcessed; dọn mục quá TTL và giới hạn số mục
// (Req 7.2, 7.3, 7.4). Nhận `now` để test kiểm soát thời gian. Cùng style rememberProcessed.
function rememberAutoClickProcessed(key, now = Date.now(), runtime = getActiveBotRuntime() || webviewTabs.bot1.runtime) {
  const cache = runtime?.autoClickProcessed || autoClickProcessed;
  cache.set(key, now);
  for (const [k, ts] of cache) {
    if (now - ts > AUTOCLICK_PROCESSED_TTL_MS) cache.delete(k);
  }
  while (cache.size > AUTOCLICK_PROCESSED_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

const isShortcut = (value) => SHORTCUT_RE.test(String(value || '').trim());

// --- Theme (light/dark) ---
function applyTheme(theme) {
  const dark = theme === 'dark';
  document.body.classList.toggle('dark', dark);
  const btn = $('themeBtn');
  if (btn) {
    if (window.PDBIcons) window.PDBIcons.set(btn, dark ? 'sun' : 'moon');
    else btn.textContent = dark ? '☀️' : '🌙';
    btn.setAttribute('aria-label', dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối');
  }
}

function syncLegacyRuntimeAliases(runtime = getActiveBotRuntime() || webviewTabs.bot1.runtime) {
  botRunning = Boolean(runtime?.botRunning);
  botLoopPromise = runtime?.botLoopPromise || null;
  autoClickRunning = Boolean(runtime?.autoClickRunning);
  autoClickLoopPromise = runtime?.autoClickLoopPromise || null;
}

function forEachBotTab(callback) {
  Object.values(webviewTabs).filter((tab) => tab.botCapable && tab.runtime).forEach(callback);
}

function anyRuntimeBotRunning() {
  return Object.values(webviewTabs).some((tab) => Boolean(tab.runtime?.botRunning));
}

function anyRuntimeAutoClickRunning() {
  return Object.values(webviewTabs).some((tab) => Boolean(tab.runtime?.autoClickRunning));
}

function initTheme() {
  let theme = 'light';
  try { theme = localStorage.getItem('pdb-theme') || 'light'; } catch (_) {}
  applyTheme(theme);
}

function toggleTheme() {
  const dark = !document.body.classList.contains('dark');
  const theme = dark ? 'dark' : 'light';
  applyTheme(theme);
  try { localStorage.setItem('pdb-theme', theme); } catch (_) {}
}

function rememberProcessed(key, runtime = getActiveBotRuntime() || webviewTabs.bot1.runtime) {
  const now = Date.now();
  const cache = runtime?.processed || processed;
  cache.set(key, now);
  for (const [k, ts] of cache) {
    if (now - ts > PROCESSED_TTL_MS) cache.delete(k);
  }
  while (cache.size > PROCESSED_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

function rememberProcessedForAllBotRuntimes(key) {
  forEachBotTab((tab) => rememberProcessed(key, tab.runtime));
}

function toast(message, ms = 2600) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch (_) {}
    if (res.status === 401) $('loginPanel').hidden = false;
    throw Object.assign(new Error(`${res.status} ${res.statusText} ${detail}`), { status: res.status });
  }
  return res.json();
}

async function log(level, type, message, data = null) {
  try { await api('/api/logs', { method: 'POST', body: JSON.stringify({ level, type, message, data }) }); } catch (_) {}
  await loadLogs();
}

function getTab(tabId = activeWvTab) {
  return webviewTabs[tabId] || webviewTabs.bot1;
}

function getActiveBotRuntime() {
  const tab = getTab(activeWvTab);
  return tab.botCapable ? tab.runtime : null;
}

function getRuntimeLabel(runtime) {
  return getTab(runtime?.tabId)?.label || 'Bot';
}

function prefixRuntime(runtime, message) {
  return `[${getRuntimeLabel(runtime)}] ${message}`;
}

function serializeError(error) {
  if (!error) return 'Lỗi không xác định';
  if (typeof error === 'string') return error;
  const parts = [];
  if (error.message) parts.push(error.message);
  if (error.code) parts.push(`code=${error.code}`);
  if (error.name) parts.push(`name=${error.name}`);
  try {
    const json = JSON.stringify(error);
    if (json && json !== '{}') parts.push(json);
  } catch (_) {}
  return parts.join(' | ') || String(error);
}

async function executeInTab(tabId, methodName, args = []) {
  if (leaseWrites.has(methodName) && !ownsLease()) {
    // Lease local hết hạn trong lúc mạng chập chờn: thử gia nhập lại một lần
    // (server re-acquire nếu lease trống) trước khi dừng fail-closed.
    if (heldLease) await extendBotLease();
    if (!ownsLease()) {
      loseLease();
      throw Object.assign(new Error('Cần giữ bot lease trước khi thao tác Pancake'), { code: 'BOT_LEASE_REQUIRED' });
    }
  }
  return adapter.call(tabId, methodName, args);
}

async function botCallForTab(tabId, method, ...args) {
  const tab = getTab(tabId);
  if (!tab.botCapable) throw new Error('Tab này không hỗ trợ bot');
  return executeInTab(tab.id, method, args);
}

async function botCall(method, ...args) {
  const tab = getTab(activeWvTab);
  if (!tab.botCapable) throw new Error('Tab này không hỗ trợ bot');
  return botCallForTab(tab.id, method, ...args);
}

function safeJson(data) { return JSON.stringify(data, null, 2); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function loadHealth() {
  try {
    const health = await api('/health');
    $('serverBadge').textContent = 'Server Online';
    $('serverBadge').className = 'badge online';
    $('shortcutCount').textContent = health.shortcutCount || 0;
    $('botState').textContent = health.settings?.botEnabled ? 'ON' : 'OFF';
    $('autoSendState').textContent = health.settings?.autoSend ? 'ON' : 'OFF';
  } catch (error) {
    $('serverBadge').textContent = 'Server Offline';
    $('serverBadge').className = 'badge offline';
  }
}

function setRuntimeState(label, level = 'muted') {
  const el = $('runtimeState');
  if (el) el.textContent = label;
  const badge = $('safetyState');
  if (badge && level === 'error') badge.className = 'badge offline';
}

function setSafetyState(label, level = 'warn', reason = '') {
  const badge = $('safetyState');
  if (badge) {
    badge.textContent = label;
    badge.className = level === 'ok' ? 'badge online' : 'badge offline';
  }
  const failSafe = $('lastFailSafe');
  if (failSafe) failSafe.textContent = reason || '—';
}

function setLastDecision(action, reason = '') {
  const el = $('lastDecision');
  if (el) el.textContent = action || '—';
  if (reason) setSafetyState('Fail-safe', 'warn', reason);
}

function setRuntimeLastDecision(runtime, action, reason = '') {
  if (!runtime || runtime.tabId === activeWvTab) setLastDecision(action, reason);
}

function setActiveRuntimeMessages(runtime) {
  if (!runtime || runtime.tabId !== activeWvTab) return;
  lastAnalysis = runtime.lastAnalysis;
  lastCustomerMessage = runtime.lastCustomerMessage;
  currentContextMessage = runtime.currentContextMessage;
}

async function loadSettings() {
  settings = await api('/api/settings');
  $('botEnabled').checked = Boolean(settings.botEnabled);
  $('autoSend').checked = Boolean(settings.autoSend);
  $('shortcutOnlyMode').checked = settings.shortcutOnlyMode !== false;
  if ($('buyTtsEnabled')) $('buyTtsEnabled').checked = settings.buyTtsEnabled !== false;
  if ($('buyTtsDebounceMs')) $('buyTtsDebounceMs').value = settings.buyTtsDebounceMs || 1500;
  if ($('ttsProvider')) $('ttsProvider').value = settings.ttsProvider || 'api';
  if ($('ttsBaseUrl')) $('ttsBaseUrl').value = settings.ttsBaseUrl || '';
  if ($('ttsApiKey')) {
    $('ttsApiKey').value = '';
    $('ttsApiKey').placeholder = settings.ttsApiKeyMasked || 'sk-...';
  }
  if ($('ttsModel')) $('ttsModel').value = settings.ttsModel || 'google-tts/vi';
  if ($('learnExamplesEnabled')) $('learnExamplesEnabled').checked = settings.learnExamplesEnabled !== false;
  $('newCustomerShortcut').value = settings.defaultNewCustomerShortcut || '/1';
  $('newCustomerTag').value = settings.newCustomerTagName || 'Saruto Mới';
  $('buyTag').value = settings.buyTagName || 'Mua hàng';
  $('minConfidence').value = settings.minConfidence || 0.75;
  if ($('autoClickDelayMs')) $('autoClickDelayMs').value = settings.autoClickDelayMs || 3000;
  refreshActiveTabRuntimeUi();
}

async function saveSettingsFromUi() {
  const buyTtsDebounceInput = $('buyTtsDebounceMs');
  const parsedBuyTtsDebounceMs = Number((buyTtsDebounceInput && buyTtsDebounceInput.value) || 1500);
  const buyTtsDebounceMs = Number.isFinite(parsedBuyTtsDebounceMs) && parsedBuyTtsDebounceMs >= 300
    ? parsedBuyTtsDebounceMs
    : 1500;
  if (buyTtsDebounceInput) buyTtsDebounceInput.value = buyTtsDebounceMs;

  const ttsApiKeyValue = $('ttsApiKey') ? $('ttsApiKey').value.trim() : '';

  settings = await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({
      botEnabled: Boolean($('botEnabled').checked || anyRuntimeBotRunning()),
      autoSend: $('autoSend').checked,
      shortcutOnlyMode: $('shortcutOnlyMode').checked,
      defaultNewCustomerShortcut: $('newCustomerShortcut').value.trim() || '/1',
      newCustomerTagName: $('newCustomerTag').value.trim() || 'Saruto Mới',
      buyTagName: $('buyTag').value.trim() || 'Mua hàng',
      buyTtsEnabled: $('buyTtsEnabled') ? $('buyTtsEnabled').checked : true,
      buyTtsDebounceMs,
      ttsProvider: $('ttsProvider') ? $('ttsProvider').value : 'api',
      ttsBaseUrl: $('ttsBaseUrl') ? $('ttsBaseUrl').value.trim() : '',
      ttsApiKey: ttsApiKeyValue,
      ttsModel: $('ttsModel') ? $('ttsModel').value.trim() : 'google-tts/vi',
      minConfidence: Number($('minConfidence').value || 0.75),
      autoClickEnabled: Boolean(($('autoClickEnabled') && $('autoClickEnabled').checked) || anyRuntimeAutoClickRunning()),
      autoClickDelayMs: Number(($('autoClickDelayMs') && $('autoClickDelayMs').value) || 3000),
      learnExamplesEnabled: $('learnExamplesEnabled') ? $('learnExamplesEnabled').checked : true
    })
  });
  if ($('ttsApiKey')) {
    $('ttsApiKey').value = '';
    $('ttsApiKey').placeholder = settings.ttsApiKeyMasked || 'sk-...';
  }
  toast('Đã lưu settings');
  await loadHealth();
}

function renderAiConfigStatus(config, message = '') {
  const source = config?.source || {};
  const parts = [
    message || 'AI config sẵn sàng',
    `Base URL: ${config?.aiBaseUrl || ''} (${source.baseUrl || 'n/a'})`,
    `Model: ${config?.aiModel || ''} (${source.model || 'n/a'})`,
    `API Key: ${config?.aiApiKeyMasked || ''} (${source.apiKey || 'n/a'})`,
    config?.resolvedResponsesUrl ? `Endpoint: ${config.resolvedResponsesUrl}` : ''
  ].filter(Boolean);
  $('aiConfigStatus').innerHTML = parts.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
}

async function loadAiConfig() {
  const config = await api('/api/ai/config');
  $('aiBaseUrl').value = config.aiBaseUrl || '';
  if ($('aiApiKey')) {
    $('aiApiKey').value = '';
    $('aiApiKey').placeholder = config.aiApiKeyMasked || 'sk-...';
  }
  $('aiModel').value = config.aiModel || '';
  renderAiConfigStatus(config);
  return config;
}

async function saveAiConfigFromUi() {
  const aiApiKeyValue = $('aiApiKey') ? $('aiApiKey').value.trim() : '';
  const config = await api('/api/ai/config', {
    method: 'POST',
    body: JSON.stringify({
      aiBaseUrl: $('aiBaseUrl').value.trim(),
      aiApiKey: aiApiKeyValue,
      aiModel: $('aiModel').value.trim()
    })
  });
  if ($('aiApiKey')) {
    $('aiApiKey').value = '';
    $('aiApiKey').placeholder = config.aiApiKeyMasked || 'sk-...';
  }
  renderAiConfigStatus(config, 'Đã lưu AI config');
  toast('Đã lưu AI config');
}

async function testAiConfig() {
  const result = await api('/api/ai/test', {
    method: 'POST',
    body: JSON.stringify({
      aiBaseUrl: $('aiBaseUrl').value.trim(),
      aiApiKey: $('aiApiKey').value.trim(),
      aiModel: $('aiModel').value.trim()
    })
  });
  renderAiConfigStatus(result.config, result.message || 'AI test OK');
  toast(result.message || 'AI test OK');
}

async function loadShortcuts() {
  const data = await api('/api/shortcuts');
  shortcuts = data.items || [];
  renderShortcuts();
  renderShortcutPalette();
  $('shortcutCount').textContent = shortcuts.length;
}

function renderShortcuts() {
  const q = ($('shortcutSearch')?.value || '').toLowerCase();
  const filtered = shortcuts.filter((s) => [s.shortcut, s.topic, s.quickReply, s.message, s.folders].join(' ').toLowerCase().includes(q));
  $('shortcutTable').innerHTML = `<table><thead><tr><th>Shortcut</th><th>Topic</th><th>Quick Reply</th><th>Message</th><th>Folder</th></tr></thead><tbody>${filtered.map((s) => `<tr><td><span class="shortcut-pill">${escapeHtml(s.shortcut)}</span></td><td>${escapeHtml(s.topic || '')}</td><td>${escapeHtml(s.quickReply || '')}</td><td>${escapeHtml((s.message || '').slice(0, 90))}</td><td>${escapeHtml(s.folders || '')}</td></tr>`).join('')}</tbody></table>`;
}

// Bảng shortcut dạy/điền (tab Gợi ý): render mọi shortcut đã import thành nút.
function renderShortcutPalette() {
  const box = $('paletteList');
  if (!box) return;
  if (!shortcuts.length) {                                                 // Req 1.4
    box.innerHTML = '<p style="padding:10px;color:var(--muted)">Chưa import shortcut nào. Hãy import file shortcut trước.</p>';
    return;
  }
  const q = ($('paletteSearch')?.value || '').toLowerCase();
  const filtered = shortcuts.filter((s) => `${s.shortcut} ${s.topic || ''}`.toLowerCase().includes(q)); // Req 2.2
  if (!filtered.length) {                                                  // Req 2.4
    box.innerHTML = '<p style="padding:10px;color:var(--muted)">Không có shortcut khớp tìm kiếm.</p>';
    return;
  }
  box.innerHTML = filtered.map((s) =>                                      // Req 1.2, 1.3
    `<button class="btn small palette-btn" data-shortcut="${escapeHtml(s.shortcut)}" title="${escapeHtml(s.topic || '')}">${escapeHtml(s.shortcut)} ${escapeHtml(s.topic || '')}</button>`
  ).join('');
}

// Nguồn học cho thao tác dạy có chủ đích: chỉ dùng khi Trợ lý gợi ý
// real-time đang bật. Ưu tiên ô test #aiMessage, sau đó dùng tin khách mới nhất.
function resolveLearnSource({ allowAssistantContext = assistantEnabled } = {}) {
  const typed = ($('aiMessage')?.value || '').trim();
  if (typed) return typed;
  return allowAssistantContext ? (currentContextMessage || '') : '';
}

function shouldRecordManualExample() {
  const typedMessage = $('aiMessage')?.value || '';
  const learnExamplesEnabled = settings.learnExamplesEnabled !== false;
  if (window.PDBBotDecision?.shouldRecordManualExample) {
    return window.PDBBotDecision.shouldRecordManualExample({ assistantEnabled, typedMessage, learnExamplesEnabled });
  }
  return Boolean(assistantEnabled && learnExamplesEnabled);
}

async function fillShortcutIntoActiveTab(shortcut) {
  const tab = getTab(activeWvTab);
  if (!tab.botCapable) return { ok: false, message: 'Tab hiện tại không hỗ trợ điền shortcut. Hãy chọn Bot 1 hoặc Bot 2.' };
  const ready = getWebviewReadiness(tab);
  if (!ready.ok) return { ok: false, message: `${tab.label}: ${ready.reason}` };
  return botCallForTab(tab.id, 'setReplyText', shortcut.trim());
}

// Bấm nút bảng: điền mã vào Pancake (luôn nếu hợp lệ), chỉ học khi
// Trợ lý gợi ý real-time đang bật. KHÔNG tự gửi.
async function teachAndFill(shortcut) {
  if (!isShortcut(shortcut)) { toast('Shortcut không đúng định dạng'); return; }
  const result = await fillShortcutIntoActiveTab(shortcut);
  const source = shouldRecordManualExample() ? resolveLearnSource() : '';
  if (result?.ok && source) {
    try { await recordExample(source, shortcut, lastAnalysis?.intent || ''); }
    catch (_) { toast('Đã điền nhưng lưu ví dụ thất bại'); }
  }
  toast(result?.ok ? `Đã điền ${shortcut}${source ? ' + đã học' : ''}` : (result?.message || 'Không điền được'));
}

// === Trợ lý gợi ý real-time (Phần 2) — suggest-only, độc lập botLoop ===
// Không phụ thuộc settings.botEnabled (Req 4.3, 4.4). Tuyệt đối không gọi
// applyTagByName/setReplyText/clickSendButton trong luồng này (Req 5.6).
function toggleAssistant() {
  assistantEnabled = $('assistantEnabled').checked;
  if (assistantEnabled && pageVisible) startAssistantWatch();
  else stopAssistantWatch();
}

function startAssistantWatch() {
  stopAssistantWatch();
  lastConversationId = '';
  assistantTimer = setInterval(checkConversationChange, 1200); // chỉ đọc id, rẻ
}

function stopAssistantWatch() {
  if (assistantTimer) clearInterval(assistantTimer);
  assistantTimer = null;
  if (assistantDebounce) clearTimeout(assistantDebounce);
  assistantDebounce = null;
}

async function checkConversationChange() {
  if (!assistantEnabled || !pageVisible) return;        // Req 5.9, 4.5
  let convId = '';
  try { convId = await botCall('getActiveConversationId'); } catch { return; }
  if (!convId || convId === lastConversationId) return; // Req 7.2, 7.3
  lastConversationId = convId;
  if (assistantDebounce) clearTimeout(assistantDebounce);
  assistantDebounce = setTimeout(() => runAssistantSuggest(convId), 1000); // Req 6.2
}

async function runAssistantSuggest(convId) {
  if (!assistantEnabled || !pageVisible) return;
  let history = [], orderStatus = null, name = '';
  try {
    history = await botCall('getRecentMessages', 5);
    orderStatus = await botCall('getCustomerOrderStatus');
    name = await botCall('getCurrentCustomerName');
  } catch (_) { renderAssistantError('Không đọc được hội thoại'); return; }  // Req 5.7
  const latest = lastCustomerText(history);
  if (!latest) { currentContextMessage = ''; renderAssistantEmpty('Chưa có tin để gợi ý'); return; }     // Req 5.2, 1.3
  currentContextMessage = latest;                    // Req 1.1, 1.2 (tin khách mới nhất, không ghép)
  if (suggestCache.has(latest)) { renderAnalysis(suggestCache.get(latest)); return; } // Req 6.3, 1.4
  try {
    const analysis = await api('/api/ai/analyze-message', {
      method: 'POST',
      body: JSON.stringify({ customerMessage: latest, customerName: name, conversationHistory: history, orderStatus, context: { source: 'assistant' } }),
      signal: AbortSignal.timeout(30000)               // Req 5.8
    });
    cacheSuggest(latest, analysis);                    // Req 6.4
    renderAnalysis(analysis);                          // Req 5.3, 5.4
  } catch (_) { renderAssistantError('AI lỗi hoặc quá thời gian'); }         // Req 5.8
}

// Lấy text tin gần nhất do khách gửi trong history [{from,text}]; rỗng -> ''.
function lastCustomerText(history) {
  if (!Array.isArray(history)) return '';
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m && m.from === 'customer') return String(m.text || '').trim();
  }
  return '';
}

// Lưu vào cache, trim cũ nhất khi vượt SUGGEST_CACHE_MAX (giống rememberProcessed).
function cacheSuggest(key, analysis) {
  suggestCache.set(key, analysis);
  while (suggestCache.size > SUGGEST_CACHE_MAX) {
    suggestCache.delete(suggestCache.keys().next().value);
  }
}

function renderAssistantError(msg) {
  $('aiResult').innerHTML = `<div class="suggestion"><p style="color:var(--red)">${escapeHtml(msg)}</p></div>`;
}

function renderAssistantEmpty(msg) {
  $('aiResult').innerHTML = `<div class="suggestion"><p style="color:var(--muted)">${escapeHtml(msg)}</p></div>`;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

function iconSvg(name) {
  return window.PDBIcons ? window.PDBIcons.svg(name) : '';
}

async function loadLogs() {
  try {
    const logs = await api('/api/logs?limit=120');
    $('logsBox').innerHTML = logs.map((l) => `<div class="log-item ${escapeHtml(l.level)}"><b>${escapeHtml(l.level)}</b> <span>${escapeHtml(l.type)}</span><br>${escapeHtml(l.message)}<br><small>${escapeHtml(l.time)}</small></div>`).join('') || '<p>Chưa có log</p>';
  } catch (_) {}
}

// --- Bot stats (đọc từ log sẵn có, không thêm server) ---
// Suy action của một ca: ưu tiên data.analysis.action, fallback tiền tố message.
function resolveBotAction(logItem) {
  let a = logItem?.data?.analysis?.action || logItem?.data?.output?.action || '';
  if (a === 'SKIP') a = 'SKIPPED_NON_TEXT';
  if (a === 'TAG_BUY_AND_MARK_UNREAD') a = 'ESCALATED';
  if (['NEW_CUSTOMER', 'SHORTCUT', 'ESCALATED', 'WAITING_REVIEW', 'TAG_FAILED', 'SKIPPED_NON_TEXT'].includes(a)) return a;
  const m = String(logItem?.message || '');
  if (m.includes('Bỏ qua (không phải text)')) return 'SKIPPED_NON_TEXT';
  if (m.includes('Khách mua hàng/escalate')) return 'ESCALATED';
  if (m.startsWith('Khách mới:')) return 'NEW_CUSTOMER';
  if (m.includes('Không có shortcut phù hợp')) return 'WAITING_REVIEW';
  if (m.includes('Không gắn được tag')) return 'TAG_FAILED';
  if (m.startsWith('Đã gửi ') || m.startsWith('Đã điền ')) return 'SHORTCUT';
  return null;
}

function extractStatShortcut(logItem) {
  const sc = logItem?.data?.analysis?.bestShortcut;
  if (sc && /^\/\d+$/.test(sc)) return sc;
  const m = String(logItem?.message || '').match(/\/\d+/);
  return m ? m[0] : null;
}

async function computeBotStats() {
  let logs = [];
  try { logs = await api('/api/logs?limit=800'); } catch (_) { renderBotStats(null); return; }
  const botLogs = (logs || []).filter((l) => l.type === 'BOT');
  const AUTO = new Set(['NEW_CUSTOMER', 'SHORTCUT']);
  const HUMAN = new Set(['ESCALATED', 'WAITING_REVIEW', 'TAG_FAILED']);
  let auto = 0, human = 0, skipped = 0;
  const scCount = new Map();
  for (const l of botLogs) {
    const act = resolveBotAction(l);
    if (!act) continue;
    if (AUTO.has(act)) auto++;
    else if (HUMAN.has(act)) human++;
    else if (act === 'SKIPPED_NON_TEXT') skipped++;
    if (act === 'SHORTCUT' || act === 'NEW_CUSTOMER') {
      const sc = extractStatShortcut(l);
      if (sc) scCount.set(sc, (scCount.get(sc) || 0) + 1);
    }
  }
  const decided = auto + human;
  const autoRate = decided ? Math.round((auto / decided) * 100) : 0;
  const topShortcuts = [...scCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([shortcut, count]) => ({ shortcut, count }));
  renderBotStats({ total: auto + human + skipped, auto, human, skipped, autoRate, topShortcuts });
}

function renderBotStats(stats) {
  const box = $('botStats');
  if (!box) return;
  if (!stats || stats.total === 0) {
    box.innerHTML = '<p style="color:var(--muted)">Chưa có dữ liệu thống kê (bot chưa xử lý ca nào gần đây).</p>';
    return;
  }
  const top = stats.topShortcuts.length
    ? stats.topShortcuts.map((s) => `<li><span class="shortcut-pill">${escapeHtml(s.shortcut)}</span> × ${s.count}</li>`).join('')
    : '<li style="color:var(--muted)">Chưa có</li>';
  box.innerHTML = `
    <div class="grid two">
      <div class="stat"><span>Tổng ca</span><b>${stats.total}</b></div>
      <div class="stat"><span>Tỉ lệ tự xử</span><b>${stats.autoRate}%</b></div>
      <div class="stat"><span>Bot tự xử</span><b>${stats.auto}</b></div>
      <div class="stat"><span>Đẩy người</span><b>${stats.human}</b></div>
      <div class="stat"><span>Bỏ qua</span><b>${stats.skipped}</b></div>
    </div>
    <div style="margin-top:10px"><b style="font-size:12px;color:var(--muted)">TOP SHORTCUT</b><ul class="bot-stats-top">${top}</ul></div>
  `;
}

function renderAnalysis(analysis) {
  lastAnalysis = analysis;
  const suggestions = (analysis.topSuggestions || []).map((s) => `
    <div class="suggestion">
      <strong>${escapeHtml(s.shortcut)}</strong> — ${escapeHtml(s.topic || '')}<br>
      <small>Confidence: ${Math.round(Number(s.confidence || 0) * 100)}% · ${escapeHtml(s.reason || '')}</small>
      <div class="actions"><button class="btn small ghost suggestion-fill" data-shortcut="${escapeHtml(s.shortcut)}">Điền ${escapeHtml(s.shortcut)}</button></div>
    </div>
  `).join('');
  $('aiResult').innerHTML = `
    <div class="suggestion">
      <h3>Best: <span class="shortcut-pill">${escapeHtml(analysis.bestShortcut || 'null')}</span></h3>
      <p><b>Intent:</b> ${escapeHtml(analysis.intent || '')}</p>
      <p><b>Action:</b> ${escapeHtml(analysis.action || '')}</p>
      <p><b>Confidence:</b> ${Math.round(Number(analysis.confidence || 0) * 100)}%</p>
      <p><b>Reason:</b> ${escapeHtml(analysis.reason || '')}</p>
      <p><b>Should escalate:</b> ${analysis.shouldEscalate ? 'YES' : 'NO'}</p>
      ${typeof analysis.usedExamples === 'number' && analysis.usedExamples > 0 ? `<p class="icon-copy"><small>${iconSvg('book')} Đã tham khảo ${analysis.usedExamples} ví dụ đã học</small></p>` : ''}
      ${analysis.bestShortcut ? `<div class="actions"><button class="btn small danger" id="unlearnBtn" title="Báo AI rằng gợi ý này sai">Gợi ý sai</button></div>` : ''}
    </div>
    ${suggestions || '<p>Không có gợi ý</p>'}
  `;
  document.querySelectorAll('.suggestion-fill').forEach((btn) => btn.addEventListener('click', async () => fillShortcut(btn.dataset.shortcut)));
  const unlearnBtn = $('unlearnBtn');
  if (unlearnBtn) unlearnBtn.addEventListener('click', () => unlearnExample(lastCustomerMessage, analysis.bestShortcut));
}

async function analyzeText(text) {
  lastCustomerMessage = String(text || '');
  const analysis = await api('/api/ai/analyze-message', {
    method: 'POST',
    body: JSON.stringify({ customerMessage: text, customerName: '', currentTags: [], context: {} })
  });
  renderAnalysis(analysis);
  return analysis;
}

// Learning: record a (message -> shortcut) example. Best-effort, never throws.
async function recordExample(message, shortcut, intent = '') {
  if (settings.learnExamplesEnabled === false) return;
  const msg = String(message || '').trim();
  if (!msg || !isShortcut(shortcut)) return;
  try {
    const res = await api('/api/examples', {
      method: 'POST',
      body: JSON.stringify({ message: msg, shortcut: shortcut.trim(), intent })
    });
    learnedCount = res.count || learnedCount;
    updateLearnedCount();
    loadLearnedCount();
  } catch (_) { /* ignore - learning must not break flow */ }
}

// Unlearn: remove a wrong example (👎).
async function unlearnExample(message, shortcut) {
  try {
    await api('/api/examples/delete-pair', {
      method: 'POST',
      body: JSON.stringify({ message: String(message || ''), shortcut: String(shortcut || '') })
    });
    toast('Đã xóa ví dụ sai, AI sẽ không học theo nữa');
    await loadLearnedCount();
  } catch (e) { toast(e.message); }
}

function updateLearnedCount() {
  const el = $('learnedCount');
  if (el) el.textContent = learnedCount;
}

function renderExamples() {
  const box = $('examplesTable');
  if (!box) return;
  const q = ($('exampleSearch')?.value || '').toLowerCase();
  const filtered = examplesCache.filter((e) => `${e.message} ${e.shortcut} ${e.intent || ''}`.toLowerCase().includes(q));
  if (!filtered.length) {
    box.innerHTML = '<p style="padding:10px;color:var(--muted)">Chưa có ví dụ nào. AI sẽ học khi bạn gửi/điền shortcut.</p>';
    return;
  }
  box.innerHTML = `<table><thead><tr><th>Tin khách</th><th>Shortcut</th><th></th></tr></thead><tbody>${
    filtered.map((e) => `<tr>
      <td>${escapeHtml((e.message || '').slice(0, 120))}</td>
      <td><span class="shortcut-pill">${escapeHtml(e.shortcut)}</span></td>
      <td><button class="btn small danger example-del" data-id="${escapeHtml(e.id)}" title="Xóa ví dụ này">✕</button></td>
    </tr>`).join('')
  }</tbody></table>`;
  box.querySelectorAll('.example-del').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      await api(`/api/examples/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
      await loadLearnedCount();
      toast('Đã xóa ví dụ');
    } catch (e) { toast(e.message); }
  }));
}

async function loadLearnedCount() {
  try {
    const data = await api('/api/examples');
    examplesCache = data.items || [];
    learnedCount = examplesCache.length;
    updateLearnedCount();
    renderExamples();
  } catch (_) {}
}

// --- Extensions (Chrome-like store) ---
async function loadExtensions() {
  $('extList').textContent = 'Cài extension Pancake Bot Bridge trong trình duyệt. Quản lý extension chỉ có ở bản desktop.';
}

async function fillShortcut(shortcut) {
  if (!isShortcut(shortcut)) {
    toast('Chặn: không phải shortcut /n');
    return;
  }
  const result = await fillShortcutIntoActiveTab(shortcut);
  const source = shouldRecordManualExample() ? resolveLearnSource() : '';
  if (result.ok && source) {
    // Điền từ vùng gợi ý chỉ học khi Trợ lý real-time và tự học ví dụ mới đều bật.
    try { await recordExample(source, shortcut.trim(), lastAnalysis?.intent || ''); }
    catch (_) { toast('Đã điền nhưng lưu ví dụ thất bại'); }
  }
  toast(result.ok ? `Đã điền ${shortcut}${source ? ' + đã học' : ''}` : result.message || 'Không điền được');
}

async function updateDomSummary(tabId = activeWvTab) {
  const tab = getTab(tabId);
  if (!tab.botCapable) {
    $('domSummary').textContent = `${tab.label}: tab thủ công, không chạy bot`;
    $('unreadCount').textContent = '0';
    setSafetyState('Manual', 'warn', 'Tab thủ công');
    return null;
  }
  try {
    const status = await botCallForTab(tab.id, 'getDomStatus');
    $('domSummary').textContent = safeJson(status);
    $('unreadCount').textContent = status.unreadCount || 0;
    const health = status.health || {};
    if (health.level === 'OK') setSafetyState('OK', 'ok');
    else setSafetyState(health.level === 'FAIL' ? 'Fail-safe' : 'Warn', 'warn', (health.missing || []).join(', ') || 'DOM chưa đủ điều kiện');
    return status;
  } catch (error) {
    $('domSummary').textContent = error.message;
    setSafetyState('Fail-safe', 'warn', error.message);
    return null;
  }
}

async function getDomHealthSafe(runtime = getActiveBotRuntime()) {
  try { return await botCallForTab(runtime.tabId, 'getDomHealth'); }
  catch (error) { return { level: 'FAIL', canTypeReply: false, canSend: false, canTag: false, canMarkUnread: false, missing: [error.message] }; }
}

function missingReason(health, fallback) {
  return (health?.missing || []).join(', ') || fallback;
}

function isBlankShortcut(s) { return s == null || String(s).trim() === ''; }

async function getPancakeUrl(tabId = activeWvTab) {
  return adapter.listSlots().find((slot) => slot.slot === tabId)?.url || '';
}

async function postQueueWithRetry(body) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await api('/api/review-queue', {
        method: 'POST',
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
      });
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  await log('ERROR', 'QUEUE', `Không enqueue được: ${body.conversationId} - ${lastErr?.message || 'lỗi không xác định'}`);
}

async function enqueueReviewCase({ info, customerName, message, analysis, runtime = getActiveBotRuntime() }) {
  const conversationId = info?.id || '';
  const pancakeUrl = await getPancakeUrl(runtime?.tabId || activeWvTab);
  const hasValidUrl = /^https?:\/\//.test(pancakeUrl);
  if (!conversationId && !hasValidUrl) {
    await log('ERROR', 'QUEUE', 'Không lấy được tham chiếu cuộc trò chuyện, bỏ qua enqueue', { customerName });
    return;
  }
  const suggestedShortcut = analysis?.shortcut || analysis?.recommendedShortcut || analysis?.bestShortcut || null;
  const body = {
    conversationId,
    customerName: customerName || info?.name || '',
    customerMessage: message || '',
    intent: analysis?.intent || '',
    reason: analysis?.reason || 'Bot không tự tin / không hiểu',
    pancakeUrl: hasValidUrl ? pancakeUrl : '',
    addressLookup: analysis?.addressLookup || null,
    suggestedShortcut
  };
  await postQueueWithRetry(body);
}

let lastSystemAlertTime = 0;
async function maybeReportSystemAlert(type, message, details = {}) {
  const now = Date.now();
  if (now - lastSystemAlertTime < 60000) return; // throttle 1 phút tránh spam
  lastSystemAlertTime = now;
  try {
    await api('/api/notify/system-alert', {
      method: 'POST',
      body: JSON.stringify({ type, message, details }),
      signal: AbortSignal.timeout(5000)
    });
  } catch (_) {}
}

async function processOneConversation(runtime = getActiveBotRuntime()) {
  if (!runtime) return { ok: false, message: 'Tab này không hỗ trợ bot' };
  const call = (method, ...args) => botCallForTab(runtime.tabId, method, ...args);
  const unread = await call('getUnreadConversations');
  if (runtime.tabId === activeWvTab) $('unreadCount').textContent = unread.length;
  if (!unread.length) return { ok: true, idle: true, message: 'Không có khách chưa đọc' };

  let first = null;
  let key = '';
  const claims = window.PDBConversationClaims;
  for (const candidate of unread) {
    const candidateKey = makeDedupeKey(candidate);
    const last = runtime.processed ? runtime.processed.get(candidateKey) : null;
    const wasProcessed = typeof wasConversationProcessedAnywhere === 'function' ? wasConversationProcessedAnywhere(candidateKey) : false;
    if ((last && Date.now() - last < PROCESSED_TTL_MS) || wasProcessed) {
      await log('WARN', 'BOT', prefixRuntime(runtime, `Bỏ qua vì mới xử lý: ${candidate.name}`));
      continue;
    }
    if (claims && !claims.claimConversation(candidateKey, runtime)) {
      await log('WARN', 'BOT', prefixRuntime(runtime, `Bỏ qua vì bot khác đang xử lý: ${candidate.name}`));
      continue;
    }
    first = candidate;
    key = candidateKey;
    break;
  }
  if (!first) return { ok: true, skipped: true, message: 'Không có khách chưa đọc khả dụng' };
  if (typeof rememberProcessedForAllBotRuntimes === 'function') rememberProcessedForAllBotRuntimes(key);

  try {
  const clickResult = await call('clickConversationById', first.id, first.identityKey || first.id);
  const info = clickResult?.info || clickResult || {};
  await sleep(900);
  const effectiveInfo = await window.PDBBotDecision.readEffectiveConversationInfo({
    info,
    readCurrentTags: () => call('getCurrentTags'),
    onWarning: async (error) => {
      await log('WARN', 'BOT', prefixRuntime(runtime, 'Không đọc được tag hiện tại; dùng tag từ danh sách'), {
        error: serializeError(error)
      });
    }
  });
  const customerName = await call('getCurrentCustomerName');
  const message = info.snippet || first.snippet || '';
  runtime.lastCustomerMessage = message;
  setActiveRuntimeMessages(runtime);

  const lastSender = await call('getLastMessageSender');
  const preDecision = window.PDBBotDecision.decideBeforeAnalysis({ info: effectiveInfo, lastSender, settings });

  if (preDecision.action === 'NEW_CUSTOMER' || preDecision.action === 'NEW_CUSTOMER_TAGGED_ONLY_HUMAN_REPLY') {
    const health = await getDomHealthSafe(runtime);
    if (!health.canTag) {
      setRuntimeLastDecision(runtime, 'FAIL_SAFE_TAG', missingReason(health, 'Không tìm thấy tag controls'));
      await log('WARN', 'BOT', prefixRuntime(runtime, `Fail-safe: không gắn tag khách mới cho ${customerName || info.name}`), { message, health, preDecision });
      await enqueueReviewCase({ info, customerName, message, analysis: { action: 'WAITING_REVIEW', reason: 'DOM không đủ điều kiện gắn tag khách mới', health }, runtime });
      return { ok: true, action: 'WAITING_REVIEW', failSafe: true };
    }
    const tagResult = await call('applyTagByName', preDecision.tagName);   // best-effort
    await sleep(350);
    if (!tagResult || !tagResult.ok) {
      await log('WARN', 'BOT', prefixRuntime(runtime, `Không gắn được tag "${preDecision.tagName}" cho ${customerName || info.name}`), { message, tagResult });
    }
    const tagged = Boolean(tagResult?.ok);
    if (!preDecision.shouldSendShortcut) {
      setRuntimeLastDecision(runtime, preDecision.action);
      await log(tagged ? 'SUCCESS' : 'WARN', 'BOT', prefixRuntime(runtime, `Khách mới đã có admin trả lời — ${tagged ? `đã gắn ${preDecision.tagName}` : `chưa gắn được ${preDecision.tagName}`}, không gửi ${preDecision.shortcut}`), { message, tagResult, preDecision });
      return { ok: true, action: preDecision.action, shortcut: preDecision.shortcut, tagged };
    }
    if (!health.canTypeReply) {
      setRuntimeLastDecision(runtime, 'FAIL_SAFE_REPLY', missingReason(health, 'Không tìm thấy ô reply'));
      await log('WARN', 'BOT', prefixRuntime(runtime, `Fail-safe: không gửi shortcut khách mới cho ${customerName || info.name}`), { message, health, preDecision });
      return { ok: true, action: 'WAITING_REVIEW', failSafe: true };
    }
    await call('setReplyText', preDecision.shortcut);
    const sendResult = await call('clickSendButton');
    if (!sendResult?.ok) {
      setRuntimeLastDecision(runtime, 'FAIL_SAFE_SEND', sendResult?.message || 'Không gửi được shortcut');
      await log('WARN', 'BOT', prefixRuntime(runtime, `Fail-safe: ${sendResult?.message || 'không gửi được shortcut'} cho ${customerName || info.name}`), { message, sendResult, preDecision });
      return { ok: true, action: 'WAITING_REVIEW', failSafe: true };
    }
    setRuntimeLastDecision(runtime, preDecision.action);
    await log('SUCCESS', 'BOT', prefixRuntime(runtime, `Khách mới (fast): ${customerName || info.name} → ${tagged ? preDecision.tagName + ' + ' : ''}${preDecision.shortcut}`), { message, preDecision });
    return { ok: true, action: 'NEW_CUSTOMER', shortcut: preDecision.shortcut, tagged };
  }

  if (preDecision.action === 'SKIPPED_HUMAN_REPLY') {
    setRuntimeLastDecision(runtime, preDecision.action);
    await log('INFO', 'BOT', prefixRuntime(runtime, `Đã có người trả lời, bỏ qua: ${customerName || info.name}`), { message, preDecision });
    return { ok: true, action: 'SKIPPED_HUMAN_REPLY' };
  }

  // Read up to 5 recent messages for context (best-effort; [] if unreadable).
  let conversationHistory = [];
  try { conversationHistory = await call('getRecentMessages', 5); } catch (_) {}

  // Read order status (has the customer already purchased?) — best-effort.
  let orderStatus = null;
  try { orderStatus = await call('getCustomerOrderStatus'); } catch (_) {}

  const analysis = await api('/api/ai/analyze-message', {
    method: 'POST',
    body: JSON.stringify({ customerMessage: message, customerName, currentTags: effectiveInfo.tags || [], conversationHistory, orderStatus, context: { source: 'web-dashboard', tabId: runtime.tabId } })
  });
  runtime.lastAnalysis = analysis;
  if (runtime.tabId === activeWvTab) renderAnalysis(analysis);

  const postDecision = window.PDBBotDecision.decideAfterAnalysis({ analysis, settings });

  if (postDecision.action === 'SKIPPED_NON_TEXT') {
    setRuntimeLastDecision(runtime, postDecision.action);
    await log('INFO', 'BOT', prefixRuntime(runtime, `Bỏ qua (không phải text): ${customerName || info.name}`), { message, postDecision });
    return { ok: true, action: 'SKIPPED_NON_TEXT', message };
  }

  if (postDecision.action === 'ESCALATED') {
    const health = await getDomHealthSafe(runtime);
    if (!health.canTag) await log('WARN', 'BOT', prefixRuntime(runtime, `Fail-safe: DOM thiếu tag controls khi xử lý mua hàng cho ${customerName || info.name}`), { message, health, postDecision });
    else await call('applyTagByName', postDecision.tagName);
    await sleep(400);
    if (!health.canMarkUnread) await log('WARN', 'BOT', prefixRuntime(runtime, `Fail-safe: DOM thiếu mark unread cho ${customerName || info.name}`), { message, health, postDecision });
    else await call('markCurrentConversationUnread');
    const ci = analysis.contactInfo || {};
    let addressLookup = null;
    if (ci.address) {
      try {
        const lookupResult = await api('/api/address/lookup', {
          method: 'POST',
          body: JSON.stringify({ customerName: customerName || info.name || '', phone: ci.phone, message })
        });
        addressLookup = lookupResult?.lookup || null;
        analysis.addressLookup = addressLookup;
      } catch (err) {
        await log('WARN', 'BOT', prefixRuntime(runtime, 'Tra địa chỉ Google Maps: lỗi'), { message, error: err?.message || String(err) });
      }
    }
    const contactNote = [ci.phone ? `SĐT ${ci.phone}` : '', ci.address ? `ĐC: ${ci.address}` : ''].filter(Boolean).join(' | ');
    setRuntimeLastDecision(runtime, postDecision.action);
    await log('SUCCESS', 'BOT', prefixRuntime(runtime, `Khách mua hàng/escalate: ${customerName || info.name}${contactNote ? ' — ' + contactNote : ''}`), { message, analysis, postDecision });
    try {
      if (window.PDBBuyTtsNotifier) {
        window.PDBBuyTtsNotifier.notifyBuyCustomer({
          customerName: customerName || info.name || '',
          phone: ci.phone || '',
          address: ci.address || '',
          message,
          tabId: runtime.tabId,
          conversationId: info.id || info.conversationId || ''
        }, settings);
      }
    } catch (_) {}
    if (postDecision.shouldNotifyBuy) {
      try {
        const notifyResult = await api('/api/notify/buy', {
          method: 'POST',
          body: JSON.stringify({ customerName: customerName || info.name || '', phone: ci.phone, address: ci.address, message, addressLookup })
        });
        await log(notifyResult?.telegramSent ? 'SUCCESS' : 'WARN', 'BOT', prefixRuntime(runtime, `Telegram thông báo khách mua hàng: ${notifyResult?.telegramSent ? 'đã gửi' : 'gửi thất bại'}`), { message, analysis, notifyResult });
      } catch (err) {
        await log('WARN', 'BOT', prefixRuntime(runtime, 'Telegram thông báo khách mua hàng: gửi lỗi'), { message, analysis, error: err?.message || String(err) });
      }
    }
    await enqueueReviewCase({ info, customerName, message, analysis, runtime });
    return { ok: true, action: 'ESCALATED', analysis };
  }

  if (postDecision.action === 'WAITING_REVIEW') {
    setRuntimeLastDecision(runtime, postDecision.action);
    await log('WARN', 'BOT', prefixRuntime(runtime, `Không có shortcut phù hợp: ${customerName || info.name}`), { message, analysis, postDecision });
    await enqueueReviewCase({ info, customerName, message, analysis, runtime });
    return { ok: true, action: 'WAITING_REVIEW', analysis };
  }

  const health = await getDomHealthSafe(runtime);
  if (!health.canTypeReply) {
    setRuntimeLastDecision(runtime, 'FAIL_SAFE_REPLY', missingReason(health, 'Không tìm thấy ô reply'));
    await log('WARN', 'BOT', prefixRuntime(runtime, `Fail-safe: không điền shortcut cho ${customerName || info.name}`), { message, analysis, health, postDecision });
    await enqueueReviewCase({ info, customerName, message, analysis: { ...analysis, reason: 'DOM không đủ điều kiện điền shortcut', health }, runtime });
    return { ok: true, action: 'WAITING_REVIEW', failSafe: true, analysis };
  }

  await call('setReplyText', postDecision.shortcut);
  if (postDecision.shouldAttemptAutoSend) {
    const sendDecision = window.PDBBotDecision.decideBeforeSend({ lastSender: await call('getLastMessageSender') });
    if (sendDecision.action === 'SKIPPED_HUMAN_REPLY') {
      setRuntimeLastDecision(runtime, sendDecision.action);
      await log('INFO', 'BOT', prefixRuntime(runtime, `Đã có người trả lời trước khi gửi, hủy: ${customerName || info.name}`), { message, analysis, sendDecision });
      return { ok: true, action: 'SKIPPED_HUMAN_REPLY', analysis };
    }
    const sendResult = await call('clickSendButton');
    if (!sendResult?.ok) {
      setRuntimeLastDecision(runtime, 'FAIL_SAFE_SEND', sendResult?.message || 'Không gửi được shortcut');
      await log('WARN', 'BOT', prefixRuntime(runtime, `Fail-safe: ${sendResult?.message || 'không gửi được shortcut'} cho ${customerName || info.name}`), { message, analysis, sendResult, postDecision });
      return { ok: true, action: 'WAITING_REVIEW', failSafe: true, analysis };
    }
    await recordExample(message, postDecision.shortcut, analysis.intent || '');
    setRuntimeLastDecision(runtime, postDecision.action);
    await log('SUCCESS', 'BOT', prefixRuntime(runtime, `Đã gửi ${postDecision.shortcut} cho ${customerName || info.name}`), { message, analysis, postDecision });
  } else {
    setRuntimeLastDecision(runtime, postDecision.action);
    await log('INFO', 'BOT', prefixRuntime(runtime, `Đã điền ${postDecision.shortcut}, chờ duyệt`), { message, analysis, postDecision });
  }
  return { ok: true, action: 'SHORTCUT', analysis };
  } finally {
    if (claims && key) claims.releaseConversationClaim(key, runtime);
  }
}

// Xử lý MỘT khách theo chế độ Auto Click (tốc độ cao, KHÔNG gọi AI).
// Đặt cạnh processOneConversation để nhất quán; mọi log dùng type 'AUTOCLICK'
// để không lẫn vào computeBotStats (chỉ lọc type 'BOT').
async function processOneAutoClick(runtime = getActiveBotRuntime()) {
  if (!runtime) return { ok: false, message: 'Tab này không hỗ trợ Auto Click' };
  const call = (method, ...args) => botCallForTab(runtime.tabId, method, ...args);
  // --- Task 4.1: lấy danh sách + chọn khách + dedupe ---
  const unread = await call('getUnreadConversations');
  // Cập nhật badge best-effort: không để thiếu phần tử làm sập vòng lặp.
  try {
    const badge = $('unreadCount');
    if (badge && runtime.tabId === activeWvTab) badge.textContent = unread.length;
  } catch (_) {}

  // Danh sách rỗng → idle, không gắn thẻ/gửi (Req 3.2).
  if (!unread.length) return { ok: true, idle: true, action: 'IDLE' };

  const first = unread[0];                       // Req 3.3 — khách đầu hàng đợi
  const key = makeDedupeKey(first);              // Req 7.1
  const last = runtime.autoClickProcessed.get(key);
  if (last && Date.now() - last <= AUTOCLICK_PROCESSED_TTL_MS) {  // Req 7.2
    await log('INFO', 'AUTOCLICK', prefixRuntime(runtime, `Bỏ qua (mới xử lý): ${first.name}`));
    return { ok: true, skipped: true, action: 'SKIPPED_RECENT' };
  }
  rememberAutoClickProcessed(key, Date.now(), runtime);               // Req 7.3

  const info = await call('clickConversationById', first.id, first.identityKey || first.id);  // Req 3.3
  await sleep(700);

  // --- Task 4.2: bỏ qua khi đã có thẻ ---
  const customerName = await call('getCurrentCustomerName');   // best-effort
  if (shouldSkipByTags(info)) {                  // Req 4.1
    await log('INFO', 'AUTOCLICK', prefixRuntime(runtime, `Bỏ qua (đã có thẻ): ${customerName || info.name}`));
    return { ok: true, skipped: true, action: 'SKIPPED_HAS_TAG' };  // Req 4.2, 4.3
  }

  // --- Task 4.3: khách mới — gắn thẻ best-effort + gửi shortcut ---
  const newTag = settings.newCustomerTagName || 'Saruto Mới';
  const shortcut = settings.defaultNewCustomerShortcut || '/1';
  const health = await getDomHealthSafe(runtime);
  if (!health.canTypeReply) {
    setRuntimeLastDecision(runtime, 'AUTOCLICK_FAIL_SAFE_REPLY', missingReason(health, 'Không tìm thấy ô reply'));
    await log('WARN', 'AUTOCLICK', prefixRuntime(runtime, `Fail-safe: không gửi ${shortcut} cho ${customerName || info.name}`), { health, message: info.snippet });
    return { ok: true, action: 'WAITING_REVIEW', failSafe: true };
  }

  // Gắn thẻ ĐÚNG 1 LẦN (không retry); lỗi → coi như thất bại nhưng vẫn gửi (Req 5.1, 5.2, 5.3).
  let tagResult;
  try {
    tagResult = health.canTag ? await call('applyTagByName', newTag) : { ok: false, message: 'DOM thiếu tag controls' };
  } catch (_) {
    tagResult = { ok: false };
  }
  if (!tagResult || !tagResult.ok) {
    await log('WARN', 'AUTOCLICK', prefixRuntime(runtime, `Không gắn được tag "${newTag}" cho ${customerName || info.name} (vẫn gửi)`));
  }

  await sleep(350);
  await call('setReplyText', shortcut);        // Req 5.4

  // Gửi ĐÚNG 1 LẦN; thất bại → log WARN, KHÔNG ném ra ngoài (Req 5.5, 5.6).
  try {
    const sendRes = await call('clickSendButton');
    if (!sendRes || !sendRes.ok) {
      await log('WARN', 'AUTOCLICK', prefixRuntime(runtime, `Gửi ${shortcut} thất bại cho ${customerName || info.name}`));
    }
  } catch (_) {
    await log('WARN', 'AUTOCLICK', prefixRuntime(runtime, `Gửi ${shortcut} thất bại cho ${customerName || info.name}`));
  }

  // Tổng kết khách mới (Req 5.7).
  setRuntimeLastDecision(runtime, 'AUTOCLICK_NEW_CUSTOMER');
  await log('SUCCESS', 'AUTOCLICK', prefixRuntime(runtime, `Khách mới: ${customerName || info.name} → ${tagResult?.ok ? newTag + ' + ' : ''}${shortcut}`), { message: info.snippet });
  return { ok: true, action: 'NEW_CUSTOMER', shortcut, tagged: Boolean(tagResult?.ok) };
}

async function botLoop(runtime) {
  runtime.botRunning = true;
  syncLegacyRuntimeAliases(runtime);
  toast(`${getRuntimeLabel(runtime)} đã bắt đầu`);
  while (runtime.botRunning) {
    try {
      settings = await api('/api/settings');
      await keepLeaseFresh();
      if (!settings.botEnabled) {
        await sleep(settings.scanIntervalMs || 2500);
        continue;
      }
      await processOneConversation(runtime);
      if (runtime.tabId === activeWvTab) await updateDomSummary(runtime.tabId);
      await sleep(settings.processDelayMs || 3000);
    } catch (error) {
      await log('ERROR', 'BOT', prefixRuntime(runtime, error.message));
      toast(`${getRuntimeLabel(runtime)} lỗi: ${error.message}`, 5000);
      await maybeReportSystemAlert('BOT_LOOP_ERROR', error.message, { tabId: runtime.tabId });
      await sleep(3000);
    }
  }
  if (runtime.tabId === activeWvTab) refreshActiveTabRuntimeUi();
  toast(`${getRuntimeLabel(runtime)} đã dừng`);
}

// --- Panel: cửa sổ nổi kéo-thả ---
let panelPos = null; // { left, top } px — vị trí gần nhất

function openPanel() {
  const p = document.querySelector('.control-panel');
  p.classList.add('open');
  if (panelPos) {
    // Kẹp lại trong viewport phòng khi cửa sổ app đã thu nhỏ từ lần kéo trước.
    const w = p.offsetWidth || 0;
    const left = Math.max(0, Math.min(panelPos.left, window.innerWidth - Math.min(w, 80)));
    const top = Math.max(0, Math.min(panelPos.top, window.innerHeight - 40));
    p.style.left = left + 'px';
    p.style.top = top + 'px';
    p.style.right = 'auto';
  }
  if ($('miniRail')) $('miniRail').classList.add('hidden');
}

function closePanel() {
  document.querySelector('.control-panel').classList.remove('open');
  if ($('miniRail')) $('miniRail').classList.remove('hidden');
}

// Kéo cửa sổ nổi bằng thanh tiêu đề; kẹp trong viewport; lưu vị trí.
function enablePanelDrag() {
  const bar = $('panelTitlebar');
  const panel = document.querySelector('.control-panel');
  if (!bar || !panel) return;
  let dragging = false, offsetX = 0, offsetY = 0;

  bar.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;   // không kéo khi bấm nút (Req 2.4)
    const r = panel.getBoundingClientRect();
    offsetX = e.clientX - r.left;
    offsetY = e.clientY - r.top;
    dragging = true;
    panel.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = panel.offsetWidth, h = bar.offsetHeight;
    let left = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - Math.min(w, 80)));  // Req 2.3
    let top = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - h));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.right = 'auto';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('dragging');
    const r = panel.getBoundingClientRect();
    panelPos = { left: r.left, top: r.top };   // Req 2.2, 3.4
  });
}

// --- Mini rail: bật/tắt bot + mở nhanh tab ---
function setBotUiState(running = Boolean(getActiveBotRuntime()?.botRunning)) {
  const activeTab = getTab(activeWvTab);
  const btn = $('miniBotBtn');
  if (btn) {
    btn.classList.toggle('on', running);
    btn.disabled = !activeTab.botCapable;
    btn.textContent = '';
    const dot = document.createElement('span');
    dot.className = 'mini-dot';
    btn.appendChild(dot);
    const icon = document.createElement('span');
    icon.innerHTML = window.PDBIcons ? window.PDBIcons.svg(running ? 'pause' : 'play') : (running ? '⏸' : '▶');
    btn.appendChild(icon);
  }
  if ($('botEnabled')) {
    $('botEnabled').checked = running;
    $('botEnabled').disabled = !activeTab.botCapable;
  }
}

function refreshBrowserTabBadges() {
  document.querySelectorAll('.browser-tab').forEach((btn) => {
    const runtime = getTab(btn.dataset.wvtab).runtime;
    btn.classList.toggle('running', Boolean(runtime?.botRunning || runtime?.autoClickRunning));
  });
}

function refreshActiveTabRuntimeUi() {
  const tab = getTab(activeWvTab);
  const runtime = tab.runtime;
  syncLegacyRuntimeAliases(runtime || webviewTabs.bot1.runtime);
  const botOn = Boolean(runtime?.botRunning);
  const autoOn = Boolean(runtime?.autoClickRunning);
  setBotUiState(botOn);
  setAutoClickUiState(autoOn);
  if ($('activeTabBotStatus')) {
    $('activeTabBotStatus').textContent = tab.botCapable
      ? `${tab.label}: ${botOn ? 'Bot running' : autoOn ? 'AutoClick running' : 'Stopped'}`
      : `${tab.label}: thủ công`;
  }
  if ($('startBotBtn')) $('startBotBtn').disabled = !tab.botCapable || autoOn;
  if ($('stopBotBtn')) $('stopBotBtn').disabled = !tab.botCapable;
  if ($('startAutoClickBtn')) $('startAutoClickBtn').disabled = !tab.botCapable || botOn;
  if ($('stopAutoClickBtn')) $('stopAutoClickBtn').disabled = !tab.botCapable;
  setRuntimeState(tab.botCapable
    ? `${tab.label}: ${botOn ? 'Bot running' : autoOn ? 'AutoClick running' : 'Stopped'}`
    : `${tab.label}: Manual`);
  refreshBrowserTabBadges();
}

async function startBot(runtime = getActiveBotRuntime()) {
  if (!runtime) { toast('Tab này không hỗ trợ bot', 4000); refreshActiveTabRuntimeUi(); return; }
  if (runtime.autoClickRunning) {                             // Req 2.3, 2.4, 9.1
    toast('Auto Click đang chạy trong tab này — hãy dừng Auto Click trước.', 5000);
    refreshActiveTabRuntimeUi();
    return;
  }
  primeTtsAudio().catch(() => {});
  if ($('botEnabled')) $('botEnabled').checked = true;
  await acquireBotLease();
  await saveSettingsFromUi();
  if (!runtime.botLoopPromise) {
    runtime.botLoopPromise = botLoop(runtime).finally(() => { runtime.botLoopPromise = null; syncLegacyRuntimeAliases(runtime); refreshActiveTabRuntimeUi(); });
  }
  runtime.botRunning = true;
  syncLegacyRuntimeAliases(runtime);
  refreshActiveTabRuntimeUi();
}

async function stopBot(runtime = getActiveBotRuntime()) {
  if (!runtime) { toast('Tab này không hỗ trợ bot', 4000); return; }
  runtime.botRunning = false;
  if (!anyRuntimeBotRunning() && !anyRuntimeAutoClickRunning()) await releaseBotLease();
  if ($('botEnabled')) $('botEnabled').checked = anyRuntimeBotRunning();
  await saveSettingsFromUi();
  await log('WARN', 'BOT', prefixRuntime(runtime, 'Emergency Stop'));
  syncLegacyRuntimeAliases(runtime);
  refreshActiveTabRuntimeUi();
}

async function toggleBotFromRail() {
  const runtime = getActiveBotRuntime();
  if (!runtime) { toast('Tab này không hỗ trợ bot', 4000); return; }
  if (runtime.botRunning) await stopBot(runtime);
  else await startBot(runtime);
}

// --- Auto Click: vòng lặp + start/stop + guard loại trừ lẫn nhau ---
// Đặt ngay sau toggleBotFromRail để nhất quán với nhóm điều phối Bot AI.
// Mọi log dùng type 'AUTOCLICK' để không lẫn vào computeBotStats.

// Task 5.3: cập nhật nút mini + đèn + checkbox (đặt trước để gọn nhóm).
function setAutoClickUiState(running = Boolean(getActiveBotRuntime()?.autoClickRunning)) {
  const activeTab = getTab(activeWvTab);
  const btn = $('miniAutoClickBtn');
  if (btn) {
    btn.classList.toggle('on', running);
    btn.disabled = !activeTab.botCapable;
    btn.textContent = '';
    const dot = document.createElement('span');
    dot.className = 'mini-dot';
    btn.appendChild(dot);
    const icon = document.createElement('span');
    icon.innerHTML = window.PDBIcons ? window.PDBIcons.svg(running ? 'pause' : 'zap') : (running ? '⏸' : '⚡');
    btn.appendChild(icon);
  }
  if ($('autoClickEnabled')) {
    $('autoClickEnabled').checked = running;
    $('autoClickEnabled').disabled = !activeTab.botCapable;
  }
}

// Task 5.1: vòng lặp xử lý từng khách, try/catch mỗi vòng để không sập loop.
async function autoClickLoop(runtime) {
  runtime.autoClickRunning = true;
  syncLegacyRuntimeAliases(runtime);
  toast(`${getRuntimeLabel(runtime)} Auto Click đã bắt đầu`);
  while (runtime.autoClickRunning) {
    try {
      settings = await api('/api/settings');
      await keepLeaseFresh();
      await processOneAutoClick(runtime);
      await sleep(settings.autoClickDelayMs || 3000);   // Req 6.1, 6.3
    } catch (error) {
      await log('ERROR', 'AUTOCLICK', prefixRuntime(runtime, error.message));   // Req 8.2
      toast(`${getRuntimeLabel(runtime)} Auto Click lỗi: ${error.message}`, 5000);
      await sleep(3000);
    }
  }
  if (runtime.tabId === activeWvTab) refreshActiveTabRuntimeUi();
  toast(`${getRuntimeLabel(runtime)} Auto Click đã dừng`);
}

// Task 5.2: bật Auto Click với guard botRunning (loại trừ lẫn nhau).
async function startAutoClick(runtime = getActiveBotRuntime()) {
  if (!runtime) { toast('Tab này không hỗ trợ Auto Click', 4000); refreshActiveTabRuntimeUi(); return; }
  if (runtime.botRunning) {                                   // Req 2.1, 2.2
    toast('Bot AI đang chạy trong tab này — hãy dừng Bot trước.', 5000);
    refreshActiveTabRuntimeUi();
    return;
  }
  primeTtsAudio().catch(() => {});
  if ($('autoClickEnabled')) $('autoClickEnabled').checked = true;
  await acquireBotLease();
  await saveSettingsFromUi();
  if (!runtime.autoClickLoopPromise) {
    runtime.autoClickLoopPromise = autoClickLoop(runtime).finally(() => { runtime.autoClickLoopPromise = null; syncLegacyRuntimeAliases(runtime); refreshActiveTabRuntimeUi(); });
  }
  runtime.autoClickRunning = true;
  syncLegacyRuntimeAliases(runtime);
  refreshActiveTabRuntimeUi();
}

// Task 5.3: dừng Auto Click (dừng sau khi xong khách hiện tại).
async function stopAutoClick(runtime = getActiveBotRuntime()) {
  if (!runtime) { toast('Tab này không hỗ trợ Auto Click', 4000); return; }
  runtime.autoClickRunning = false;
  if (!anyRuntimeBotRunning() && !anyRuntimeAutoClickRunning()) await releaseBotLease();
  if ($('autoClickEnabled')) $('autoClickEnabled').checked = anyRuntimeAutoClickRunning();
  await saveSettingsFromUi();
  await log('WARN', 'AUTOCLICK', prefixRuntime(runtime, 'Đã dừng Auto Click'));
  syncLegacyRuntimeAliases(runtime);
  refreshActiveTabRuntimeUi();
}

async function toggleAutoClickFromRail() {
  const runtime = getActiveBotRuntime();
  if (!runtime) { toast('Tab này không hỗ trợ Auto Click', 4000); return; }
  if (runtime.autoClickRunning) await stopAutoClick(runtime);
  else await startAutoClick(runtime);
}

function openPanelTab(tabId) {
  openPanel();
  const tabBtn = document.querySelector(`.tab[data-tab="${tabId}"]`);
  if (tabBtn) tabBtn.click();   // tái dùng bindTabs: kích polling hàng đợi / render palette
}

function switchWebviewTab(tabName) {
  const tab = getTab(tabName);
  activeWvTab = tab.id;
  document.querySelectorAll('.browser-tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.wvtab === tab.id));
  document.querySelectorAll('.slot-card').forEach((card) => card.classList.toggle('active', card.dataset.slot === tab.id));
  $('urlInput').value = adapter.listSlots().find((slot) => slot.slot === tab.id)?.url || pancakeUrl;
  setActiveRuntimeMessages(tab.runtime);
  stopAssistantWatch();
  if (assistantEnabled && pageVisible && tab.botCapable) startAssistantWatch();
  refreshActiveTabRuntimeUi();
  updateDomSummary(tab.id);
}

// --- Review queue (admin review) UI ---
function showReviewQueueError(msg) {
  const el = $('reviewQueueError');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideReviewQueueError() {
  const el = $('reviewQueueError');
  if (el) el.classList.add('hidden');
}

async function loadReviewQueue() {
  try {
    const data = await api('/api/review-queue');
    reviewQueueCache = (data.items || [])
      .filter((x) => x.status === 'pending')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // newest first (Req 2.8)
    renderReviewQueue(reviewQueueCache);
    hideReviewQueueError();
  } catch (_) {
    showReviewQueueError('Không tải được hàng đợi'); // keep stale cache (Req 2.9)
  }
}

function renderReviewQueue(items) {
  const list = $('reviewQueueList');
  const empty = $('reviewQueueEmpty');
  const count = Array.isArray(items) ? items.length : 0;
  $('reviewQueueBadge').textContent = count;
  if ($('miniQueueBadge')) $('miniQueueBadge').textContent = count;
  $('reviewQueueCount').textContent = count;

  if (!count) {
    if (empty) empty.classList.remove('hidden');
    if (list) list.innerHTML = '';
    return;
  }
  if (empty) empty.classList.add('hidden');

  list.innerHTML = items.map((item) => {
    const name = escapeHtml(item.customerName || '(không tên)');
    const rawMsg = String(item.customerMessage || '');
    const msg = escapeHtml(rawMsg.length > 140 ? rawMsg.slice(0, 140) + '…' : rawMsg);
    const reason = escapeHtml(item.reason || '');
    let when = '';
    try { when = escapeHtml(new Date(item.createdAt).toLocaleString()); } catch (_) {}
    const id = escapeHtml(item.id || '');
    const conv = escapeHtml(item.conversationId || '');
    const url = escapeHtml(item.pancakeUrl || '');
    const lookup = item.addressLookup || null;
    const mapsUrl = lookup?.googleMapsUrl ? escapeHtml(lookup.googleMapsUrl) : '';
    const addressBlock = mapsUrl ? `
      <div class="rq-address">
        <div><b>Địa chỉ:</b> ${escapeHtml(lookup.rawAddress || lookup.query || '')}</div>
        <div><b>Độ chắc chắn:</b> ${escapeHtml(lookup.confidence || 'medium')}</div>
        ${lookup.note ? `<div>${escapeHtml(lookup.note)}</div>` : ''}
        <a class="btn small ghost" href="${mapsUrl}" target="_blank" rel="noreferrer">Mở Google Maps</a>
      </div>` : '';
    return `<li class="rq-item">
      <div class="rq-item-name">${name}</div>
      <div class="rq-item-msg">${msg}</div>
      <div class="rq-item-reason">${reason}</div>
      ${addressBlock}
      <div class="rq-item-time">${when}</div>
      <div class="actions">
        <button class="btn small rq-open" data-id="${id}" data-conv="${conv}" data-url="${url}">Mở</button>
        <button class="btn small rq-done" data-id="${id}">Hoàn tất</button>
        <button class="btn small danger rq-del" data-id="${id}">Xóa</button>
      </div>
    </li>`;
  }).join('');
}

function getReviewTargetTabId() {
  return getTab(activeWvTab).botCapable ? activeWvTab : 'bot1';
}

async function navigateToConversation(item, tabId = getReviewTargetTabId()) {
  const tab = getTab(tabId);
  if (/^https?:\/\//.test(item.pancakeUrl || '')) {   // Req 3.3
    if (!window.PDBPancakeUrlPolicy.isAllowedAutomationUrl(item.pancakeUrl)) return false;
    try {
      await adapter.navigateTab(tab.id, item.pancakeUrl);
    } catch (_) {
      openExternal(item.pancakeUrl);
    }
    return true;
  }
  if (item.conversationId) {                            // Req 3.4
    try { await botCallForTab(tab.id, 'clickConversationById', item.conversationId); return true; }
    catch (_) { return false; }
  }
  return false;                                         // Req 3.5
}

async function openReviewItem(item) {
  const tabId = getReviewTargetTabId();
  switchWebviewTab(tabId);                              // Req 3.1
  const ok = await navigateToConversation(item, tabId);
  if (!ok) toast('Không mở được cuộc trò chuyện', 4000); // Req 3.5/3.6, item stays pending
}

async function markReviewDone(id) {
  await api(`/api/review-queue/${id}/done`, { method: 'POST' });
  await loadReviewQueue();
}

async function deleteReviewItemUI(id) {
  await api(`/api/review-queue/${id}`, { method: 'DELETE' });
  await loadReviewQueue();
}

async function clearDoneReview() {
  await api('/api/review-queue/clear-done', { method: 'POST' });
  await loadReviewQueue();
}

function startReviewQueuePolling() {
  stopReviewQueuePolling();
  loadReviewQueue();                                    // refresh immediately (Req 2.1)
  reviewQueueTimer = setInterval(loadReviewQueue, 5000); // poll every 5s (Req 2.5)
}

function stopReviewQueuePolling() {
  if (reviewQueueTimer) clearInterval(reviewQueueTimer);
  reviewQueueTimer = null;
}

function bindTabs() {
  const tabsBar = document.querySelector('.tabs');

  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(btn.dataset.tab).classList.add('active');
      // Toggle review-queue polling based on which tab is active.
      if (btn.dataset.tab === 'reviewQueuePanel') startReviewQueuePolling();
      else stopReviewQueuePolling();
      // Cập nhật bảng shortcut khi mở tab Gợi ý.
      if (btn.dataset.tab === 'ai') renderShortcutPalette();
      // Tính lại thống kê bot khi mở tab Tổng quan.
      if (btn.dataset.tab === 'overview') computeBotStats();
      // Bring the clicked tab fully into view if the bar is overflowing.
      btn.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    });
  });

  enableDragScroll(tabsBar);
}

// Let an overflowing horizontal container be dragged with the mouse and
// scrolled with the vertical wheel. Used for the tab bar.
function enableDragScroll(el) {
  if (!el) return;
  let isDown = false;
  let startX = 0;
  let startScroll = 0;
  let moved = false;

  el.addEventListener('mousedown', (e) => {
    isDown = true; moved = false;
    startX = e.pageX;
    startScroll = el.scrollLeft;
    el.classList.add('dragging');
  });
  window.addEventListener('mouseup', () => { isDown = false; el.classList.remove('dragging'); });
  el.addEventListener('mouseleave', () => { isDown = false; el.classList.remove('dragging'); });
  el.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    const delta = e.pageX - startX;
    if (Math.abs(delta) > 3) moved = true;
    el.scrollLeft = startScroll - delta;
  });
  // Suppress the click that follows a drag so we don't switch tabs by accident.
  el.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); } }, true);
  // Vertical wheel scrolls the bar horizontally.
  el.addEventListener('wheel', (e) => {
    if (e.deltaY === 0) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, { passive: false });
}

let ttsAudioPrimed = false;

// Kích hoạt quyền phát âm thanh (Autoplay Policy):
// Trình duyệt chặn Audio.play() nếu tab chưa có user gesture.
// Dùng một silent WAV blob (không dùng data: URI để tuân thủ CSP media-src)
// để mở khóa AudioContext/HTML5 Audio trên gesture đầu tiên.
// Bắt lỗi rõ ràng nếu bị chặn thay vì im lặng thất bại.
async function primeTtsAudio() {
  if (ttsAudioPrimed) return true;
  if (typeof Audio === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false;
  }
  let audioUrl = '';
  try {
    const silentWavBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x26, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
      0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
      0x40, 0x1f, 0x00, 0x00, 0x40, 0x1f, 0x00, 0x00,
      0x01, 0x00, 0x08, 0x00, 0x64, 0x61, 0x74, 0x61,
      0x02, 0x00, 0x00, 0x00, 0x80, 0x80
    ]);
    const silentBlob = new Blob([silentWavBytes], { type: 'audio/wav' });
    audioUrl = URL.createObjectURL(silentBlob);
    const audio = new Audio(audioUrl);
    audio.volume = 0;
    await audio.play();
    ttsAudioPrimed = true;
    const statusEl = $('ttsAudioStatus');
    if (statusEl) statusEl.textContent = 'Âm thanh sẵn sàng';
    return true;
  } catch (error) {
    const msg = 'Cần bấm vào trang để bật âm thanh';
    const statusEl = $('ttsAudioStatus');
    if (statusEl) statusEl.textContent = msg;
    toast(msg, 5000);
    return false;
  } finally {
    if (audioUrl && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(audioUrl); } catch (_) {}
    }
  }
}

function registerAudioPriming() {
  const onGesture = () => {
    primeTtsAudio().catch(() => {});
  };
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('click', onGesture, { once: true });
    document.addEventListener('keydown', onGesture, { once: true });
  }
}
registerAudioPriming();

function bindUi() {
  // Autoplay policy: prime TTS audio on first user gesture
  registerAudioPriming();

  // Panel toggle + mini rail
  $('panelCloseBtn').addEventListener('click', closePanel);
  if ($('panelMinBtn')) $('panelMinBtn').addEventListener('click', closePanel);
  enablePanelDrag();
  if ($('miniPanelBtn')) $('miniPanelBtn').addEventListener('click', openPanel);
  if ($('miniBotBtn')) $('miniBotBtn').addEventListener('click', async () => {
    try { await toggleBotFromRail(); } catch (e) { toast(e.message, 5000); }
  });
  if ($('miniAutoClickBtn')) $('miniAutoClickBtn').addEventListener('click', async () => {
    try { await toggleAutoClickFromRail(); } catch (e) { toast(e.message, 5000); }
  });
  if ($('miniQueueBtn')) $('miniQueueBtn').addEventListener('click', () => openPanelTab('reviewQueuePanel'));
  if ($('miniSuggestBtn')) $('miniSuggestBtn').addEventListener('click', () => openPanelTab('ai'));
  if ($('themeBtn')) $('themeBtn').addEventListener('click', toggleTheme);

  // Bridge slot selection
  document.querySelectorAll('.browser-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchWebviewTab(btn.dataset.wvtab));
  });

  // Toolbar: Go / Reload target the active tab
  $('goBtn').addEventListener('click', () => {
    openPancakeTab($('urlInput').value.trim() || pancakeUrl);
  });
  $('reloadBtn').addEventListener('click', async () => {
    try {
      await adapter.reloadTab(activeWvTab);
    } catch (e) {
      toast('Lỗi reload tab: ' + (e?.message || e), 5000);
    }
    await checkBridge();
  });
  $('saveSettingsBtn').addEventListener('click', saveSettingsFromUi);
  if ($('testTtsBtn')) {
    $('testTtsBtn').addEventListener('click', async () => {
      try {
        primeTtsAudio().catch(() => {});
        toast('Đang gọi TTS test...');
        const overrides = {
          ttsProvider: $('ttsProvider') ? $('ttsProvider').value : 'api',
          ttsBaseUrl: $('ttsBaseUrl') ? $('ttsBaseUrl').value.trim() : '',
          ttsApiKey: $('ttsApiKey') ? $('ttsApiKey').value.trim() : '',
          ttsModel: $('ttsModel') ? $('ttsModel').value.trim() : 'google-tts/vi'
        };
        if (window.PDBBuyTtsNotifier) {
          window.PDBBuyTtsNotifier.speak('Khách mua hàng mới', overrides);
        }
        toast('Đã phát âm thanh test TTS');
      } catch (e) {
        toast('Lỗi test TTS: ' + e.message, 5000);
      }
    });
  }
  $('saveAiConfigBtn').addEventListener('click', async () => {
    try { await saveAiConfigFromUi(); } catch (e) { toast(e.message, 5000); }
  });
  $('testAiBtn').addEventListener('click', async () => {
    try { await testAiConfig(); } catch (e) { $('aiConfigStatus').textContent = e.message; toast(e.message, 5000); }
  });
  $('startBotBtn').addEventListener('click', async () => {
    try { await startBot(); } catch (e) { toast(e.message, 5000); }
  });
  $('stopBotBtn').addEventListener('click', async () => {
    try { await stopBot(); } catch (e) { toast(e.message, 5000); }
  });
  if ($('startAutoClickBtn')) $('startAutoClickBtn').addEventListener('click', async () => {
    try { await startAutoClick(); } catch (e) { toast(e.message, 5000); }
  });
  if ($('stopAutoClickBtn')) $('stopAutoClickBtn').addEventListener('click', async () => {
    try { await stopAutoClick(); } catch (e) { toast(e.message, 5000); }
  });
  if ($('autoClickEnabled')) $('autoClickEnabled').addEventListener('change', async (e) => {
    try { if (e.target.checked) await startAutoClick(); else await stopAutoClick(); }
    catch (err) { toast(err.message, 5000); }
  });
  $('shortcutSearch').addEventListener('input', renderShortcuts);
  if ($('paletteSearch')) $('paletteSearch').addEventListener('input', renderShortcutPalette);
  if ($('paletteList')) $('paletteList').addEventListener('click', (e) => {
    const btn = e.target.closest('.palette-btn');
    if (btn) teachAndFill(btn.dataset.shortcut);
  });
  if ($('assistantEnabled')) $('assistantEnabled').addEventListener('change', toggleAssistant);
  if ($('exampleSearch')) $('exampleSearch').addEventListener('input', renderExamples);
  if ($('clearExamplesBtn')) $('clearExamplesBtn').addEventListener('click', async () => {
    if (!confirm('Xóa toàn bộ ví dụ đã học? AI sẽ học lại từ đầu.')) return;
    try { await api('/api/examples/clear', { method: 'POST' }); await loadLearnedCount(); toast('Đã xóa hết ví dụ'); } catch (e) { toast(e.message); }
  });
  if ($('reloadExtBtn')) $('reloadExtBtn').addEventListener('click', async () => {
    $('reloadExtBtn').textContent = 'Đang reload...';
    try { await checkBridge(); }
    catch (e) { toast(e.message); }
    finally { $('reloadExtBtn').textContent = 'Reload bridge'; }
  });
  if ($('openExtFolderBtn')) $('openExtFolderBtn').addEventListener('click', async () => {
    try { await desktopOnly(); } catch (e) { toast(e.message); }
  });
  $('analyzeBtn').addEventListener('click', async () => {
    try { renderAnalysis(await analyzeText($('aiMessage').value)); } catch (e) { toast(e.message); }
  });
  $('fillBestBtn').addEventListener('click', async () => {
    if (lastAnalysis?.bestShortcut) await fillShortcut(lastAnalysis.bestShortcut);
    else toast('Chưa có best shortcut');
  });
  $('uploadExcelBtn').addEventListener('click', uploadExcel);
  $('commitExcelBtn').addEventListener('click', commitExcel);
  $('templateBtn').addEventListener('click', () => openExternal('/api/shortcuts/template'));
  $('clearLogsBtn').addEventListener('click', async () => { await api('/api/logs/clear', { method: 'POST' }); await loadLogs(); });
  if ($('botStatsRefresh')) $('botStatsRefresh').addEventListener('click', computeBotStats);

  // Review queue: refresh / clear-done + delegated row actions
  if ($('reviewQueueRefresh')) $('reviewQueueRefresh').addEventListener('click', loadReviewQueue);
  if ($('reviewQueueClearDone')) $('reviewQueueClearDone').addEventListener('click', async () => {
    try { await clearDoneReview(); toast('Đã xóa mục đã xong'); } catch (e) { toast(e.message); }
  });
  if ($('reviewQueueList')) $('reviewQueueList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    try {
      if (btn.classList.contains('rq-open')) {
        await openReviewItem({ pancakeUrl: btn.dataset.url, conversationId: btn.dataset.conv });
      } else if (btn.classList.contains('rq-done')) {
        await markReviewDone(id);
      } else if (btn.classList.contains('rq-del')) {
        await deleteReviewItemUI(id);
      }
    } catch (err) { toast(err.message); }
  });

  document.querySelectorAll('[data-domtest]').forEach((btn) => {
    btn.addEventListener('click', async () => runDomTest(btn.dataset.domtest));
  });


}

async function uploadExcel() {
  const file = $('excelFile').files[0];
  if (!file) return toast('Chọn file Excel trước');
  const fd = new FormData();
  fd.append('file', file);
  const res = await api('/api/shortcuts/import-excel', { method: 'POST', body: fd });
  $('importResult').innerHTML = `<b>Preview:</b> ${res.validRows.length} hợp lệ, ${res.errors.length} lỗi<br>${res.errors.map((e) => `<div style="color:#dc2626">Dòng ${e.line}: ${escapeHtml(e.error)}</div>`).join('')}`;
  toast('Đã preview Excel');
}

async function commitExcel() {
  const res = await api('/api/shortcuts/commit-import', { method: 'POST', body: JSON.stringify({ mode: 'overwrite' }) });
  shortcuts = res.items || [];
  renderShortcuts();
  toast('Đã import shortcuts');
}

async function runDomTest(name) {
  try {
    let result;
    if (name === 'status') result = await botCall('getDomStatus');
    if (name === 'unread') result = await botCall('getUnreadConversations');
    if (name === 'fill1') result = await botCall('setReplyText', '/1');
    if (name === 'sendBtn') result = await botCall('findSendButton');
    if (name === 'tagNew') result = await botCall('applyTagByName', settings.newCustomerTagName || 'Saruto Mới');
    if (name === 'tagBuy') result = await botCall('applyTagByName', settings.buyTagName || 'Mua hàng');
    if (name === 'markUnread') result = await botCall('markCurrentConversationUnread');
    if (name === 'recentMsgs') result = await botCall('getRecentMessages', 5);
    if (name === 'orderStatus') result = await botCall('getCustomerOrderStatus');
    $('domTestResult').textContent = safeJson(result);
    await updateDomSummary();
  } catch (error) {
    $('domTestResult').textContent = error.stack || error.message;
  }
}

function startPolling() {
  if (timers.length) return; // already running
  timers.push(setInterval(loadHealth, 5000));
  timers.push(setInterval(loadLogs, 4000));
  timers.push(setInterval(updateDomSummary, 7000));
  timers.push(setInterval(loadLease, 10000));
}

function stopPolling() {
  while (timers.length) clearInterval(timers.pop());
}

function applyVisibility(state) {
  const visible = state !== 'hidden';
  if (visible === pageVisible) return;
  pageVisible = visible;
  if (visible) {
    startPolling();
    if (assistantEnabled) startAssistantWatch();        // Req 5.9
  } else {
    // Pause background work and hint the engine to reclaim memory.
    stopPolling();
    stopAssistantWatch();                               // Req 5.9
    if (typeof window.gc === 'function') {
      try { window.gc(); } catch (_) {}
    }
  }
}

async function init() {
  initDuplicateTabGuard();
  initTheme();
  bindTabs();
  bindUi();
  // Biết kiểu đăng nhập TRƯỚC khi có route nào 401 bật loginPanel, để form
  // hiện đúng ô (pdb / Supabase) ngay lần đầu người dùng mở trang.
  await loadAuthMode();
  const env = window.PDB_ENV;
  pancakeUrl = env.pancakeUrl || pancakeUrl;
  $('urlInput').value = pancakeUrl;
  renderSlots(adapter.listSlots());
  adapter.onSlotsChanged(renderSlots);
  window.postMessage({ source: 'pdb-page', type: 'get-slots' }, window.location.origin);
  await loadLease();
  await loadHealth();
  await loadSettings();
  await loadAiConfig();
  await loadShortcuts();
  await loadLogs();
  await loadLearnedCount();
  await loadExtensions();
  computeBotStats();   // thống kê bot lần đầu (tab Tổng quan)
  startPolling();
  // Card quản lý người dùng chỉ hiện với owner; người thường bị ẩn im lặng.
  await loadUsersCard();

  // Pause polling when the page is hidden; the lease heartbeat stays active.
  document.addEventListener('visibilitychange', () => {
    applyVisibility(document.hidden ? 'hidden' : 'visible');
  });
}

bindWebSession();
init().catch((error) => toast(error.message, 6000));
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  clearInterval(leaseTimer);
  if (tabChannel && typeof tabChannel.close === 'function') {
    try { tabChannel.close(); } catch (_) {}
  }
  adapter.destroy(); stopPolling(); stopReviewQueuePolling(); stopAssistantWatch();
});
