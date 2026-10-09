const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectUnreadConversations,
  findConversationElementById,
  clickConversationById,
  readActiveTagNames,
  findMarkUnreadButton
} = require(process.env.PDB_DOM_TEST_VARIANT === 'win7' ? '../win7/src/renderer/pancakeDom' : '../src/renderer/pancakeDom');

function textNode(textContent) {
  return { textContent };
}

function conversationRow({
  id,
  identityClasses = [],
  avatarSources = [],
  name = '',
  snippet = '',
  tags = [],
  connected = true,
  display = 'block',
  visibility = 'visible',
  width = 320,
  height = 64,
  parseError = null
}) {
  const tagNodes = tags.map(textNode);
  const calls = { click: 0, scroll: 0 };
  const row = {
    id,
    isConnected: connected,
    __style: { display, visibility },
    __calls: calls,
    getBoundingClientRect() {
      return { width, height };
    },
    querySelector(selector) {
      if (parseError) throw parseError;
      if (selector === '.name-text') return textNode(name);
      if (selector === '.snippet-text') return textNode(snippet);
      return null;
    },
    querySelectorAll(selector) {
      if (parseError) throw parseError;
      if (selector === '.list-tags-conv .conversation_tags_item') return tagNodes;
      if (selector === '[class*="list_tags_conv_"]') return identityClasses.map((className) => ({ className }));
      if (selector === 'img[src]') return avatarSources.map((src) => ({ getAttribute: () => src }));
      return [];
    },
    closest(selector) {
      return selector === '[id]' && id ? row : null;
    },
    scrollIntoView() {
      calls.scroll += 1;
    },
    click() {
      calls.click += 1;
    }
  };
  return row;
}

function fakeDocument(rows) {
  return {
    querySelectorAll(selector) {
      assert.ok(['.conversation-list-item.unread', '.conversation-list-item'].includes(selector));
      return rows;
    },
    getElementById(id) {
      return rows.find((row) => row.id === id) || null;
    },
    querySelector(selector) {
      if (!selector.startsWith('#')) return null;
      const id = selector.slice(1).replace(/\\(.)/g, '$1');
      return rows.find((row) => row.id === id) || null;
    }
  };
}

const domOptions = {
  getComputedStyle: (element) => element.__style
};

function tagButton({
  name,
  active = false,
  display = 'block',
  visibility = 'visible',
  opacity = '1',
  width = 120,
  height = 32
}) {
  return {
    textContent: name,
    __style: { display, visibility, opacity },
    getBoundingClientRect() {
      return { width, height };
    },
    querySelector(selector) {
      return selector === '.ellipse' && active ? {} : null;
    }
  };
}

function tagDocument(buttons) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, '#listShowTags .btn-tag-item, .btn-tag-item');
      return buttons;
    }
  };
}

test('maps connected unread rows and reports raw, usable, malformed and degraded state', () => {
  const rows = [
    conversationRow({
      id: 'conv-1',
      name: '  Alice   Example ',
      snippet: ' Xin  chao ',
      tags: [' New ', 'Priority']
    }),
    conversationRow({ id: 'conv-2', name: 'Bob', snippet: 'Need help' })
  ];

  const result = collectUnreadConversations(fakeDocument(rows), domOptions);

  assert.deepEqual(result, {
    rawCount: 2,
    items: [
      {
        index: 0,
        id: 'conv-1',
        name: 'Alice Example',
        snippet: 'Xin chao',
        tags: ['New', 'Priority'],
        hasTags: true
      },
      {
        index: 1,
        id: 'conv-2',
        name: 'Bob',
        snippet: 'Need help',
        tags: [],
        hasTags: false
      }
    ],
    malformedCount: 0,
    rejectedCounts: {},
    degraded: false
  });
});

test('skips rows hidden by Pancake while retaining them in raw unread count', () => {
  const hidden = conversationRow({ id: 'hidden-conv', display: 'none' });

  const result = collectUnreadConversations(fakeDocument([hidden]), domOptions);

  assert.equal(result.rawCount, 1);
  assert.deepEqual(result.items, []);
  assert.equal(result.malformedCount, 0);
  assert.equal(result.degraded, true);
});

