const BUY_TTS_FULL_CONTACT_TEXT = 'Khách mua hàng, địa chỉ và số điện thoại đầy đủ';
const BUY_TTS_NEW_CUSTOMER_TEXT = 'Khách mua hàng mới';
const BUY_TTS_DEFAULT_DEBOUNCE_MS = 1500;
const BUY_TTS_DEDUPE_TTL_MS = 60000;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeKeyPart(value) {
  return normalizeText(value).toLowerCase();
}

function hasFullContact(event = {}) {
  return Boolean(normalizeText(event.phone) && normalizeText(event.address));
}

function buildSingleBuySpeech(event = {}) {
  return hasFullContact(event) ? BUY_TTS_FULL_CONTACT_TEXT : BUY_TTS_NEW_CUSTOMER_TEXT;
}

function buildGroupedBuySpeech(count) {
  return `Có ${Number(count) || 0} khách mua hàng`;
}

function makeBuyEventKey(event = {}) {
  const message = normalizeKeyPart(event.message).slice(0, 120);
  const key = [
    event.conversationId,
    event.customerName,
    event.phone,
    event.address,
    message
  ].map(normalizeKeyPart).join('|');
  return key.replace(/\|/g, '') ? key : '';
}

function pruneSeen(seen, now, ttlMs) {
  for (const [key, timestamp] of seen.entries()) {
    if (now - timestamp > ttlMs) seen.delete(key);
  }
}

function readPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function clampVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.max(0, Math.min(1, number));
}

function resolveVietnameseVoice(speechSynthesis) {
  try {
    const voices = typeof speechSynthesis?.getVoices === 'function' ? speechSynthesis.getVoices() : [];
    return voices.find((voice) => /^vi\b/i.test(voice.lang || ''))
      || voices.find((voice) => /vietnam/i.test(`${voice.lang || ''} ${voice.name || ''}`))
      || null;
  } catch (_) {
    return null;
  }
}

