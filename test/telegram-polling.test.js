const test = require('node:test');
const assert = require('node:assert/strict');
const {
  handleTelegramCommand,
  handleTelegramCallbackQuery,
  notifyReviewCase,
  notifyComplaintAlert,
  notifySystemAlert,
  startTelegramPolling
} = require('../src/server/telegram');

test('telegram command: rejects unauthorized chat ID', async () => {
  const result = await handleTelegramCommand('/status', '999999999', {
    adminChatId: '123456789'
  });
  assert.equal(result.ok, false);
  assert.equal(result.unauthorized, true);
  assert.equal(result.replyText, undefined);
});

test('telegram command: /help and /start return command menu', async () => {
  const adminChatId = '123456789';
  for (const cmd of ['/help', '/start', '/help@MyPancakeBot']) {
    const result = await handleTelegramCommand(cmd, adminChatId, { adminChatId });
    assert.equal(result.ok, true);
    assert.match(result.replyText, /BẢNG ĐIỀU KHIỂN BOT PANCAKE/);
    assert.match(result.replyText, /\/status/);
    assert.match(result.replyText, /\/start_bot/);
    assert.match(result.replyText, /\/stop_bot/);
    assert.match(result.replyText, /\/autosend/);
    assert.match(result.replyText, /\/baocao/);
  }
});

test('telegram command: /status returns current system status', async () => {
  const adminChatId = '123456789';
  const settings = {
    botEnabled: true,
    autoSend: false,
    buyTtsEnabled: true,
    ttsProvider: 'api',
    defaultNewCustomerShortcut: '/1',
    newCustomerTagName: 'Saruto Mới',
    buyTagName: 'Mua hàng'
  };
  const result = await handleTelegramCommand('/status', adminChatId, {
    adminChatId,
    getSettings: async () => settings
  });
  assert.equal(result.ok, true);
  assert.match(result.replyText, /TRẠNG THÁI HỆ THỐNG BOT/);
  assert.match(result.replyText, /Đang BẬT/);
  assert.match(result.replyText, /Đang TẮT/i);
  assert.match(result.replyText, /Mua hàng/);
});

test('telegram command: /start_bot enables bot in settings', async () => {
  const adminChatId = '123456789';
  let saved = null;
  const result = await handleTelegramCommand('/start_bot', adminChatId, {
    adminChatId,
    saveSettings: async (patch) => { saved = patch; return patch; }
  });
  assert.equal(result.ok, true);
  assert.equal(saved?.botEnabled, true);
  assert.match(result.replyText, /Đã BẬT Bot/);
});

test('telegram command: /stop_bot disables bot in settings', async () => {
  const adminChatId = '123456789';
  let saved = null;
  const result = await handleTelegramCommand('/stop_bot', adminChatId, {
    adminChatId,
    saveSettings: async (patch) => { saved = patch; return patch; }
  });
  assert.equal(result.ok, true);
  assert.equal(saved?.botEnabled, false);
  assert.match(result.replyText, /Đã DỪNG Bot/);
});

test('telegram command: /autosend on and off updates settings', async () => {
  const adminChatId = '123456789';
  let saved = null;
  const onRes = await handleTelegramCommand('/autosend on', adminChatId, {
    adminChatId,
    saveSettings: async (patch) => { saved = patch; return patch; }
  });
  assert.equal(onRes.ok, true);
  assert.equal(saved?.autoSend, true);
  assert.match(onRes.replyText, /Đã BẬT chế độ Auto-Send/);

  const offRes = await handleTelegramCommand('/autosend off', adminChatId, {
    adminChatId,
    saveSettings: async (patch) => { saved = patch; return patch; }
  });
  assert.equal(offRes.ok, true);
  assert.equal(saved?.autoSend, false);
  assert.match(offRes.replyText, /Đã TẮT chế độ Auto-Send/);

  const noArg = await handleTelegramCommand('/autosend', adminChatId, { adminChatId });
  assert.equal(noArg.ok, true);
  assert.match(noArg.replyText, /Cú pháp/);
});

test('telegram command: /baocao aggregates logs and returns report', async () => {
  const adminChatId = '123456789';
  const now = new Date().toISOString();
  const logs = [
    { time: now, type: 'BOT', level: 'SUCCESS', message: 'Khách mới' },
    { time: now, type: 'BOT', level: 'SUCCESS', message: 'Khách mua hàng: Nguyễn Văn A' },
    { time: now, type: 'BOT', level: 'SUCCESS', message: 'Đã gửi /1' }
  ];
  const result = await handleTelegramCommand('/baocao', adminChatId, {
    adminChatId,
    getLogs: async () => logs
  });
  assert.equal(result.ok, true);
  assert.match(result.replyText, /Báo cáo cuối ngày/);
  assert.match(result.replyText, /Khách mới: <b>1<\/b>/);
  assert.match(result.replyText, /Đơn mua: <b>1<\/b>/);
  assert.match(result.replyText, /Shortcut đã gửi: <b>1<\/b>/);
});

