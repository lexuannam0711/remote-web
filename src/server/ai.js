const {
  classifyMessage,
  extractContactInfo,
  normalizeVietnameseText,
  sanitizeCustomerTags
} = require('./rules');
const { keywordSuggest } = require('./shortcutMatcher');
const { validateShortcutOnly, validateTopSuggestions } = require('./validators');

function pickConfiguredValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeChatUrl(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return 'https://api.openai.com/v1/chat/completions';
  const clean = raw.replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) return clean;
  if (clean.endsWith('/v1')) return `${clean}/chat/completions`;
  // Bare host (e.g. https://9router.com/api) -> append the standard path.
  return `${clean}/chat/completions`;
}

function maskSecret(secret) {
  const raw = String(secret || '');
  if (!raw) return '';
  if (raw.length <= 8) return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}

function resolveAIConfig(settings = {}, overrides = {}) {
  const storedBaseUrl = pickConfiguredValue(overrides.aiBaseUrl, settings.aiBaseUrl);
  const storedApiKey = pickConfiguredValue(overrides.aiApiKey, settings.aiApiKey);
  const storedModel = pickConfiguredValue(overrides.aiModel, settings.aiModel);
  const envBaseUrl = pickConfiguredValue(process.env.AI_BASE_URL, process.env.OPENAI_BASE_URL, 'https://api.openai.com/v1');
  const envApiKey = pickConfiguredValue(process.env.AI_API_KEY, process.env.OPENAI_API_KEY);
  const envModel = pickConfiguredValue(process.env.AI_MODEL, process.env.OPENAI_MODEL, 'gpt-5-mini');

  const baseUrl = pickConfiguredValue(storedBaseUrl, envBaseUrl);
  const apiKey = pickConfiguredValue(storedApiKey, envApiKey);
  const model = pickConfiguredValue(storedModel, envModel);

  return {
    baseUrl,
    apiKey,
    model,
    chatUrl: normalizeChatUrl(baseUrl),
    source: {
      baseUrl: storedBaseUrl ? 'settings' : 'env',
      apiKey: storedApiKey ? 'settings' : 'env',
      model: storedModel ? 'settings' : 'env'
    }
  };
}

function summarizeAIConfig(settings = {}, overrides = {}) {
  const config = resolveAIConfig(settings, overrides);
  return {
    aiBaseUrl: config.baseUrl,
    aiApiKey: pickConfiguredValue(overrides.aiApiKey, settings.aiApiKey, process.env.AI_API_KEY, process.env.OPENAI_API_KEY),
    aiApiKeyMasked: maskSecret(config.apiKey),
    aiModel: config.model,
    resolvedResponsesUrl: config.chatUrl,
    source: config.source
  };
}

function safeJsonParse(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch (_) {}
  // Strip markdown codeblocks e.g. ```json ... ```
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch (_) {}
  }
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (_) {}
  }
  return null;
}

function selectLastCustomerText(history, fallback = '') {
  const latestSnippet = String(fallback || '').trim();
  if (latestSnippet) return latestSnippet;
  const recent = Array.isArray(history) ? history.slice(-5) : [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const item = recent[index];
    if (item && item.from === 'customer') {
      const text = String(item.text || '').trim();
      if (text) return text;
    }
  }
  return latestSnippet;
}

