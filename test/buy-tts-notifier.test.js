const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  BUY_TTS_FULL_CONTACT_TEXT,
  BUY_TTS_NEW_CUSTOMER_TEXT,
  hasFullContact,
  buildSingleBuySpeech,
  buildGroupedBuySpeech,
  createBuyTtsNotifier
} = require('../src/renderer/buyTtsNotifier');

const APPROVED_FULL_CONTACT_SPEECH = 'Khách mua hàng, địa chỉ và số điện thoại đầy đủ';
const APPROVED_NEW_CUSTOMER_SPEECH = 'Khách mua hàng mới';
const APPROVED_GROUPED_SPEECH_FOR_TWO = 'Có 2 khách mua hàng';
const APPROVED_GROUPED_SPEECH_FOR_FIVE = 'Có 5 khách mua hàng';

function createClock() {
  let current = 0;
  let nextId = 1;
  const timers = new Map();

  function runDueTimers() {
    let ran = true;
    while (ran) {
      ran = false;
      for (const [id, timer] of Array.from(timers.entries())) {
        if (timer.at <= current) {
          timers.delete(id);
          timer.fn();
          ran = true;
        }
      }
    }
  }

  return {
    now: () => current,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: current + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    tick(ms) {
      current += ms;
      runDueTimers();
    }
  };
}

function createSpeechMock() {
  const spoken = [];
  function Utterance(text) {
    this.text = text;
  }
  return {
    spoken,
    Utterance,
    speechSynthesis: {
      getVoices: () => [{ lang: 'vi-VN', name: 'Vietnamese' }],
      speak: (utterance) => spoken.push({
        text: utterance.text,
        lang: utterance.lang,
        volume: utterance.volume,
        voiceLang: utterance.voice ? utterance.voice.lang : ''
      })
    }
  };
}

test('buy tts: exports approved Vietnamese speech literals', () => {
  assert.equal(BUY_TTS_FULL_CONTACT_TEXT, APPROVED_FULL_CONTACT_SPEECH);
  assert.equal(BUY_TTS_NEW_CUSTOMER_TEXT, APPROVED_NEW_CUSTOMER_SPEECH);
});

test('buy tts: source contains approved UTF-8 Vietnamese literals', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'buyTtsNotifier.js'), 'utf8');

  assert.equal(source.includes(`const BUY_TTS_FULL_CONTACT_TEXT = '${APPROVED_FULL_CONTACT_SPEECH}';`), true);
  assert.equal(source.includes(`const BUY_TTS_NEW_CUSTOMER_TEXT = '${APPROVED_NEW_CUSTOMER_SPEECH}';`), true);
  assert.equal(source.includes('return `Có ${Number(count) || 0} khách mua hàng`;'), true);
});

test('buy tts: chooses full-contact speech only when phone and address are present', () => {
  assert.equal(hasFullContact({ phone: '0912345678', address: '12 Nguyễn Trãi' }), true);
  assert.equal(hasFullContact({ phone: '0912345678', address: '' }), false);
  assert.equal(hasFullContact({ phone: '', address: '12 Nguyễn Trãi' }), false);
  assert.equal(hasFullContact({}), false);

  assert.equal(
    buildSingleBuySpeech({ phone: '0912345678', address: '12 Nguyễn Trãi' }),
    APPROVED_FULL_CONTACT_SPEECH
  );
  assert.equal(buildSingleBuySpeech({ phone: '0912345678' }), APPROVED_NEW_CUSTOMER_SPEECH);
  assert.equal(buildSingleBuySpeech({ address: '12 Nguyễn Trãi' }), APPROVED_NEW_CUSTOMER_SPEECH);
});

test('buy tts: builds grouped speech with customer count', () => {
  assert.equal(buildGroupedBuySpeech(2), APPROVED_GROUPED_SPEECH_FOR_TWO);
  assert.equal(buildGroupedBuySpeech(5), APPROVED_GROUPED_SPEECH_FOR_FIVE);
});

test('buy tts: speaks one full-contact event after debounce window', () => {
  const clock = createClock();
  const speech = createSpeechMock();
  const notifier = createBuyTtsNotifier({
    speechSynthesis: speech.speechSynthesis,
    SpeechSynthesisUtterance: speech.Utterance,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    debounceMs: 1500
  });

  assert.equal(notifier.notifyBuyCustomer({ phone: '0912345678', address: '12 Nguyễn Trãi' }), true);
  clock.tick(1499);
  assert.equal(speech.spoken.length, 0);
  clock.tick(1);

  assert.equal(speech.spoken.length, 1);
  assert.equal(speech.spoken[0].text, APPROVED_FULL_CONTACT_SPEECH);
  assert.equal(speech.spoken[0].lang, 'vi-VN');
  assert.equal(speech.spoken[0].volume, 1);
  assert.equal(speech.spoken[0].voiceLang, 'vi-VN');
});