test('isolates detached and malformed rows instead of failing the whole scan', () => {
  const valid = conversationRow({ id: 'valid', name: 'Still available' });
  const detached = conversationRow({ id: 'detached', connected: false });
  const malformed = conversationRow({ id: 'broken', parseError: new Error('bad row DOM') });

  const result = collectUnreadConversations(
    fakeDocument([detached, malformed, valid]),
    domOptions
  );

  assert.equal(result.rawCount, 2);
  assert.equal(result.malformedCount, 2);
  assert.deepEqual(result.items.map((item) => item.id), ['valid']);
  assert.equal(result.degraded, false);
});

test('a stale conversation id never falls back to or clicks the first unread row', async () => {
  const live = conversationRow({ id: 'live-conv', name: 'Do not click me' });
  const document = fakeDocument([live]);

  assert.equal(findConversationElementById(document, 'stale-conv'), null);
  const result = await clickConversationById(document, 'stale-conv');

  assert.deepEqual(result, { ok: false, code: 'STALE_CONVERSATION' });
  assert.equal(live.__calls.scroll, 0);
  assert.equal(live.__calls.click, 0);
});

test('reads nine id-less rows from tags or avatar paths without numeric conversion', () => {
  const rows = Array.from({ length: 8 }, (_, index) => conversationRow({
    identityClasses: ['list_tags_conv_100_' + (200 + index)],
    avatarSources: ['https://example.invalid/api/v1/pages/100/avatar/' + (200 + index) + '?size=32']
  }));
  rows.push(conversationRow({ avatarSources: ['/api/v1/pages/00100/avatar/90071992547409931234'] }));
  const result = collectUnreadConversations(fakeDocument(rows), domOptions);
  assert.equal(result.rawCount, 9);
  assert.equal(result.items.length, 9);
  assert.equal(result.degraded, false);
  assert.equal(result.items[0].id, 'pancake:100:200');
  assert.equal(result.items[8].id, 'pancake:00100:90071992547409931234');
});

test('rejects conflicts, missing identity and every duplicate while keeping page scope', () => {
  const rows = [
    conversationRow({ identityClasses: ['list_tags_conv_10_20'], avatarSources: ['/api/v1/pages/10/avatar/20'] }),
    conversationRow({ id: 'existing-conflict', identityClasses: ['list_tags_conv_10_21'], avatarSources: ['/api/v1/pages/10/avatar/99'] }),
    conversationRow({}),
    conversationRow({ identityClasses: ['list_tags_conv_10_20'] }),
    conversationRow({ identityClasses: ['list_tags_conv_11_20'] })
  ];
  const result = collectUnreadConversations(fakeDocument(rows), domOptions);
  assert.deepEqual(result.items.map((item) => item.id), ['pancake:11:20']);
  assert.deepEqual(result.rejectedCounts, { IDENTITY_CONFLICT: 1, MISSING_IDENTITY: 1, DUPLICATE_IDENTITY: 2 });
  assert.equal(result.malformedCount, 4);
});

test('synthetic key click survives reorder and fails closed after removal or duplication', async () => {
  const target = conversationRow({ identityClasses: ['list_tags_conv_10_20'] });
  const other = conversationRow({ identityClasses: ['list_tags_conv_11_20'] });
  const rows = [target, other];
  const document = fakeDocument(rows);
  const key = collectUnreadConversations(document, domOptions).items[0]?.id;
  rows.reverse();
  assert.equal((await clickConversationById(document, key)).ok, true);
  assert.equal(target.__calls.click, 1);
  assert.equal(other.__calls.click, 0);
  rows.push(conversationRow({ identityClasses: ['list_tags_conv_10_20'] }));
  assert.deepEqual(await clickConversationById(document, key), { ok: false, code: 'STALE_CONVERSATION' });
  rows.pop();
  target.isConnected = false;
  assert.deepEqual(await clickConversationById(document, key), { ok: false, code: 'STALE_CONVERSATION' });
});

test('revalidates identity and connection after scroll before clicking', async () => {
  const target = conversationRow({ id: 'target' });
  target.scrollIntoView = () => { target.isConnected = false; };
  assert.deepEqual(await clickConversationById(fakeDocument([target]), 'target'), { ok: false, code: 'STALE_CONVERSATION' });
  assert.equal(target.__calls.click, 0);
});

