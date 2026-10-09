const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectFull3LevelAddress,
  detectAddress,
  classifyMessage,
  extractContactInfo,
  VIETNAM_PROVINCES
} = require('../src/server/rules');

const {
  analyzeMessageWithAI,
  extractResponseText,
  safeJsonParse,
  buildPrompt
} = require('../src/server/ai');

const shortcuts = [
  { shortcut: '/1', topic: 'Khách mới', message: 'Xin chào quý khách' },
  { shortcut: '/2', topic: 'Báo giá', message: 'Dạ em gửi bảng giá ạ' },
  { shortcut: '/3', topic: 'Xin địa chỉ', message: 'Dạ anh/chị cho em xin địa chỉ nhận hàng ạ' }
];

test('63 provinces: all 63 provinces are indexed and recognized', () => {
  assert.equal(VIETNAM_PROVINCES.length, 63);
  const sampleProvinces = [
    'Hà Nội', 'Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ',
    'Đắk Lắk', 'Lâm Đồng', 'Quảng Ninh', 'Cà Mau', 'Bà Rịa - Vũng Tàu'
  ];
  for (const name of sampleProvinces) {
    const item = VIETNAM_PROVINCES.find((p) => p.name === name);
    assert.ok(item, `Missing province: ${name}`);
    assert.ok(item.aliases.length > 0);
  }
});

test('3-level address: accurately detects full 3-level addresses', () => {
  const fullAddresses = [
    'Thôn 1, xã Ea Kao, TP Buôn Ma Thuột, Đắk Lắk',
    'Số 12 ngõ 45 Cầu Giấy, phường Quan Hoa, quận Cầu Giấy, Hà Nội',
    'Ấp 2, Tân Thạnh Đông, Củ Chi, TP.HCM',
    'xã Nghĩa An, huyện Nam Trực, tỉnh Nam Định',
    'phường Bến Nghé, quận 1, Hồ Chí Minh',
    'Số 5 đường Lê Duẩn, P. Hải Châu 1, Q. Hải Châu, Đà Nẵng'
  ];

  for (const addr of fullAddresses) {
    const result = detectFull3LevelAddress(addr);
    assert.equal(result.isFull3Level, true, `Should be full 3-level: ${addr}`);
    assert.ok(result.level1, `Level 1 must be present: ${addr}`);
  }
});

test('3-level address: incomplete address or phone only is not full 3-level', () => {
  const incompleteCases = [
    'SĐT 0987654321, mình ở Hà Nội',
    'Giao cho mình qua quận 1, HCM',
    'Mình ở Cầu Giấy',
    '0912345678',
    'ship về hp bao lâu',
    'giá bao nhiêu một hộp'
  ];

  for (const text of incompleteCases) {
    const result = detectFull3LevelAddress(text);
    assert.equal(result.isFull3Level, false, `Should NOT be full 3-level: ${text}`);
  }
});

test('classifyMessage & analyzeMessageWithAI: full 3-level address triggers TAG_BUY_AND_MARK_UNREAD', async () => {
  const message = 'Mình lấy 1 hộp gửi về Thôn 1, xã Ea Kao, TP Buôn Ma Thuột, Đắk Lắk, SĐT 0912345678';
  const result = await analyzeMessageWithAI({
    customerMessage: message,
    shortcuts,
    context: { currentTags: ['Khách cũ'] },
    settings: { aiApiKey: 'test-key' }
  });

  assert.equal(result.action, 'TAG_BUY_AND_MARK_UNREAD');
  assert.equal(result.shouldEscalate, true);
  assert.equal(result.bestShortcut, null);
  assert.ok(result.contactInfo.full3Level);
  assert.equal(result.contactInfo.phone, '0912345678');
});

test('classifyMessage & analyzeMessageWithAI: phone only or incomplete address answers normally (does NOT mark unread)', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: 'PRICE_QUESTION',
              action: 'SUGGEST_SHORTCUT',
              bestShortcut: '/2',
              confidence: 0.9,
              reason: 'Báo giá',
              topSuggestions: [{ shortcut: '/2', topic: 'Báo giá', confidence: 0.9 }]
            })
          }
        }]
      })
    });

    // Customer only provides phone and province (not 3-level)
    const message = 'SĐT mình là 0912345678, mình ở Hà Nội, giá bao nhiêu em';
    const result = await analyzeMessageWithAI({
      customerMessage: message,
      shortcuts,
      context: { currentTags: ['Khách đang hỏi'] },
      settings: { aiApiKey: 'test-key' }
    });

    assert.equal(result.action, 'SUGGEST_SHORTCUT');
    assert.equal(result.bestShortcut, '/2');
    assert.equal(result.shouldEscalate, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('returning customer policy removed: old tags are not forced to /32 or repurchase gating', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: 'PRICE_QUESTION',
              action: 'SUGGEST_SHORTCUT',
              bestShortcut: '/2',
              confidence: 0.95,
              reason: 'Tư vấn giá'
            })
          }
        }]
      })
    });

    // Customer has old tags: 'Nhận Saruto 1', 'Đã nhận TRÀ'
    const result = await analyzeMessageWithAI({
      customerMessage: 'sản phẩm này giá bao nhiêu shop',
      shortcuts,
      context: { currentTags: ['Nhận Saruto 1', 'Đã nhận TRÀ'] },
      settings: { aiApiKey: 'test-key' }
    });

    // Bot answers normally with /2, NOT forced to /32
    assert.equal(result.action, 'SUGGEST_SHORTCUT');
    assert.equal(result.bestShortcut, '/2');
    assert.notEqual(result.bestShortcut, '/32');
  } finally {
    global.fetch = originalFetch;
  }
});

test('AI extraction: Antigravity thinking / reasoning_content is handled without empty message', () => {
  // Payload from Antigravity/reasoning model where content is empty or null, but reasoning_content has the JSON
  const payloadWithReasoning = {
    choices: [
      {
        message: {
          content: null,
          reasoning_content: 'Let me think about this customer message... {"ok":true}'
        }
      }
    ]
  };

  const text = extractResponseText(payloadWithReasoning);
  assert.ok(text.length > 0, 'Extracted text must not be empty');
  const parsed = safeJsonParse(text);
  assert.equal(parsed?.ok, true);
});

test('AI extraction: Gemini native candidates format is handled', () => {
  const payloadGemini = {
    candidates: [
      {
        content: {
          parts: [
            { text: '{"intent":"GREETING","action":"SUGGEST_SHORTCUT","bestShortcut":"/1"}' }
          ]
        }
      }
    ]
  };

  const text = extractResponseText(payloadGemini);
  assert.ok(text.includes('GREETING'));
  const parsed = safeJsonParse(text);
  assert.equal(parsed?.bestShortcut, '/1');
});

test('AI extraction: Markdown code blocks ```json are cleanly parsed', () => {
  const markdownText = '```json\n{\n  "ok": true,\n  "bestShortcut": "/2"\n}\n```';
  const parsed = safeJsonParse(markdownText);
  assert.equal(parsed?.ok, true);
  assert.equal(parsed?.bestShortcut, '/2');
});