function buildPrompt(customerMessage, shortcuts, context, examples = [], history = []) {
  const safeContext = {
    ...(context && typeof context === 'object' ? context : {}),
    currentTags: sanitizeCustomerTags(context?.currentTags)
  };
  const compactShortcuts = shortcuts.map((s) => ({
    shortcut: s.shortcut,
    topic: s.topic || '',
    quickReply: s.quickReply || '',
    message: s.message || '',
    folders: s.folders || ''
  }));

  const learnedBlock = (Array.isArray(examples) && examples.length)
    ? `\n\nVÍ DỤ ĐÃ HỌC (tin khách trước đây và shortcut shop đã chọn đúng - ưu tiên bắt chước nếu tin mới tương tự):\n${JSON.stringify(examples.map((e) => ({ message: e.message, shortcut: e.shortcut })))}`
    : '';

  const recentHistory = Array.isArray(history) ? history.slice(-5) : [];
  const historyBlock = recentHistory.length
    ? `\n\nLỊCH SỬ HỘI THOẠI (cũ → mới, "admin" là shop, "customer" là khách). Dùng để hiểu ngữ cảnh và giai đoạn của khách:\n${JSON.stringify(recentHistory)}`
    : '';

  const order = safeContext.orderStatus;
  const orderBlock = (order && order.hasOrdered)
    ? `\n\nTRẠNG THÁI ĐƠN HÀNG: Khách ĐÃ CÓ ${order.orderCount} đơn (trạng thái mới nhất: ${order.latestStatus || 'không rõ'}).`
    : '';

  const validIntents = 'GREETING, PRICE_QUESTION, PRODUCT_QUESTION, SHIPPING_QUESTION, USAGE_QUESTION, BUY_INTENT_LOW, BUY_INTENT_HIGH, PHONE_DETECTED, ADDRESS_DETECTED, REFUSAL, COMPLAINT, OUT_OF_SCOPE, UNKNOWN';

  return `Bạn là bộ phân tích tin nhắn khách hàng và chọn shortcut cho Pancake.

QUY TẮC TUYỆT ĐỐI:
- Chỉ chọn shortcut có trong danh sách.
- Không bịa shortcut mới.
- Không viết câu trả lời gửi khách.
- Trả về JSON hợp lệ, không markdown.
- Nếu khách cung cấp đủ địa chỉ nhận hàng để giao hàng: bestShortcut=null, shouldEscalate=true, action=TAG_BUY_AND_MARK_UNREAD.

CÁCH PHÂN TÍCH (suy luận theo thứ tự rồi mới chọn):
1. Đọc LỊCH SỬ HỘI THOẠI để hiểu khách đã hỏi gì, shop đã trả gì.
2. Xác định giai đoạn của khách: MỚI (chưa hỏi gì) / ĐANG CÂN NHẮC (đã hỏi giá/sản phẩm) / SẮP MUA (hỏi cách đặt, để lại thông tin).
3. Chọn shortcut khớp với TIN MỚI NHẤT và giai đoạn đó, tránh lặp lại shortcut shop vừa gửi.

INTENT hợp lệ: ${validIntents}.

SCHEMA JSON:
{
  "intent": "PRICE_QUESTION",
  "action": "SUGGEST_SHORTCUT",
  "bestShortcut": "/2 hoặc null",
  "confidence": 0.0,
  "reason": "lý do ngắn",
  "topSuggestions": [
    {"shortcut":"/2","topic":"báo giá","confidence":0.9,"reason":"..."}
  ],
  "shouldSend": false,
  "shouldEscalate": false
}
${historyBlock}${orderBlock}${learnedBlock}

TIN KHÁCH (mới nhất): ${JSON.stringify(customerMessage)}
CONTEXT: ${JSON.stringify(safeContext)}
DANH SÁCH SHORTCUT: ${JSON.stringify(compactShortcuts)}`;
}

function extractResponseText(payload) {
  if (!payload || typeof payload !== 'object') return '';

  // 1. Chat Completions format: choices[0].message
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    const message = choice?.message;
    // Standard content
    const content = message?.content;
    if (typeof content === 'string' && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const joined = content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('').trim();
      if (joined) return joined;
    }
    // Reasoning / Thinking models (Antigravity, DeepSeek-R1, o1, etc.)
    const reasoning = message?.reasoning_content || message?.reasoning || message?.thought || message?.thinking;
    if (typeof reasoning === 'string' && reasoning.trim()) {
      const jsonMatch = reasoning.match(/\{[\s\S]*\}/);
      if (jsonMatch) return jsonMatch[0].trim();
      return reasoning.trim();
    }
    // Legacy choice.text (completions API)
    if (typeof choice?.text === 'string' && choice.text.trim()) {
      return choice.text.trim();
    }
    // Delta (streaming format if received non-streamed)
    if (typeof choice?.delta?.content === 'string' && choice.delta.content.trim()) {
      return choice.delta.content.trim();
    }
  }

  // 2. Google Gemini native format: candidates[].content.parts[].text
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;
    if (Array.isArray(parts)) {
      const joined = parts.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('').trim();
      if (joined) return joined;
    }
    if (typeof candidate?.output === 'string' && candidate.output.trim()) {
      return candidate.output.trim();
    }
  }

  // 3. Anthropic native format: content[].text
  if (Array.isArray(payload.content)) {
    const joined = payload.content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('').trim();
    if (joined) return joined;
  }

  // 4. Other root-level response fields
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  if (typeof payload.response === 'string' && payload.response.trim()) return payload.response.trim();
  if (typeof payload.result === 'string' && payload.result.trim()) return payload.result.trim();
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim();
  if (typeof payload.text === 'string' && payload.text.trim()) return payload.text.trim();

  return '';
}