test('buy tts: groups two buy events that arrive inside one debounce window', () => {
  const clock = createClock();
  const speech = createSpeechMock();
  const notifier = createBuyTtsNotifier({
    speechSynthesis: speech.speechSynthesis,
    SpeechSynthesisUtterance: speech.Utterance,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    debounceMs: 1500
  });

  assert.equal(notifier.notifyBuyCustomer({ customerName: 'A', message: 'mua 1' }), true);
  clock.tick(500);
  assert.equal(notifier.notifyBuyCustomer({ customerName: 'B', message: 'mua 2' }), true);
  clock.tick(1499);
  assert.equal(speech.spoken.length, 0);
  clock.tick(1);

  assert.equal(speech.spoken.length, 1);
  assert.equal(speech.spoken[0].text, APPROVED_GROUPED_SPEECH_FOR_TWO);
});

test('buy tts: separated events outside debounce become separate speech messages', () => {
  const clock = createClock();
  const speech = createSpeechMock();
  const notifier = createBuyTtsNotifier({
    speechSynthesis: speech.speechSynthesis,
    SpeechSynthesisUtterance: speech.Utterance,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    debounceMs: 1500
  });

  assert.equal(notifier.notifyBuyCustomer({ customerName: 'A', message: 'mua 1' }), true);
  clock.tick(1500);
  assert.equal(notifier.notifyBuyCustomer({ customerName: 'B', message: 'mua 2' }), true);
  clock.tick(1500);

  assert.deepEqual(speech.spoken.map((item) => item.text), [
    APPROVED_NEW_CUSTOMER_SPEECH,
    APPROVED_NEW_CUSTOMER_SPEECH
  ]);
});

test('buy tts: dedupes the same event inside ttl', () => {
  const clock = createClock();
  const speech = createSpeechMock();
  const notifier = createBuyTtsNotifier({
    speechSynthesis: speech.speechSynthesis,
    SpeechSynthesisUtterance: speech.Utterance,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    debounceMs: 1500,
    dedupeTtlMs: 60000
  });
  const event = {
    customerName: 'Khách A',
    phone: '0912345678',
    address: '12 Nguyễn Trãi',
    message: 'mua hàng giao em'
  };

  assert.equal(notifier.notifyBuyCustomer(event), true);
  assert.equal(notifier.notifyBuyCustomer(event), false);
  clock.tick(1500);

  assert.equal(speech.spoken.length, 1);
  assert.equal(speech.spoken[0].text, APPROVED_FULL_CONTACT_SPEECH);
});

test('buy tts: disabled setting prevents queueing and speaking', () => {
  const clock = createClock();
  const speech = createSpeechMock();
  const notifier = createBuyTtsNotifier({
    speechSynthesis: speech.speechSynthesis,
    SpeechSynthesisUtterance: speech.Utterance,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    debounceMs: 1500
  });

  assert.equal(notifier.notifyBuyCustomer({ customerName: 'A' }, { buyTtsEnabled: false }), false);
  clock.tick(1500);

  assert.equal(speech.spoken.length, 0);
});

test('buy tts: missing speech support fails softly', () => {
  const clock = createClock();
  const notifier = createBuyTtsNotifier({
    speechSynthesis: null,
    SpeechSynthesisUtterance: null,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    debounceMs: 1500
  });

  assert.equal(notifier.notifyBuyCustomer({ customerName: 'A' }), true);
  clock.tick(1500);

  assert.equal(notifier.getLastSpokenText(), '');
});

test('buy tts: plays audio via API when provider is api', async () => {
  const clock = createClock();
  const playedUrls = [];
  const fetchedBodies = [];

  const mockFetch = async (url, options) => {
    fetchedBodies.push(JSON.parse(options.body));
    return {
      ok: true,
      blob: async () => ({ size: 100 })
    };
  };

  const notifier = createBuyTtsNotifier({
    provider: 'api',
    fetch: mockFetch,
    createObjectURL: (blob) => 'blob:audio-' + blob.size,
    playAudio: async (url) => { playedUrls.push(url); },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    debounceMs: 1500
  });

  notifier.notifyBuyCustomer({ phone: '0912345678', address: '12 Nguyễn Trãi' }, { ttsProvider: 'api' });
  clock.tick(1500);

  await new Promise((r) => setTimeout(r, 10));

  assert.equal(fetchedBodies.length, 1);
  assert.equal(fetchedBodies[0].text, APPROVED_FULL_CONTACT_SPEECH);
  assert.deepEqual(playedUrls, ['blob:audio-100']);
});

