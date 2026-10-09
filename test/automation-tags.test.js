const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const variantRoot = process.env.PDB_DOM_TEST_VARIANT === 'win7' ? '../win7/src/renderer' : '../src/renderer';
const { readActiveTagNames } = require(variantRoot + '/pancakeDom');

function loadAutomation(buttons, last = null, { hasTagPanel = false, onWarn = () => {} } = {}) {
  const document = {
    querySelectorAll(selector) {
      assert.equal(selector, '#listShowTags .btn-tag-item, .btn-tag-item');
      return buttons;
    },
    querySelector(selector) {
      if (selector === '#listShowTags') return hasTagPanel ? {} : null;
      return null;
    }
  };
  const window = {
    __PDB_LAST__: last,
    PDBPancakeDom: {
      readActiveTagNames,
      collectUnreadConversations() {
        return { rawCount: 0, items: [], malformedCount: 0, degraded: false };
      },
      findConversationElementById() {
        return null;
      },
      clickConversationById() {
        return { ok: false };
      }
    },
    PDBPancakeUrlPolicy: { isAllowedAutomationUrl: () => true }
  };
  const context = {
    window,
    document,
    location: { href: 'https://pancake.vn/multi_pages' },
    URL,
    getComputedStyle: (element) => element.__style,
    setTimeout,
    Event: class Event {},
    KeyboardEvent: class KeyboardEvent {},
    HTMLTextAreaElement: class HTMLTextAreaElement {},
    HTMLInputElement: class HTMLInputElement {},
    console: { warn: onWarn }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, variantRoot, 'automation.js'), 'utf8'),
    context
  );
  return window.__PDB__;
}

test('applyTagByName does not scroll or click an already active exact visible tag', async () => {
  const calls = { scroll: 0, click: 0 };
  const button = {
    textContent: '  VIP  ',
    __style: { display: 'block', visibility: 'visible' },
    getBoundingClientRect() {
      return { width: 120, height: 32 };
    },
    querySelector(selector) {
      return selector === '.ellipse' ? {} : null;
    },
    scrollIntoView() {
      calls.scroll += 1;
    },
    click() {
      calls.click += 1;
    }
  };

  const result = await loadAutomation([button]).applyTagByName('vip');

  assert.equal(result.ok, true);
  assert.equal(result.alreadyApplied, true);
  assert.equal(result.message, 'Tag already applied: vip');
  assert.deepEqual(calls, { scroll: 0, click: 0 });
});

test('getCurrentTags prefers rendered active tags and only falls back when no buttons exist', () => {
  const activeButton = {
    textContent: '  VIP  ',
    __style: { display: 'block', visibility: 'visible' },
    getBoundingClientRect: () => ({ width: 120, height: 32 }),
    querySelector: (selector) => (selector === '.ellipse' ? {} : null)
  };
  const inactiveButton = {
    textContent: 'New',
    __style: { display: 'block', visibility: 'visible' },
    getBoundingClientRect: () => ({ width: 120, height: 32 }),
    querySelector: () => null
  };

  assert.deepEqual(
    loadAutomation([activeButton, inactiveButton], { tags: ['Stale snapshot'] }).getCurrentTags(),
    ['VIP']
  );
  assert.deepEqual(loadAutomation([], { tags: ['Snapshot tag'] }).getCurrentTags(), ['Snapshot tag']);
});

test('getCurrentTags returns an empty list for a present empty tag panel', () => {
  const result = loadAutomation([], { tags: ['Stale snapshot'] }, { hasTagPanel: true }).getCurrentTags();

  assert.deepEqual(result, []);
});

test('getCurrentTags warns when the tag panel is unavailable and row tags are used', () => {
  const warnings = [];
  const result = loadAutomation([], { tags: ['Snapshot tag'] }, {
    onWarn: (...args) => warnings.push(args)
  }).getCurrentTags();

  assert.deepEqual(result, ['Snapshot tag']);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /tag panel/i);
});

test('repurchase escalation does not toggle off an already-active Mua hàng tag', async () => {
  const calls = { scroll: 0, click: 0 };
  const button = {
    textContent: 'Mua hàng',
    __style: { display: 'block', visibility: 'visible' },
    getBoundingClientRect: () => ({ width: 120, height: 32 }),
    querySelector: (selector) => (selector === '.ellipse' ? {} : null),
    scrollIntoView: () => { calls.scroll += 1; },
    click: () => { calls.click += 1; }
  };

  const result = await loadAutomation([button]).applyTagByName('Mua hàng');

  assert.equal(result.ok, true);
  assert.equal(result.alreadyApplied, true);
  assert.deepEqual(calls, { scroll: 0, click: 0 });
});

test('getUnreadConversations returns an array when PDBPancakeDom returns an object with items', () => {
  const window = {
    PDBPancakeDom: {
      collectUnreadConversations() {
        return { rawCount: 2, items: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }], malformedCount: 0, degraded: false };
      }
    },
    PDBPancakeUrlPolicy: { isAllowedAutomationUrl: () => true }
  };
  const context = {
    window,
    document: {},
    location: { href: 'https://pancake.vn/multi_pages' },
    URL,
    getComputedStyle: () => ({}),
    setTimeout
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, variantRoot, 'automation.js'), 'utf8'),
    context
  );
  const unread = context.window.__PDB__.getUnreadConversations();
  assert.ok(Array.isArray(unread));
  assert.equal(unread.length, 2);
  assert.equal(unread[0].name, 'A');
  assert.equal(unread.rawCount, 2);
});

test('unread scan fails closed without the DOM helper while page detection remains available', async () => {
  const row = {
    id: 'row-1',
    getBoundingClientRect: () => ({ width: 100, height: 40 }),
    querySelector: (sel) => {
      if (sel === '.name-text') return { textContent: 'Khách 1' };
      if (sel === '.snippet-text') return { textContent: 'Alo' };
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === '.list-tags-conv .conversation_tags_item') return [{ textContent: 'Khách mới' }];
      return [];
    }
  };
  const context = {
    window: {}, // PDBPancakeDom and PDBPancakeUrlPolicy are undefined
    document: {
      querySelectorAll: (sel) => (sel === '.conversation-list-item.unread' ? [row] : []),
      querySelector: () => null
    },
    location: { href: 'https://pancake.vn/multi_pages' },
    URL,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setTimeout
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, variantRoot, 'automation.js'), 'utf8'),
    context
  );
  assert.throws(() => context.window.__PDB__.getUnreadConversations(), { code: 'DOM_DEGRADED' });
  await assert.rejects(context.window.__PDB__.clickConversationById('row-1'), { code: 'DOM_DEGRADED' });

  const status = await context.window.__PDB__.getDomStatus();
  assert.equal(status.pageKind, 'chat');
  assert.equal(status.isChatPage, true);
});
