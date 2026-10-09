/**
 * Module xử lý chuyển văn bản thành giọng nói (TTS) qua OpenAI-compatible Audio Speech API.
 */

function normalizeTtsEndpoint(rawUrl) {
  let url = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!url) return 'https://rtltbar.abc-tunnel.us/v1/audio/speech';
  if (url.endsWith('/audio/speech')) return url;
  if (url.endsWith('/v1')) return `${url}/audio/speech`;
  return `${url}/v1/audio/speech`;
}

function resolveTtsConfig(settings = {}, overrides = {}) {
  const baseUrl = overrides.ttsBaseUrl || settings.ttsBaseUrl || process.env.TTS_BASE_URL || 'https://rtltbar.abc-tunnel.us/v1';
  const apiKey = overrides.ttsApiKey || settings.ttsApiKey || process.env.TTS_API_KEY || '';
  const model = overrides.ttsModel || settings.ttsModel || process.env.TTS_MODEL || 'google-tts/vi';
  const provider = overrides.ttsProvider || settings.ttsProvider || 'api';

  return {
    provider,
    baseUrl: String(baseUrl).trim(),
    endpoint: normalizeTtsEndpoint(baseUrl),
    apiKey: String(apiKey).trim(),
    model: String(model).trim() || 'google-tts/vi'
  };
}

async function synthesizeSpeech({ text, settings = {}, overrides = {} }) {
  const input = String(text || '').trim();
  if (!input) throw new Error('Nội dung đọc (input) không được để trống');

  const config = resolveTtsConfig(settings, overrides);
  if (!config.apiKey) throw new Error('Thiếu TTS API Key');

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  };

  const body = JSON.stringify({
    model: config.model,
    input
  });

  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    let errorDetail = '';
    try {
      const errText = await res.text();
      try {
        const errJson = JSON.parse(errText);
        errorDetail = errJson?.error?.message || errJson?.error || errJson?.message || errText;
      } catch (_) {
        errorDetail = errText;
      }
    } catch (_) {}
    const detail = errorDetail || `${res.status} ${res.statusText}`;
    throw new Error(`TTS API lỗi (${res.status}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function testTtsConnection(settings = {}, overrides = {}) {
  const buffer = await synthesizeSpeech({
    text: 'Kiểm tra kết nối âm thanh thành công',
    settings,
    overrides
  });
  return {
    ok: true,
    message: 'Kết nối TTS thành công',
    bytes: buffer.length
  };
}

module.exports = {
  normalizeTtsEndpoint,
  resolveTtsConfig,
  synthesizeSpeech,
  testTtsConnection
};