test('telegram command: invalid command returns guidance', async () => {
  const adminChatId = '123456789';
  const result = await handleTelegramCommand('/something_unknown', adminChatId, { adminChatId });
  assert.equal(result.ok, false);
  assert.match(result.replyText, /Lệnh không hợp lệ/);
});

test('telegram callback_query: rejects unauthorized chat ID', async () => {
  let answered = null;
  const result = await handleTelegramCallbackQuery({
    id: 'cb_123',
    data: 'rv:done:item1',
    message: { chat: { id: 99999 } }
  }, {
    adminChatId: '123456789',
    answerCallback: async (id, text, alert) => { answered = { id, text, alert }; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.unauthorized, true);
  assert.equal(answered?.text, '⛔ Không có quyền thực hiện!');
});

test('telegram callback_query: handles rv:done:<id>', async () => {
  const adminChatId = '123456789';
  let markedDoneId = null;
  let answeredText = null;
  let editedMsg = null;

  const result = await handleTelegramCallbackQuery({
    id: 'cb_done',
    data: 'rv:done:case_01',
    message: { message_id: 111, chat: { id: adminChatId }, text: 'Ca chờ duyệt' }
  }, {
    adminChatId,
    markReviewItemDone: async (id) => { markedDoneId = id; return { id }; },
    answerCallback: async (_id, text) => { answeredText = text; },
    editMessage: async (msgId, text) => { editedMsg = { msgId, text }; }
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'done');
  assert.equal(markedDoneId, 'case_01');
  assert.match(answeredText, /Đã đánh dấu xử lý xong/);
  assert.match(editedMsg.text, /ĐÃ XỬ LÝ XONG - BỞI ADMIN/);
});

test('telegram callback_query: handles rv:del:<id>', async () => {
  const adminChatId = '123456789';
  let deletedId = null;
  let answeredText = null;
  let editedMsg = null;

  const result = await handleTelegramCallbackQuery({
    id: 'cb_del',
    data: 'rv:del:case_02',
    message: { message_id: 222, chat: { id: adminChatId }, text: 'Ca chờ duyệt' }
  }, {
    adminChatId,
    deleteReviewItem: async (id) => { deletedId = id; return { items: [] }; },
    answerCallback: async (_id, text) => { answeredText = text; },
    editMessage: async (msgId, text) => { editedMsg = { msgId, text }; }
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'delete');
  assert.equal(deletedId, 'case_02');
  assert.match(answeredText, /Đã xóa khỏi hàng đợi/);
  assert.match(editedMsg.text, /ĐÃ XÓA KHỎI HÀNG ĐỢI/);
});

test('telegram callback_query: handles rv:send:<id>:<shortcut>', async () => {
  const adminChatId = '123456789';
  let markedDoneId = null;
  let loggedEntry = null;
  let answeredText = null;
  let editedMsg = null;

  const result = await handleTelegramCallbackQuery({
    id: 'cb_send',
    data: 'rv:send:case_03:/4',
    message: { message_id: 333, chat: { id: adminChatId }, text: 'Ca chờ duyệt' }
  }, {
    adminChatId,
    markReviewItemDone: async (id) => { markedDoneId = id; return { id }; },
    appendLog: async (entry) => { loggedEntry = entry; },
    answerCallback: async (_id, text) => { answeredText = text; },
    editMessage: async (msgId, text) => { editedMsg = { msgId, text }; }
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'send');
  assert.equal(result.shortcut, '/4');
  assert.equal(markedDoneId, 'case_03');
  assert.equal(loggedEntry?.type, 'REVIEW_QUEUE');
  assert.match(loggedEntry?.message, /duyệt gửi shortcut \/4/);
  assert.match(answeredText, /Đã duyệt gửi \/4/);
  assert.match(editedMsg.text, /ĐÃ DUYỆT GỬI \/4 BỞI ADMIN/);
});

test('telegram notifications: review, complaint, system alert functions are safe without config', async () => {
  assert.doesNotThrow(async () => {
    await notifyReviewCase({
      id: 'rev1',
      customerName: 'Nguyễn Văn A',
      customerMessage: 'Tư vấn giúp em',
      suggestedShortcut: '/4'
    });
    await notifyComplaintAlert({
      customerName: 'Trần Thị B',
      customerMessage: 'Shop làm ăn lừa đảo à?',
      reason: 'Phát hiện từ khóa lừa đảo'
    });
    await notifySystemAlert({
      type: 'DOM_HEALTH_FAIL',
      message: 'Không tìm thấy ô reply',
      tabId: 'bot1'
    });
  });
});

test('startTelegramPolling: stops gracefully when invoked', () => {
  const stop = startTelegramPolling();
  assert.equal(typeof stop, 'function');
  assert.doesNotThrow(() => stop());
});