test('rejects multiple tag identities and duplicate DOM ids regardless of customer pair', async () => {
  const conflict = conversationRow({ identityClasses: ['list_tags_conv_1_2 list_tags_conv_1_3'] });
  const first = conversationRow({ id: 'shared', identityClasses: ['list_tags_conv_1_4'] });
  const second = conversationRow({ id: 'shared', identityClasses: ['list_tags_conv_1_5'] });
  const document = fakeDocument([conflict, first, second]);
  const result = collectUnreadConversations(document, domOptions);
  assert.equal(result.degraded, true);
  assert.deepEqual(result.rejectedCounts, { IDENTITY_CONFLICT: 1, DUPLICATE_IDENTITY: 2 });
  assert.deepEqual(await clickConversationById(document, 'shared'), { ok: false, code: 'STALE_CONVERSATION' });
  assert.deepEqual(await clickConversationById(document, ''), { ok: false, code: 'STALE_CONVERSATION' });
  assert.equal(first.__calls.click + second.__calls.click, 0);
});

test('ignores unrelated or malformed avatar URLs without inventing a key', () => {
  const rows = [
    conversationRow({ avatarSources: ['http://[', '/unrelated.png'] }),
    conversationRow({ id: 'legacy', avatarSources: ['http://['] })
  ];
  const result = collectUnreadConversations(fakeDocument(rows), domOptions);
  assert.deepEqual(result.items.map((item) => item.id), ['legacy']);
  assert.deepEqual(result.rejectedCounts, { MISSING_IDENTITY: 1 });
});

test('identity changes during scroll fail closed without clicking', async () => {
  const classes = ['list_tags_conv_1_2'];
  const target = conversationRow({ identityClasses: classes });
  target.scrollIntoView = () => { classes[0] = 'list_tags_conv_1_3'; };
  assert.deepEqual(await clickConversationById(fakeDocument([target]), 'pancake:1:2'), { ok: false, code: 'STALE_CONVERSATION' });
  assert.equal(target.__calls.click, 0);
});

test('stable DOM id does not override a changed canonical identity during scroll', async () => {
  const classes = ['list_tags_conv_1_2'];
  const target = conversationRow({ id: 'stable-dom-id', identityClasses: classes });
  target.scrollIntoView = () => { classes[0] = 'list_tags_conv_1_3'; };
  assert.deepEqual(await clickConversationById(fakeDocument([target]), 'stable-dom-id'), { ok: false, code: 'STALE_CONVERSATION' });
  assert.equal(target.__calls.click, 0);
});

test('malformed identity sharing a DOM id invalidates the valid row too', () => {
  const valid = conversationRow({ id: 'shared', identityClasses: ['list_tags_conv_1_2'] });
  const malformed = conversationRow({ id: 'shared', identityClasses: ['list_tags_conv_1_2 list_tags_conv_1_3'] });
  const result = collectUnreadConversations(fakeDocument([valid, malformed]), domOptions);
  assert.equal(result.items.length, 0);
  assert.equal(result.rejectedCounts.IDENTITY_CONFLICT, 1);
  assert.equal(result.rejectedCounts.DUPLICATE_IDENTITY, 1);
});

test('click rejects a row whose canonical identity changed after scan', async () => {
  const classes = ['list_tags_conv_1_10'];
  const target = conversationRow({ id: 'stable-dom-id', identityClasses: classes });
  const document = fakeDocument([target]);
  assert.equal(collectUnreadConversations(document, domOptions).items[0].id, 'stable-dom-id');
  classes[0] = 'list_tags_conv_1_20';
  assert.deepEqual(await clickConversationById(document, 'stable-dom-id'), { ok: false, code: 'STALE_CONVERSATION' });
  assert.equal(target.__calls.click, 0);
});

test('all detached unread rows report degraded instead of idle', () => {
  const result = collectUnreadConversations(fakeDocument([
    conversationRow({ id: 'detached-a', connected: false }),
    conversationRow({ id: 'detached-b', connected: false })
  ]), domOptions);
  assert.equal(result.rawCount, 0);
  assert.equal(result.malformedCount, 2);
  assert.equal(result.degraded, true);
});