function parseEventStream(text) {
  let content = '';
  let reasoning = '';
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const dataStr = trimmed.slice(5).trim();
    if (dataStr === '[DONE]') continue;
    try {
      const chunk = JSON.parse(dataStr);
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) content += delta.content;
      if (delta?.reasoning_content) reasoning += delta.reasoning_content;
      if (delta?.thought) reasoning += delta.thought;
      if (chunk.choices?.[0]?.text) content += chunk.choices[0].text;
    } catch (_) {}
  }
  return content.trim() || reasoning.trim();
}

async function callAI(prompt, settings = {}, overrides = {}) {
  const config = resolveAIConfig(settings, overrides);
  if (!config.apiKey) throw new Error('Thiếu AI API key');
  if (!config.baseUrl) throw new Error('Thiếu AI base URL');
  if (!config.model) throw new Error('Thiếu AI model');

  // Map antigravity alias to the actual model ID on the gateway
  let effectiveModel = config.model;
  if (effectiveModel.toLowerCase() === 'antigravity' || effectiveModel.toLowerCase() === 'ag') {
    effectiveModel = 'ag/gemini-3.8-flash-high';
  }

  const res = await fetch(config.chatUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: effectiveModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2048,
      temperature: 0.2
    })
  });

  let contentType = '';
  if (res.headers) {
    if (typeof res.headers.get === 'function') contentType = String(res.headers.get('content-type') || '');
    else if (res.headers['content-type']) contentType = String(res.headers['content-type'] || '');
  }
  contentType = contentType.toLowerCase();

  let rawText = '';
  if (typeof res.text === 'function') {
    rawText = await res.text();
  } else if (typeof res.json === 'function') {
    const j = await res.json();
    rawText = typeof j === 'string' ? j : JSON.stringify(j);
  }

  if (!res.ok) {
    let errorDetail = '';
    try {
      const errJson = JSON.parse(rawText);
      errorDetail = errJson?.error?.message || errJson?.error || errJson?.message;
    } catch (_) {}
    const detail = errorDetail || `${res.status} ${res.statusText}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }

  // Check if response is SSE event-stream (either by header or by body starting with data:)
  if (contentType.includes('text/event-stream') || rawText.trim().startsWith('data:')) {
    const streamText = parseEventStream(rawText);
    if (!streamText) {
      throw new Error('AI stream trả về rỗng');
    }
    return streamText;
  }

  // Standard JSON response
  let payload = {};
  try {
    payload = JSON.parse(rawText);
  } catch (_) {
    if (rawText.trim()) return rawText.trim();
  }

  const text = extractResponseText(payload);
  if (!text) {
    if (rawText.trim() && !rawText.trim().startsWith('{')) return rawText.trim();
    const keys = Object.keys(payload || {});
    throw new Error(`AI không trả về nội dung (payload keys: [${keys.join(', ')}])`);
  }
  return text;
}

async function testAIConnection(settings = {}, overrides = {}) {
  const text = await callAI('Trả về đúng JSON này và không thêm gì khác: {"ok":true}', settings, overrides);
  const parsed = safeJsonParse(text);
  if (!parsed?.ok) throw new Error(`AI test trả về không hợp lệ: ${text}`);
  return {
    ok: true,
    message: 'Kết nối AI thành công',
    config: summarizeAIConfig(settings, overrides)
  };
}

async function analyzeMessageWithAI({ customerMessage, shortcuts, context = {}, settings = {}, examples = [], history = [] }) {
  const items = Array.isArray(shortcuts) ? shortcuts : [];
  const hard = classifyMessage(customerMessage);

  // Non-text events (sticker, like, photo, pure link, empty): do nothing.
  // Never tag/escalate — wait for a real text message from the customer.
  if (hard.intent === 'NON_TEXT') {
    return {
      intent: 'NON_TEXT',
      action: 'SKIP',
      bestShortcut: null,
      confidence: 0,
      reason: 'Khách gửi sticker/nhãn dán/like/link, không phải tin nhắn text - bỏ qua',
      topSuggestions: [],
      shouldSend: false,
      shouldEscalate: false
    };
  }

  // ONLY full 3-level address triggers BUY_INTENT_HIGH / TAG_BUY_AND_MARK_UNREAD
  if (hard.isFull3Level) {
    const contactInfo = extractContactInfo(customerMessage);
    const bits = [];
    if (contactInfo.phone) bits.push(`SĐT: ${contactInfo.phone}`);
    if (contactInfo.address) bits.push(`Địa chỉ: ${contactInfo.address}`);
    const detail = bits.length ? ` (${bits.join(' | ')})` : '';
    return {
      intent: 'BUY_INTENT_HIGH',
      action: 'TAG_BUY_AND_MARK_UNREAD',
      bestShortcut: null,
      confidence: 1,
      reason: `Khách gửi đủ địa chỉ 3 cấp (xã/phường - quận/huyện - tỉnh/thành), cần chủ shop xử lý${detail}`,
      contactInfo,
      topSuggestions: [],
      shouldSend: false,
      shouldEscalate: true
    };
  }

  // Otherwise: Bot answers normally using shortcuts / AI
  if (!items.length) {
    return {
      intent: hard.intent,
      action: 'WAITING_REVIEW',
      bestShortcut: null,
      confidence: 0,
      reason: 'Chưa có shortcut trong shortcuts.json',
      topSuggestions: [],
      shouldSend: false,
      shouldEscalate: true
    };
  }

  const fallback = keywordSuggest(customerMessage, items);
  try {
    const text = await callAI(buildPrompt(customerMessage, items, context, examples, history), settings);
    const parsed = safeJsonParse(text);
    if (!parsed) throw new Error('AI trả JSON không hợp lệ');

    const shortcutValidation = validateShortcutOnly({
      shortcut: parsed.bestShortcut || parsed.shortcut,
      confidence: parsed.confidence,
      reason: parsed.reason
    }, items);

    const topSuggestions = validateTopSuggestions(parsed.topSuggestions || [], items);
    const bestShortcut = shortcutValidation.shortcut;
    const confidence = shortcutValidation.shortcut ? shortcutValidation.confidence : 0;

    const contactInfo = extractContactInfo(customerMessage);

    return {
      intent: parsed.intent || hard.intent || 'UNKNOWN',
      action: parsed.action || (bestShortcut ? 'SUGGEST_SHORTCUT' : 'WAITING_REVIEW'),
      bestShortcut,
      confidence,
      reason: shortcutValidation.reason || parsed.reason || fallback.reason,
      topSuggestions: topSuggestions.length ? topSuggestions : fallback.topSuggestions,
      contactInfo,
      shouldSend: false,
      shouldEscalate: Boolean(parsed.shouldEscalate) || !bestShortcut
    };
  } catch (error) {
    return { ...fallback, reason: `${fallback.reason} | AI lỗi/fallback: ${error.message}` };
  }
}

module.exports = {
  analyzeMessageWithAI,
  buildPrompt,
  selectLastCustomerText,
  safeJsonParse,
  extractResponseText,
  resolveAIConfig,
  summarizeAIConfig,
  testAIConnection
};