for (const outcome of ['ended', 'media error', 'play rejection', 'play throw', 'volume failure', 'constructor failure', 'unsupported Audio']) {
  test(`buy tts: default Audio cleanup after ${outcome}`, async (context) => {
    const calls = [];
    const speech = createSpeechMock();
    const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
    let audio;
    let ended;
    let failed;
    class MockAudio {
      constructor(url) {
        assert.equal(url, 'blob:cleanup-test');
        if (outcome === 'constructor failure') throw new Error(outcome);
        audio = this;
      }
      set volume(value) {
        if (outcome === 'volume failure') throw new Error(outcome);
      }
      play() {
        if (outcome === 'play throw') throw new Error(outcome);
        if (outcome === 'play rejection') return Promise.reject(new Error(outcome));
        ended = this.onended;
        failed = this.onerror;
        queueMicrotask(() => outcome === 'ended' ? ended() : failed(new Error(outcome)));
        return Promise.resolve();
      }
      pause() { calls.push('pause'); }
      removeAttribute(name) { assert.equal(name, 'src'); calls.push('remove src'); }
      load() { calls.push('load'); }
    }
    Object.defineProperty(globalThis, 'Audio', { configurable: true, value: outcome === 'unsupported Audio' ? undefined : MockAudio });
    context.after(() => {
      if (originalAudio) Object.defineProperty(globalThis, 'Audio', originalAudio);
      else delete globalThis.Audio;
    });
    context.mock.method(URL, 'revokeObjectURL', (url) => {
      assert.equal(url, 'blob:cleanup-test');
      calls.push('revoke');
    });
    const notifier = createBuyTtsNotifier({
      provider: 'api',
      fetch: async () => ({ ok: true, blob: async () => new Blob(['audio']) }),
      createObjectURL: () => 'blob:cleanup-test',
      speechSynthesis: speech.speechSynthesis,
      SpeechSynthesisUtterance: speech.Utterance
    });
    assert.equal(notifier.speak(APPROVED_NEW_CUSTOMER_SPEECH), true);
    await new Promise((resolve) => setImmediate(resolve));
    if (ended) ended();
    if (failed) failed(new Error('late media error'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, audio ? ['pause', 'remove src', 'load', 'revoke'] : ['revoke']);
    if (audio) {
      assert.equal(audio.onended, null);
      assert.equal(audio.onerror, null);
    }
    assert.equal(speech.spoken.length, outcome === 'ended' ? 0 : 1);
    assert.equal(notifier.getLastSpokenText(), APPROVED_NEW_CUSTOMER_SPEECH);
  });
}

for (const rejected of [false, true]) {
  test(`buy tts: custom playAudio retains URL ownership on ${rejected ? 'rejection' : 'success'}`, async (context) => {
    const speech = createSpeechMock();
    const played = [];
    const revoke = context.mock.method(URL, 'revokeObjectURL');
    const notifier = createBuyTtsNotifier({
      provider: 'api',
      fetch: async () => ({ ok: true, blob: async () => new Blob(['audio']) }),
      createObjectURL: () => 'blob:custom-test',
      playAudio: async (url) => { played.push(url); if (rejected) throw new Error('blocked'); },
      speechSynthesis: speech.speechSynthesis,
      SpeechSynthesisUtterance: speech.Utterance
    });
    notifier.speak(APPROVED_NEW_CUSTOMER_SPEECH);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(played, ['blob:custom-test']);
    assert.equal(revoke.mock.callCount(), 0);
    assert.equal(speech.spoken.length, rejected ? 1 : 0);
  });
}

test('buy tts: vendor is byte-identical to source', () => {
  assert.deepEqual(
    fs.readFileSync(path.join(__dirname, '../src/renderer/buyTtsNotifier.js')),
    fs.readFileSync(path.join(__dirname, '../web/public/vendor/buyTtsNotifier.js'))
  );
});

test('buy tts: falls back to speechSynthesis when API fails', async () => {
  const clock = createClock();
  const speech = createSpeechMock();

  const failingFetch = async () => {
    return {
      ok: false,
      status: 500
    };
  };

  const notifier = createBuyTtsNotifier({
    provider: 'api',
    fetch: failingFetch,
    speechSynthesis: speech.speechSynthesis,
    SpeechSynthesisUtterance: speech.Utterance,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    debounceMs: 1500
  });

  notifier.notifyBuyCustomer({ customerName: 'A', message: 'mua 1' }, { ttsProvider: 'api' });
  clock.tick(1500);

  await new Promise((r) => setTimeout(r, 20));

  assert.equal(speech.spoken.length, 1);
  assert.equal(speech.spoken[0].text, APPROVED_NEW_CUSTOMER_SPEECH);
});