test('click revalidates the exact id, scrolls and clicks once, and does not sleep in guest', async () => {
  const target = conversationRow({
    id: 'conv:target',
    name: 'Target customer',
    snippet: 'Latest message',
    tags: ['VIP']
  });
  const other = conversationRow({ id: 'other', name: 'Other customer' });
  const document = fakeDocument([other, target]);
  const originalSetTimeout = global.setTimeout;
  let timerCalls = 0;
  global.setTimeout = () => {
    timerCalls += 1;
    throw new Error('guest click must not schedule a sleep');
  };

  try {
    const result = await clickConversationById(document, 'conv:target');

    assert.deepEqual(result, {
      ok: true,
      info: {
        id: 'conv:target',
        name: 'Target customer',
        snippet: 'Latest message',
        tags: ['VIP'],
        hasTags: true
      }
    });
    assert.equal(target.__calls.scroll, 1);
    assert.equal(target.__calls.click, 1);
    assert.equal(other.__calls.click, 0);
    assert.equal(timerCalls, 0);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test('reads only visible active tag names marked with an ellipse', () => {
  const result = readActiveTagNames(tagDocument([
    tagButton({ name: '  Returning customer  ', active: true }),
    tagButton({ name: 'Translucent inactive', active: false, opacity: '0.5' }),
    tagButton({ name: 'Invisible active', active: true, visibility: 'hidden' })
  ]), domOptions);

  assert.deepEqual(result, ['Returning customer']);
});

test('returns an empty active-tag list for an empty rendered panel', () => {
  assert.deepEqual(readActiveTagNames(tagDocument([]), domOptions), []);
});

test('finds new Pancake mark unread button with Mail Unread group and M17.1591 path', () => {
  const mockPath = {
    getAttribute(name) {
      if (name === 'd') return 'M17.1591 7.47782C18.086 7.15023 18.75 6.26629 18.75 5.22724';
      return null;
    }
  };
  const mockGroup = {
    id: 'Mail Unread',
    closest(selector) {
      if (selector === '.conv-action-btn' || selector === 'div, button') return mockBtn;
      return null;
    }
  };
  const mockBtn = {
    className: 'conv-action-btn pancake-antd-tooltip',
    __style: { display: 'block', visibility: 'visible' },
    getBoundingClientRect() { return { width: 24, height: 24 }; },
    querySelector(selector) {
      if (selector.includes('Mail Unread')) return mockGroup;
      if (selector === 'path') return mockPath;
      return null;
    }
  };

  const doc = {
    querySelector(selector) {
      if (selector.includes('Mail Unread')) return mockGroup;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('conv-action-btn')) return [mockBtn];
      return [];
    }
  };

  const found = findMarkUnreadButton(doc, domOptions);
  assert.equal(found, mockBtn);
});

test('finds legacy mark unread button matching path d startsWith M14.5 7', () => {
  const mockPath = {
    getAttribute(name) {
      if (name === 'd') return 'M14.5 7H5.5C4.67 7 4 7.67 4 8.5V15.5';
      return null;
    }
  };
  const mockBtn = {
    className: 'conv-action-btn',
    __style: { display: 'block', visibility: 'visible' },
    getBoundingClientRect() { return { width: 24, height: 24 }; },
    querySelector(selector) {
      if (selector.includes('Mail Unread')) return null;
      if (selector === 'path') return mockPath;
      return null;
    }
  };

  const doc = {
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector.includes('conv-action-btn')) return [mockBtn];
      return [];
    }
  };

  const found = findMarkUnreadButton(doc, domOptions);
  assert.equal(found, mockBtn);
});

test('returns null if mark unread button is hidden or missing', () => {
  const mockPath = {
    getAttribute(name) {
      if (name === 'd') return 'M17.1591 7.47782';
      return null;
    }
  };
  const hiddenBtn = {
    className: 'conv-action-btn pancake-antd-tooltip',
    __style: { display: 'none', visibility: 'hidden' },
    getBoundingClientRect() { return { width: 0, height: 0 }; },
    querySelector(selector) {
      if (selector === 'path') return mockPath;
      return null;
    }
  };

  const doc = {
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector.includes('conv-action-btn')) return [hiddenBtn];
      return [];
    }
  };

  const found = findMarkUnreadButton(doc, domOptions);
  assert.equal(found, null);
});
