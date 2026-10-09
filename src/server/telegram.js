const https = require('https');

function isConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

// Send a message to the configured Telegram chat. No-op (resolves false) when
// token/chat id are missing, so the app runs fine without Telegram set up.
// Never throws: notification failure must not break the calling flow.
function sendTelegram(text, options = {}) {
  return new Promise((resolve) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return resolve(false);

    const payloadObj = {
      chat_id: chatId,
      text: String(text == null ? '' : text),
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    if (options && options.reply_markup) {
      payloadObj.reply_markup = options.reply_markup;
    }

    const payload = JSON.stringify(payloadObj);

    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 10000
      },
      (res) => {
        res.resume(); // drain
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(payload);
    req.end();
  });
}

function editTelegramMessage(messageId, text, options = {}) {
  return new Promise((resolve) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId || !messageId) return resolve(false);

    const payloadObj = {
      chat_id: chatId,
      message_id: messageId,
      text: String(text == null ? '' : text),
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    if (options && options.reply_markup) {
      payloadObj.reply_markup = options.reply_markup;
    }

    const payload = JSON.stringify(payloadObj);

    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/editMessageText`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 10000
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(payload);
    req.end();
  });
}

function answerTelegramCallback(callbackQueryId, text, showAlert = false) {
  return new Promise((resolve) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !callbackQueryId) return resolve(false);

    const payload = JSON.stringify({
      callback_query_id: callbackQueryId,
      text: String(text || ''),
      show_alert: Boolean(showAlert)
    });

    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/answerCallbackQuery`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 10000
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(payload);
    req.end();
  });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function notifyServerUp(port) {
  return sendTelegram(`🟢 <b>Bot đã BẬT</b>\nServer chạy tại http://localhost:${escapeHtml(port)}`);
}

function notifyServerDown() {
  return sendTelegram('🔴 <b>Bot đã TẮT</b>\nServer đã dừng.');
}

function notifyError(context, message) {
  return sendTelegram(`⚠️ <b>Lỗi server</b>\n${escapeHtml(context)}: ${escapeHtml(message)}`);
}

function notifyBuyCustomer({ customerName, phone, address, message, addressLookup }) {
  const lines = [
    '🛒 <b>Khách MUA HÀNG</b>',
    `👤 ${escapeHtml(customerName || 'Khách')}`,
    phone ? `📞 ${escapeHtml(phone)}` : '',
    address ? `📍 ${escapeHtml(address)}` : '',
    addressLookup?.googleMapsUrl ? `🔎 Google Maps: ${escapeHtml(addressLookup.googleMapsUrl)}` : '',
    addressLookup?.confidence ? `⚠️ Độ chắc chắn: ${escapeHtml(addressLookup.confidence)}` : '',
    message ? `💬 ${escapeHtml(message)}` : ''
  ].filter(Boolean);
  return sendTelegram(lines.join('\n'));
}

function notifyReviewCase(item = {}) {
  const name = escapeHtml(item.customerName || 'Khách');
  const rawMsg = String(item.customerMessage || '');
  const msg = escapeHtml(rawMsg.length > 200 ? rawMsg.slice(0, 200) + '…' : rawMsg);
  const reason = escapeHtml(item.reason || 'Bot không tự tin / cần admin duyệt');
  const suggested = item.suggestedShortcut || item.analysis?.shortcut || item.analysis?.recommendedShortcut;

  const lines = [
    '⏳ <b>[CA CHỜ DUYỆT]</b>',
    `👤 <b>Khách hàng:</b> ${name}`,
    msg ? `💬 <b>Tin nhắn:</b> ${msg}` : '',
    `⚠️ <b>Lý do:</b> ${reason}`,
    suggested ? `💡 <b>Đề xuất:</b> <code>${escapeHtml(suggested)}</code>` : '',
    item.pancakeUrl ? `🔗 <a href="${escapeHtml(item.pancakeUrl)}">Mở cuộc trò chuyện Pancake</a>` : ''
  ].filter(Boolean);

  const inline_keyboard = [];
  const row1 = [];
  if (suggested && item.id) {
    row1.push({ text: `✅ Gửi ${suggested}`, callback_data: `rv:send:${item.id}:${suggested}` });
  }
  if (item.id) {
    row1.push({ text: '⏩ Đã xử lý', callback_data: `rv:done:${item.id}` });
  }
  if (row1.length) inline_keyboard.push(row1);

  const row2 = [];
  if (item.id) {
    row2.push({ text: '🗑️ Xóa', callback_data: `rv:del:${item.id}` });
  }
  if (item.pancakeUrl && /^https?:\/\//.test(item.pancakeUrl)) {
    row2.push({ text: '🔗 Mở Pancake', url: item.pancakeUrl });
  }
  if (row2.length) inline_keyboard.push(row2);

  return sendTelegram(lines.join('\n'), {
    reply_markup: inline_keyboard.length ? { inline_keyboard } : undefined
  });
}