function createBuyTtsNotifier(options = {}) {
  const getSpeechSynthesis = options.getSpeechSynthesis || (() => (
    options.speechSynthesis || (typeof window !== 'undefined' ? window.speechSynthesis : null)
  ));
  const getUtteranceCtor = options.getSpeechSynthesisUtterance || (() => (
    options.SpeechSynthesisUtterance || (typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null)
  ));
  const setTimer = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimeout || ((id) => clearTimeout(id));
  const now = options.now || (() => Date.now());
  const defaultDebounceMs = readPositiveNumber(options.debounceMs, BUY_TTS_DEFAULT_DEBOUNCE_MS);
  const dedupeTtlMs = readPositiveNumber(options.dedupeTtlMs, BUY_TTS_DEDUPE_TTL_MS);
  const lang = options.lang || 'vi-VN';
  const rate = Number.isFinite(Number(options.rate)) ? Number(options.rate) : 1;
  const pitch = Number.isFinite(Number(options.pitch)) ? Number(options.pitch) : 1;
  const volume = clampVolume(options.volume);

  let timer = null;
  let queue = [];
  let lastSpokenText = '';
  let currentSettings = {};
  const seen = new Map();

  function shouldSpeakViaApi(settings = {}) {
    if (settings.ttsProvider === 'browser' || options.provider === 'browser') return false;
    if (settings.ttsProvider === 'api' || options.provider === 'api') return true;
    if (options.playAudio || options.fetchAudio) return true;
    if (typeof window !== 'undefined' && settings.ttsProvider !== 'browser') return true;
    return false;
  }

  function notifyBuyCustomer(event = {}, settings = {}) {
    try {
      if (settings.buyTtsEnabled === false) return false;
      currentSettings = settings;
      const timestamp = now();
      pruneSeen(seen, timestamp, dedupeTtlMs);

      const key = makeBuyEventKey(event);
      if (key && seen.has(key)) return false;
      if (key) seen.set(key, timestamp);

      queue.push({ ...event, timestamp: event.timestamp || timestamp });
      if (timer) clearTimer(timer);
      const debounceMs = readPositiveNumber(settings.buyTtsDebounceMs, defaultDebounceMs);
      timer = setTimer(() => flush(currentSettings), debounceMs);
      return true;
    } catch (_) {
      return false;
    }
  }

  function flush(settings = currentSettings) {
    try {
      const batch = queue.splice(0, queue.length);
      timer = null;
      if (!batch.length) return '';
      const text = batch.length > 1 ? buildGroupedBuySpeech(batch.length) : buildSingleBuySpeech(batch[0]);
      speak(text, settings);
      return text;
    } catch (_) {
      return '';
    }
  }

  async function speakApi(text, settings = {}) {
    const fetchFn = options.fetch || (typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : globalThis.fetch);
    if (!fetchFn) throw new Error('No fetch available');

    const res = await fetchFn('/api/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, overrides: settings })
    });
    if (!res.ok) throw new Error(`TTS API error: ${res.status}`);

    const blob = await res.blob();
    const playAudioFn = options.playAudio || (async (blobUrl) => {
      let audio;
      try {
        await new Promise((resolve, reject) => {
          if (typeof Audio === 'undefined') throw new Error('Audio not supported');
          audio = new Audio(blobUrl);
          audio.volume = volume;
          audio.onended = () => resolve(true);
          audio.onerror = reject;
          audio.play().catch(reject);
        });
      } finally {
        if (audio) {
          audio.onended = null;
          audio.onerror = null;
          try { audio.pause(); } catch (_) {}
          try { audio.removeAttribute('src'); } catch (_) {}
          try { audio.load(); } catch (_) {}
        }
        if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(blobUrl);
        }
      }
    });

    const createUrl = options.createObjectURL || (typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL.bind(URL) : null);
    const audioUrl = createUrl ? createUrl(blob) : 'mock-audio-url';
    await playAudioFn(audioUrl);
    lastSpokenText = text;
    return true;
  }

  function speakBrowser(text) {
    try {
      const speechSynthesis = getSpeechSynthesis();
      const Utterance = getUtteranceCtor();
      if (!speechSynthesis || typeof speechSynthesis.speak !== 'function' || typeof Utterance !== 'function') return false;

      const utterance = new Utterance(text);
      utterance.lang = lang;
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = volume;
      const voice = resolveVietnameseVoice(speechSynthesis);
      if (voice) utterance.voice = voice;

      speechSynthesis.speak(utterance);
      lastSpokenText = text;
      return true;
    } catch (_) {
      return false;
    }
  }

  function speak(text, settings = currentSettings) {
    if (shouldSpeakViaApi(settings)) {
      speakApi(text, settings).catch(() => {
        speakBrowser(text);
      });
      return true;
    }
    return speakBrowser(text);
  }

  function clear() {
    if (timer) clearTimer(timer);
    timer = null;
    queue = [];
    seen.clear();
    lastSpokenText = '';
  }

  return {
    notifyBuyCustomer,
    flush,
    speak,
    clear,
    getQueueSize: () => queue.length,
    getLastSpokenText: () => lastSpokenText
  };
}

const defaultNotifier = createBuyTtsNotifier();

const PDBBuyTtsNotifier = {
  BUY_TTS_FULL_CONTACT_TEXT,
  BUY_TTS_NEW_CUSTOMER_TEXT,
  BUY_TTS_DEFAULT_DEBOUNCE_MS,
  BUY_TTS_DEDUPE_TTL_MS,
  normalizeText,
  hasFullContact,
  buildSingleBuySpeech,
  buildGroupedBuySpeech,
  makeBuyEventKey,
  createBuyTtsNotifier,
  notifyBuyCustomer: defaultNotifier.notifyBuyCustomer,
  flush: defaultNotifier.flush,
  speak: defaultNotifier.speak,
  clear: defaultNotifier.clear
};

if (typeof window !== 'undefined') window.PDBBuyTtsNotifier = PDBBuyTtsNotifier;
if (typeof module !== 'undefined' && module.exports) module.exports = PDBBuyTtsNotifier;
