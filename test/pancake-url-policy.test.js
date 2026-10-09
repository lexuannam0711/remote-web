const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PANCAKE_CHAT_URL,
  isAllowedAutomationUrl,
  normalizeBotUrl
} = require('../src/renderer/pancakeUrlPolicy');

test('Pancake URL policy allows only HTTPS trusted chat locations', () => {
  assert.equal(isAllowedAutomationUrl('https://pancake.vn/multi_pages'), true);
  assert.equal(isAllowedAutomationUrl('https://pancake.vn/multi_pages/inbox?page=1#x'), true);
  assert.equal(isAllowedAutomationUrl('https://pages.fm/inbox'), true);
  assert.equal(isAllowedAutomationUrl('http://pancake.vn/multi_pages'), false);
  assert.equal(isAllowedAutomationUrl('https://evil.example/multi_pages'), false);
  assert.equal(isAllowedAutomationUrl('javascript:alert(1)'), false);
});

test('Pancake URL policy normalizes legacy roots and rejects arbitrary bot URLs', () => {
  assert.equal(normalizeBotUrl('https://pages.fm/'), PANCAKE_CHAT_URL);
  assert.equal(normalizeBotUrl('https://pancake.vn/dashboard'), PANCAKE_CHAT_URL);
  assert.equal(normalizeBotUrl('https://pancake.vn/multi_pages?tab=inbox'), 'https://pancake.vn/multi_pages?tab=inbox');
  assert.equal(normalizeBotUrl('https://evil.example/phishing'), '');
  assert.equal(normalizeBotUrl('not a url'), '');
});