function notifyComplaintAlert({ customerName, customerMessage, conversationId, pancakeUrl, reason } = {}) {
  const name = escapeHtml(customerName || 'Khách');
  const rawMsg = String(customerMessage || '');
  const msg = escapeHtml(rawMsg.length > 300 ? rawMsg.slice(0, 300) + '…' : rawMsg);
  const lines = [
    '🚨 <b>CẢNH BÁO RỦI RO CAO: KHÁCH KHIẾU NẠI / BỨC XÚC</b>',
    `👤 <b>Khách hàng:</b> ${name}`,
    msg ? `💬 <b>Tin nhắn:</b> ${msg}` : '',
    reason ? `⚠️ <b>Đánh giá:</b> ${escapeHtml(reason)}` : '⚠️ <b>Đánh giá:</b> Tin nhắn có dấu hiệu khiếu nại, dọa phốt hoặc hoàn tiền!',
    '👉 <i>Bot đã tạm dừng tự động trả lời khách này để tránh gây bức xúc thêm.</i>',
    pancakeUrl ? `🔗 <a href="${escapeHtml(pancakeUrl)}">Mở cuộc trò chuyện Pancake</a>` : ''
  ].filter(Boolean);

  const inline_keyboard = [];
  if (pancakeUrl && /^https?:\/\//.test(pancakeUrl)) {
    inline_keyboard.push([{ text: '🔗 Mở ngay trên Pancake', url: pancakeUrl }]);
  }

  return sendTelegram(lines.join('\n'), {
    reply_markup: inline_keyboard.length ? { inline_keyboard } : undefined
  });
}

function notifySystemAlert({ type, message, details, tabId } = {}) {
  const lines = [
    '⚠️ <b>CẢNH BÁO SỰ CỐ HỆ THỐNG PANCAKE</b>',
    type ? `📌 <b>Vấn đề:</b> ${escapeHtml(type)}` : '',
    tabId ? `💻 <b>Tab:</b> ${escapeHtml(tabId)}` : '',
    message ? `🔍 <b>Chi tiết:</b> ${escapeHtml(message)}` : '',
    details ? `📝 <code>${escapeHtml(typeof details === 'object' ? JSON.stringify(details) : details)}</code>` : '',
    '🛠️ <i>Vui lòng kiểm tra lại màn hình máy tính / Pancake để xử lý.</i>'
  ].filter(Boolean);

  return sendTelegram(lines.join('\n'));
}

// Build end-of-day counts from the log entries (see store.appendLog shape).
// Pure function: filters to `dateStr` (local YYYY-MM-DD) and matches the log
// messages emitted by the bot loop. `now` is injectable for testing.
function buildDailyStats(logs, now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;

  const sameLocalDay = (iso) => {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return false;
    const ly = t.getFullYear();
    const lm = String(t.getMonth() + 1).padStart(2, '0');
    const ld = String(t.getDate()).padStart(2, '0');
    return `${ly}-${lm}-${ld}` === dateStr;
  };

  const today = (Array.isArray(logs) ? logs : []).filter((x) => x && sameLocalDay(x.time));

  const stats = { dateStr, newCustomers: 0, buyOrders: 0, reviewCases: 0, errors: 0, shortcutsSent: 0 };
  for (const log of today) {
    const type = log.type || '';
    const level = log.level || '';
    const msg = String(log.message || '');
    if (level === 'ERROR') stats.errors++;
    if (type === 'BOT' && msg.startsWith('Khách mới')) stats.newCustomers++;
    if (type === 'BOT' && msg.startsWith('Khách mua hàng')) stats.buyOrders++;
    if (type === 'BOT' && /^Đã gửi \/\d+/.test(msg)) stats.shortcutsSent++;
    if (type === 'REVIEW_QUEUE' && msg.startsWith('Thêm ca')) stats.reviewCases++;
  }
  return stats;
}

