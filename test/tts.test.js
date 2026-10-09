const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTtsEndpoint,
  resolveTtsConfig,
  synthesizeSpeech,
  testTtsConnection
} = require('../src/server/tts');

test('tts: normalizeTtsEndpoint handles various url formats', () => {
  assert.equal(
    normalizeTtsEndpoint('https://rtltbar.abc-tunnel.us/v1'),
    'https://rtltbar.abc-tunnel.us/v1/audio/speech'
  );
  assert.equal(
    normalizeTtsEndpoint('https://rtltbar.abc-tunnel.us/v1/audio/speech'),
    'https://rtltbar.abc-tunnel.us/v1/audio/speech'
  );
  assert.equal(
    normalizeTtsEndpoint('https://rtltbar.abc-tunnel.us/v1/'),
    'https://rtltbar.abc-tunnel.us/v1/audio/speech'
  );
  assert.equal(
    normalizeTtsEndpoint(''),
    'https://rtltbar.abc-tunnel.us/v1/audio/speech'
  );
});

test('tts: resolveTtsConfig reads settings and overrides', () => {
  const config = resolveTtsConfig(
    { ttsBaseUrl: 'https://test.com/v1', ttsApiKey: 'key1', ttsModel: 'google-tts/vi' },
    { ttsApiKey: 'override-key' }
  );
  assert.equal(config.baseUrl, 'https://test.com/v1');
  assert.equal(config.endpoint, 'https://test.com/v1/audio/speech');
  assert.equal(config.apiKey, 'override-key');
  assert.equal(config.model, 'google-tts/vi');
});

test('tts: synthesizeSpeech throws on missing text or apiKey', async () => {
  await assert.rejects(
    () => synthesizeSpeech({ text: '' }),
    /Nội dung đọc/
  );
  await assert.rejects(
    () => synthesizeSpeech({ text: 'Hello', settings: { ttsApiKey: '' }, overrides: { ttsApiKey: '' } }),
    /Thiếu TTS API Key/
  );
});

test('tts: synthesizeSpeech sends correct request body and returns audio buffer', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedOptions = {};

  globalThis.fetch = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return new Response(Buffer.from([0xff, 0xfb, 0x90, 0x64]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mp3' }
    });
  };

  try {
    const buffer = await synthesizeSpeech({
      text: 'Khách mua hàng mới',
      settings: {
        ttsBaseUrl: 'https://test-tts.com/v1',
        ttsApiKey: 'sk-test-123',
        ttsModel: 'google-tts/vi'
      }
    });

    assert.equal(requestedUrl, 'https://test-tts.com/v1/audio/speech');
    assert.equal(requestedOptions.method, 'POST');
    assert.equal(requestedOptions.headers['Authorization'], 'Bearer sk-test-123');
    assert.equal(requestedOptions.headers['Content-Type'], 'application/json');

    const body = JSON.parse(requestedOptions.body);
    assert.equal(body.model, 'google-tts/vi');
    assert.equal(body.input, 'Khách mua hàng mới');

    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('tts: synthesizeSpeech throws on non-200 response', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
      status: 401,
      statusText: 'Unauthorized'
    });
  };

  try {
    await assert.rejects(
      () => synthesizeSpeech({
        text: 'Test error',
        settings: { ttsApiKey: 'bad-key' }
      }),
      /TTS API lỗi \(401\): Invalid API key/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('tts: testTtsConnection returns ok on success', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return new Response(Buffer.from([1, 2, 3, 4, 5]), {
      status: 200
    });
  };

  try {
    const result = await testTtsConnection({ ttsApiKey: 'valid-key' });
    assert.deepEqual(result, {
      ok: true,
      message: 'Kết nối TTS thành công',
      bytes: 5
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