function formatDailyReport(stats) {
  return [
    `📊 <b>Báo cáo cuối ngày ${escapeHtml(stats.dateStr)}</b>`,
    `🆕 Khách mới: <b>${stats.newCustomers}</b>`,
    `🛒 Đơn mua: <b>${stats.buyOrders}</b>`,
    `📨 Shortcut đã gửi: <b>${stats.shortcutsSent}</b>`,
    `⏳ Ca chờ duyệt: <b>${stats.reviewCases}</b>`,
    `⚠️ Lỗi: <b>${stats.errors}</b>`
  ].join('\n');
}

// Schedule the daily report at REPORT_HOUR:REPORT_MIN local time. Re-arms
// itself after each fire. Returns a cancel function. `getLogs` is async.
const REPORT_HOUR = 23;
const REPORT_MIN = 30;

function msUntilNextReport(now = new Date()) {
  const next = new Date(now);
  next.setHours(REPORT_HOUR, REPORT_MIN, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function scheduleDailyReport(getLogs) {
  if (!isConfigured()) return () => {};
  let timer = null;
  const arm = () => {
    timer = setTimeout(async () => {
      try {
        const logs = await getLogs();
        await sendTelegram(formatDailyReport(buildDailyStats(logs)));
      } catch (_) { /* report is best-effort */ }
      arm();
    }, msUntilNextReport());
    if (timer.unref) timer.unref();
  };
  arm();
  return () => { if (timer) clearTimeout(timer); };
}

async function handleTelegramCommand(text, fromChatId, dependencies = {}) {
  const adminChatId = String(dependencies.adminChatId || process.env.TELEGRAM_CHAT_ID || '').trim();
  const incomingChatId = String(fromChatId || '').trim();

  // Security gate: only accept commands from authorized admin chat ID
  if (!adminChatId || incomingChatId !== adminChatId) {
    return { ok: false, unauthorized: true };
  }

  const {
    getSettings = async () => ({}),
    saveSettings = async () => ({}),
    getLogs = async () => []
  } = dependencies;

  const rawCmd = String(text || '').trim();
  const parts = rawCmd.split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase().replace(/@\w+$/, '');
  const arg = (parts[1] || '').toLowerCase();

  if (cmd === '/start' || cmd === '/help') {
    const helpText = [
      '🤖 <b>BẢNG ĐIỀU KHIỂN BOT PANCAKE</b>',
      '',
      '📌 <b>Các lệnh quản trị từ xa:</b>',
      '• <code>/status</code> : Xem trạng thái Bot & Cài đặt',
      '• <code>/start_bot</code> : Bật Bot chạy tự động',
      '• <code>/stop_bot</code> : Tắt/Dừng Bot',
      '• <code>/autosend on</code> : Bật chế độ tự động gửi tin',
      '• <code>/autosend off</code> : Tắt chế độ tự động gửi tin',
      '• <code>/baocao</code> : Xem báo cáo thống kê hôm nay',
      '• <code>/help</code> : Xem hướng dẫn này'
    ].join('\n');
    return { ok: true, replyText: helpText };
  }

  if (cmd === '/status') {
    const settings = await getSettings();
    const botState = settings.botEnabled ? '🟢 Đang BẬT' : '🔴 Đang TẮT';
    const autoSendState = settings.autoSend ? '⚡ Đang BẬT' : '✋ Đang TẮT (chỉ điền)';
    const ttsState = settings.buyTtsEnabled !== false ? `🔊 Bật (${settings.ttsProvider || 'api'})` : '🔇 Tắt';
    const statusText = [
      '📊 <b>TRẠNG THÁI HỆ THỐNG BOT</b>',
      '',
      `• <b>Bot:</b> ${botState}`,
      `• <b>Tự động gửi (Auto-Send):</b> ${autoSendState}`,
      `• <b>Thông báo TTS:</b> ${ttsState}`,
      `• <b>Shortcut mặc định:</b> <code>${escapeHtml(settings.defaultNewCustomerShortcut || '/1')}</code>`,
      `• <b>Tag khách mới:</b> <code>${escapeHtml(settings.newCustomerTagName || 'Saruto Mới')}</code>`,
      `• <b>Tag mua hàng:</b> <code>${escapeHtml(settings.buyTagName || 'Mua hàng')}</code>`
    ].join('\n');
    return { ok: true, replyText: statusText };
  }

  if (cmd === '/start_bot') {
    await saveSettings({ botEnabled: true });
    return {
      ok: true,
      replyText: '🟢 <b>Đã BẬT Bot thành công!</b>\nBot sẽ tự động quét và trả lời khách hàng trên Pancake.'
    };
  }

  if (cmd === '/stop_bot') {
    await saveSettings({ botEnabled: false });
    return {
      ok: true,
      replyText: '🔴 <b>Đã DỪNG Bot thành công!</b>\nBot đã tạm ngừng quét và trả lời khách hàng.'
    };
  }

  if (cmd === '/autosend') {
    if (arg === 'on') {
      await saveSettings({ autoSend: true });
      return { ok: true, replyText: '⚡ <b>Đã BẬT chế độ Auto-Send!</b>\nBot sẽ tự động bấm gửi shortcut cho khách khi AI tự tin.' };
    }
    if (arg === 'off') {
      await saveSettings({ autoSend: false });
      return { ok: true, replyText: '✋ <b>Đã TẮT chế độ Auto-Send!</b>\nBot sẽ chỉ điền shortcut vào ô chat, không tự động gửi.' };
    }
    return {
      ok: true,
      replyText: 'ℹ️ Cú pháp: <code>/autosend on</code> hoặc <code>/autosend off</code>'
    };
  }

  if (cmd === '/baocao') {
    const logs = await getLogs();
    const stats = buildDailyStats(logs);
    const reportText = formatDailyReport(stats);
    return { ok: true, replyText: reportText };
  }

  return {
    ok: false,
    replyText: `❓ Lệnh không hợp lệ: <code>${escapeHtml(rawCmd)}</code>\nGõ <code>/help</code> để xem danh sách các lệnh khả dụng.`
  };
}

async function handleTelegramCallbackQuery(callbackQuery, dependencies = {}) {
  const adminChatId = String(dependencies.adminChatId || process.env.TELEGRAM_CHAT_ID || '').trim();
  const incomingChatId = String(callbackQuery?.message?.chat?.id || '').trim();
  const queryId = callbackQuery?.id;

  if (!adminChatId || incomingChatId !== adminChatId) {
    if (queryId) {
      const answerFn = dependencies.answerCallback || answerTelegramCallback;
      await answerFn(queryId, '⛔ Không có quyền thực hiện!', true);
    }
    return { ok: false, unauthorized: true };
  }

  const data = String(callbackQuery?.data || '').trim();
  const messageId = callbackQuery?.message?.message_id;
  const originalText = callbackQuery?.message?.text || '';

  const {
    markReviewItemDone = async () => ({}),
    deleteReviewItem = async () => ({}),
    appendLog = async () => ({}),
    answerCallback = answerTelegramCallback,
    editMessage = editTelegramMessage
  } = dependencies;

  // Pattern: rv:done:<id>
  if (data.startsWith('rv:done:')) {
    const id = data.slice('rv:done:'.length);
    await markReviewItemDone(id);
    await appendLog({
      level: 'INFO',
      type: 'REVIEW_QUEUE',
      message: `Admin duyệt xử lý xong ca qua Telegram: ${id}`,
      data: { id, approvedBy: 'telegram_admin' }
    });
    await answerCallback(queryId, '✅ Đã đánh dấu xử lý xong!');
    if (messageId) {
      const nowStr = new Date().toLocaleTimeString();
      const updatedText = `✅ <b>[ĐÃ XỬ LÝ XONG - BỞI ADMIN LÚC ${nowStr}]</b>\n\n${escapeHtml(originalText)}`;
      await editMessage(messageId, updatedText);
    }
    return { ok: true, action: 'done', id };
  }

  // Pattern: rv:del:<id>
  if (data.startsWith('rv:del:')) {
    const id = data.slice('rv:del:'.length);
    await deleteReviewItem(id);
    await appendLog({
      level: 'INFO',
      type: 'REVIEW_QUEUE',
      message: `Admin xóa ca khỏi hàng đợi qua Telegram: ${id}`,
      data: { id, approvedBy: 'telegram_admin' }
    });
    await answerCallback(queryId, '🗑️ Đã xóa khỏi hàng đợi!');
    if (messageId) {
      const nowStr = new Date().toLocaleTimeString();
      const updatedText = `🗑️ <b>[ĐÃ XÓA KHỎI HÀNG ĐỢI LÚC ${nowStr}]</b>\n\n${escapeHtml(originalText)}`;
      await editMessage(messageId, updatedText);
    }
    return { ok: true, action: 'delete', id };
  }

  // Pattern: rv:send:<id>:<shortcut>
  if (data.startsWith('rv:send:')) {
    const parts = data.split(':');
    const id = parts[2];
    const shortcut = parts.slice(3).join(':');
    await markReviewItemDone(id);
    await appendLog({
      level: 'SUCCESS',
      type: 'REVIEW_QUEUE',
      message: `Admin duyệt gửi shortcut ${shortcut} qua Telegram: ${id}`,
      data: { id, shortcut, approvedBy: 'telegram_admin' }
    });
    await answerCallback(queryId, `✅ Đã duyệt gửi ${shortcut}!`);
    if (messageId) {
      const nowStr = new Date().toLocaleTimeString();
      const updatedText = `✅ <b>[ĐÃ DUYỆT GỬI ${escapeHtml(shortcut)} BỞI ADMIN LÚC ${nowStr}]</b>\n\n${escapeHtml(originalText)}`;
      await editMessage(messageId, updatedText);
    }
    return { ok: true, action: 'send', id, shortcut };
  }

  if (queryId) {
    await answerCallback(queryId, '❓ Lệnh không xác định');
  }
  return { ok: false, message: 'Unknown callback data' };
}

function startTelegramPolling(dependencies = {}) {
  if (!isConfigured()) return () => {};
  const token = process.env.TELEGRAM_BOT_TOKEN;
  let running = true;
  let offset = 0;
  let activeRequest = null;

  async function pollLoop() {
    while (running) {
      try {
        const updates = await new Promise((resolve) => {
          const path = `/bot${token}/getUpdates?offset=${offset}&timeout=15`;
          activeRequest = https.request(
            {
              hostname: 'api.telegram.org',
              path,
              method: 'GET',
              timeout: 25000
            },
            (res) => {
              let body = '';
              res.on('data', (chunk) => { body += chunk; });
              res.on('end', () => {
                try {
                  const data = JSON.parse(body);
                  resolve(data?.ok && Array.isArray(data?.result) ? data.result : []);
                } catch (_) {
                  resolve([]);
                }
              });
            }
          );
          activeRequest.on('error', () => resolve([]));
          activeRequest.on('timeout', () => {
            activeRequest.destroy();
            resolve([]);
          });
          activeRequest.end();
        });

        if (!running) break;

        for (const update of updates) {
          if (update.update_id >= offset) {
            offset = update.update_id + 1;
          }
          if (update.callback_query) {
            await handleTelegramCallbackQuery(update.callback_query, dependencies);
            continue;
          }
          const msg = update.message;
          if (!msg || !msg.text) continue;
          const fromChatId = String(msg.chat?.id || '');
          const result = await handleTelegramCommand(msg.text, fromChatId, dependencies);
          if (result?.replyText) {
            await sendTelegram(result.replyText);
          }
        }
      } catch (_) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  pollLoop();

  return () => {
    running = false;
    if (activeRequest) {
      try { activeRequest.destroy(); } catch (_) {}
    }
  };
}

module.exports = {
  isConfigured,
  sendTelegram,
  editTelegramMessage,
  answerTelegramCallback,
  notifyServerUp,
  notifyServerDown,
  notifyError,
  notifyBuyCustomer,
  notifyReviewCase,
  notifyComplaintAlert,
  notifySystemAlert,
  buildDailyStats,
  formatDailyReport,
  msUntilNextReport,
  scheduleDailyReport,
  handleTelegramCommand,
  handleTelegramCallbackQuery,
  startTelegramPolling
};
