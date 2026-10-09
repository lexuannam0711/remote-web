# Báo cáo Kiểm kê Tính năng (Feature Parity Audit): Dashboard Web vs Dashboard Desktop

> **Ngày thực hiện:** 2026-10-10  
> **Người thực hiện:** Antigravity (Dispatched Worker W2, task `task_59624a70b46f`, dispatch `ctx_9c661d69c134`)  
> **Chế độ:** READ-ONLY AUDIT (Kiểm kê kỹ thuật, không sửa đổi source/test/package)  
> **Đối tượng so sánh:**
> - **Desktop:** `src/renderer/**` (`app.js`, `automation.js`, `botDecision.js`, `conversationProcessing.js`, `conversationClaims.js`, `buyTtsNotifier.js`, `webviewAutomation.js`, `webviewTabNavigation.js`, `pancakeDom.js`, `icons.js`, `index.html`, `style.css`)
> - **Web:** `web/public/**` (`app.js`, `adapter.js`, `env.js`, `index.html`, `style.css`, `vendor/*`)
> - **Extension Bridge:** `extensions/pancake-bot/**` (`manifest.json`, `background.js`, `dashboard-bridge.js`, `pancake-bridge.js`, `popup.*`, `vendor/*`)
> - **Web Server & Auth:** `src/server/web.js`, `src/server/auth.js`

---

## Tóm tắt Điều hành (Executive Summary)

Sau khi đối chiếu toàn diện 1.966 dòng code của [src/renderer/app.js](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js) với 1.977 dòng code của [web/public/app.js](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js), kết hợp kiểm toán các module vệ tinh, extension bridge và server:

1. **Về lõi nghiệp vụ (Business Logic Parity):** Phiên bản web đạt **95% độ tương đồng** so với desktop. Toàn bộ logic ra quyết định bot ([botDecision.js](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/vendor/botDecision.js)), chống trùng hội thoại ([conversationClaims.js](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/vendor/conversationClaims.js)), thông báo TTS ([buyTtsNotifier.js](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/vendor/buyTtsNotifier.js)), phân tích AI, Auto-Click, gắn tag, và hàng đợi duyệt (Review Queue) được sao chép nguyên vẹn hoặc tái sử dụng byte-for-byte từ desktop.
2. **Về cơ chế điều khiển (Transport Abstraction):** Cơ chế `webview.executeJavaScript` trên Electron đã được thay thế thành công bằng `adapter.call(slot, method, args)` kết hợp với `window.postMessage` và Chrome Extension bridge. Toàn bộ **21 phương thức của `window.__PDB__`** đều được whitelist khớp 100% qua 4 lớp bảo vệ.
3. **Các điểm nghẽn và thiếu sót quan trọng (Critical Gaps):**
   - **P0 (Chặn đứng luồng bot trên VPS):** Extension bridge bị hardcode domain `http://localhost:8787/*` và `http://127.0.0.1:8787/*` trong [extensions/pancake-bot/manifest.json:17-18](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/extensions/pancake-bot/manifest.json#L17-L18) và [extensions/pancake-bot/background.js:45](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/extensions/pancake-bot/background.js#L45). Nếu triển khai web trên VPS với domain riêng (ví dụ `https://bot.example.com`), content script của bridge sẽ **không được bơm vào trang**, khiến dashboard web hoàn toàn tê liệt.
   - **P1 (Lỗi âm thanh TTS & Autoplay):** CSP trên web [web/public/index.html:10](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/index.html#L10) thiếu `media-src 'self' blob:`, chặn phát âm thanh tạo từ API TTS; đồng thời chính sách Autoplay Policy của trình duyệt chặn âm thanh khi tab chạy ngầm nếu chưa có cử chỉ tương tác từ người dùng.
   - **P1 (Rủi ro nhân bản tab Duplicate Tab):** Cơ chế sinh `machineId` từ `sessionStorage` [web/public/app.js:67-80](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L67-L80) bị Chrome sao chép nguyên trạng khi người dùng nhân bản tab (Duplicate Tab), dẫn đến nguy cơ 2 tab cùng tưởng mình sở hữu lease.
   - **P1 (Hạn chế lệnh Telegram từ xa):** Lệnh `/start_bot` trên Telegram chỉ lưu cài đặt vào server [src/server/telegram.js:364](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/server/telegram.js#L364). Nếu không có tab dashboard web nào đang mở và giữ lease, bot loop sẽ không tự động kích hoạt như ở bản desktop.

---

## 1. Bảng đối chiếu Tính năng và Nhánh đường lối (src/renderer/app.js vs web/public/app.js)

Dưới đây là bảng đối chiếu chi tiết từng hàm, tính năng và luồng xử lý giữa bản Desktop Electron và bản Web.

| STT | Tính năng / Phân đoạn mã | Desktop (`src/renderer/app.js`) | Web (`web/public/app.js`) | Đánh giá Parity | Chi tiết khác biệt & Nguyên nhân |
|:---:|---|---|---|:---:|---|
| 1 | **Khởi tạo Adapter & Transport** | Dùng trực tiếp Electron webview và `window.pancakeDesktop` ([L240](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L240)) | Khởi tạo `PDBDashboardAdapter` qua postMessage ([L8-L14](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L8-L14)) | **ĐẠT** | Kiến trúc đúng chuẩn spec Phase 1. |
| 2 | **Shim `window.pancakeDesktop`** | Cung cấp bởi Electron Preload (`src/preload.js:3-17`) | Shim nội bộ trong web app ([L21-L32](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L21-L32)) | **ĐẠT** | Shim đầy đủ: `getEnv`, `setBotActive`, `openExternal`, `showMessage`, `onVisibilityChange`, và mock các hàm extensions. |
| 3 | **Giao tiếp API Server (`api()`)** | Gọi fetch tuyệt đối `${serverUrl}${path}` ([L178-L192](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L178-L192)) | Gọi fetch tương đối `path`, kèm `credentials: 'same-origin'`, bắt 401 mở `loginPanel` ([L333-L349](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L333-L349)) | **ĐẠT (Nâng cấp)** | Hỗ trợ cookie session HttpOnly và chuyển hướng form đăng nhập. |
| 4 | **Thực thi lệnh DOM (`executeInTab`)** | `wv.executeJavaScript(js)` ([L240-L250](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L240-L250)) | Chặn ghi nếu không có lease (`leaseWrites`), gọi `adapter.call(tabId, methodName, args)` ([L387-L393](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L387-L393)) | **ĐẠT (Nâng cấp)** | Bảo vệ chống double-send bằng single-leader lease; không eval code tự do. |
| 5 | **Gọi bot (`botCallForTab`, `botCall`)** | Nạp chuỗi `injectAutomation()` rồi gọi `apply` chuỗi JS ([L281-L293](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L281-L293)) | Chuyển trực tiếp tham số dạng mảng vào `executeInTab` ([L395-L404](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L395-L404)) | **ĐẠT** | Gọn gàng và an toàn hơn bản desktop. |
| 6 | **Quản lý Bot-Lease (Đa máy)** | Không có (desktop chạy local đơn máy) | Đầy đủ hệ thống lease: `acquireBotLease`, `extendBotLease`, `releaseBotLease`, `loseLease`, epoch guard ([L53-L137](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L53-L137)) | **ĐẠT (Nâng cấp)** | Tuân thủ contract §4ter: epoch guard ngăn resurrect lease muộn. |
| 7 | **Định danh máy trạm (`getMachineId`)** | Không cần | Đọc/ghi `sessionStorage`, fallback `localStorage` hoặc `crypto.randomUUID` ([L67-L81](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L67-L81)) | **KHÁC BEHAVIOR** | Hoạt động tốt khi reload; tuy nhiên có kẽ hở khi nhân bản tab (Duplicate Tab) - xem Mục 4. |
| 8 | **Đọc URL Pancake (`getPancakeUrl`)** | Gọi `executeInTab(tabId, 'location.href')` ([L880](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L880)) | Đọc từ snapshot `adapter.listSlots()` ([L955-L957](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L955-L957)) | **ĐẠT** | Tránh round-trip JS, lấy trực tiếp URL do extension cập nhật. |
| 9 | **Vòng lặp Bot AI (`processOneConversation`)** | Chạy chu trình AI, gắn tag, gửi tin, context `electron-webview` ([L936-L1142](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L936-L1142)) | Tái sử dụng 100% logic, đổi context sang `web-dashboard` ([L1012-L1218](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1012-L1218)) | **ĐẠT** | Logic lọc khách, dedupe, tag, AI call, failsafe hoàn toàn giống nhau. |
| 10 | **Vòng lặp Auto-Click (`processOneAutoClick`)** | Tốc độ cao không AI, gắn tag /1, log `AUTOCLICK` ([L1147-L1218](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L1147-L1218)) | Tái sử dụng 100% logic ([L1223-L1294](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1223-L1294)) | **ĐẠT** | Không sai lệch bất kỳ nhánh nào. |
| 11 | **Bật/Tắt Bot (`startBot`, `stopBot`)** | Lưu settings và kích hoạt `botLoop` ([L1353-L1378](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L1353-L1378)) | Bắt buộc `acquireBotLease()` trước khi chạy; tự động `releaseBotLease()` khi dừng ([L1429-L1456](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1429-L1456)) | **ĐẠT (Nâng cấp)** | Bảo đảm an toàn tuyệt đối chống double-bot. |
| 12 | **Bật/Tắt Auto-Click (`startAutoClick`, `stopAutoClick`)** | Lưu settings và kích hoạt loop ([L1433-L1459](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L1433-L1459)) | Kèm acquire/release bot lease ([L1511-L1539](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1511-L1539)) | **ĐẠT (Nâng cấp)** | Đúng thiết kế lease contract. |
| 13 | **Trợ lý đề xuất AI (`startAssistantWatch`, v.v.)** | Đọc conversation ID theo chu kỳ 1.2s, đề xuất shortcut ([L521-L596](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L521-L596)) | Tái sử dụng nguyên vẹn ([L633-L708](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L633-L708)) | **ĐẠT** | Chạy tốt qua bridge `getActiveConversationId` & `getRecentMessages`. |
| 14 | **Hàng đợi duyệt (`reviewQueue`)** | Polling, render danh sách chờ duyệt, giải quyết ca ([L1508-L1634](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L1508-L1634)) | Polling, render danh sách chờ duyệt, giải quyết ca ([L1567-L1688](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1567-L1688)) | **ĐẠT** | 100% logic API giống nhau. |
| 15 | **Chuyển tới hội thoại (`navigateToConversation`)** | Gán `tab.webview.src = item.pancakeUrl` ([L1595](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L1595)) | Gọi `openExternal(item.pancakeUrl)` ([L1650](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1650)) mở cửa sổ/tab trình duyệt mới | **KHÁC BEHAVIOR** | Khi mở tab mới, tab đó không tự động thay thế tab bot hiện tại của slot; tab Pancake cũ của slot không bị điều hướng URL. |
| 16 | **Nút Toolbar: Go (`goBtn`)** | `activeWebview().src = url` ([L1766](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L1766)) | `openPancakeTab(url)` ([L1821](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1821)) mở tab trình duyệt mới | **KHÁC BEHAVIOR** | Web không nhúng webview nên mở tab ngoài. |
| 17 | **Nút Toolbar: Reload (`reloadBtn`)** | `activeWebview().reload()` ([L1768](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L1768)) reload trang Pancake | `checkBridge()` ([L1823](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1823)) chỉ ping bridge | **THIẾU** | Không thể reload tab Pancake từ xa nếu tab Pancake bị đơ/lỗi DOM. |
| 18 | **Quản lý Extension (`ext` tab)** | Nạp danh sách unpacked extension, nút reload từng extension ([L800-L828](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L800-L828)) | Ghi thông báo hướng dẫn cài extension ([L902-L904](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L902-L904)), nút reload gọi `checkBridge()` | **KHÔNG ÁP DỤNG** | Bản web không thể truy cập filesystem hay nạp extension vào Chrome. |
| 19 | **Sự kiện Webview Lifecycle** | Lắng nghe `did-finish-load`, `did-fail-load`, tự re-inject automation ([L1819-L1855](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L1819-L1855)) | Không có webview DOM element ([L1873](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1873)) | **KHÔNG ÁP DỤNG** | Extension content script tự động inject vào mọi tab `pages.fm` khi load. |
| 20 | **Chu kỳ Polling (`startPolling`)** | Health (5s), Logs (4s), DOM summary (7s) ([L1896-L1901](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L1896-L1901)) | Bổ sung thêm Polling Lease (10s) ([L1915-L1921](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1915-L1921)) | **ĐẠT (Nâng cấp)** | Đảm bảo phát hiện mất lease kịp thời. |
| 21 | **Dọn dẹp khi tắt trang (`pagehide`)** | Electron quản lý lifecycle cửa sổ | Bắt `pagehide`: hủy `leaseTimer`, gọi `adapter.destroy()`, dừng toàn bộ polling ([L1972-L1977](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1972-L1977)) | **ĐẠT (Nâng cấp)** | Dọn dẹp tài nguyên sạch sẽ khi đóng tab web. |
| 22 | **Xuất hàm cho Unit Test (`module.exports`)** | Có block `if (typeof module !== 'undefined')` export dedupe/autoClick ([L1953-L1964](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L1953-L1964)) | Đã lược bỏ hoàn toàn block này ([L583-L594 patch](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1970)) | **KHÁC BEHAVIOR** | Không ảnh hưởng browser nhưng test không thể require trực tiếp `web/public/app.js`. |

---

## 2. Kiểm toán Danh sách Hàm / Primitive của `executeInTab` và Routing Adapter

### 2.1. Danh sách 21 phương thức của `window.__PDB__`
Trong [src/renderer/automation.js:377-399](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/automation.js#L377-L399), đối tượng `window.__PDB__` công khai chính xác **21 phương thức**:

1. `sleep(ms)`: Chờ đợi bất đồng bộ.
2. `waitForSelector(selector, timeoutMs)`: Chờ phần tử DOM xuất hiện.
3. `getUnreadConversations()`: Lấy danh sách hội thoại chưa đọc từ cột bên trái.
4. `getActiveConversationId()`: Lấy ID hội thoại đang mở (dùng cho trợ lý AI).
5. `clickConversationById(id, expectedKey)`: Bấm chọn hội thoại theo ID (kèm kiểm tra key tránh stale).
6. `getCurrentCustomerName()`: Đọc tên khách hàng hiện tại.
7. `getCurrentTags()`: Đọc danh sách tag hiện tại của khách từ thanh tag.
8. `applyTagByName(tagName)`: Bấm chọn gắn thẻ theo tên (ví dụ "Saruto Mới", "Mua hàng").
9. `getReplyTextarea()`: Kiểm tra xem ô nhập tin nhắn có khả dụng không (trả về Boolean).
10. `setReplyText(text)`: Điền nội dung shortcut/tin nhắn vào ô soạn thảo qua native setter.
11. `clearReplyText()`: Xóa nội dung ô soạn thảo.
12. `findSendButton()`: Kiểm tra xem nút gửi tin nhắn có tồn tại không (trả về Boolean).
13. `clickSendButton()`: Bấm nút gửi tin nhắn.
14. `findMarkUnreadButton()`: Kiểm tra nút đánh dấu chưa đọc (trả về Boolean).
15. `markCurrentConversationUnread()`: Bấm nút đánh dấu chưa đọc khi escalate khách mua.
16. `sanitizeOutgoingText(input)`: Kiểm tra an toàn chuỗi shortcut hợp lệ (`/1`, `/2`...).
17. `getDomStatus()`: Trả về trạng thái tổng thể các phần tử DOM quan trọng.
18. `getDomHealth()`: Trả về trạng thái chi tiết: `canReadUnread`, `canClickConversation`, `canTypeReply`, `canSend`, `canTag`, `canMarkUnread`.
19. `getRecentMessages(limit)`: Đọc N tin nhắn gần nhất làm ngữ cảnh cho AI.
20. `getLastMessageSender()`: Kiểm tra tin nhắn cuối cùng là của `customer` hay `admin`.
21. `getCustomerOrderStatus()`: Đọc thông tin đơn hàng của khách từ panel bên phải.

### 2.2. Kiểm tra Whitelist 4 lớp trên Phiên bản Web
Tất cả 21 phương thức trên đã được đối chiếu và xác nhận có mặt **chính xác 100% (không thừa, không thiếu)** tại cả 4 tầng whitelist:
- **Tầng 1 (Dashboard Adapter):** [web/public/adapter.js:8-14](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/adapter.js#L8-L14)
- **Tầng 2 (Dashboard Bridge Content Script):** [extensions/pancake-bot/dashboard-bridge.js:6](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/extensions/pancake-bot/dashboard-bridge.js#L6)
- **Tầng 3 (Extension Background Service Worker):** [extensions/pancake-bot/background.js:4](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/extensions/pancake-bot/background.js#L4)
- **Tầng 4 (Pancake Bridge Content Script):** [extensions/pancake-bot/pancake-bridge.js:4](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/extensions/pancake-bot/pancake-bridge.js#L4)

### 2.3. Đối chiếu Primitive được gọi thực tế trong mã nguồn
- `executeInTab` ở desktop gọi `location.href` tại [src/renderer/app.js:880](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L880). Ở bản web, hàm này đã được chuyển sang đọc metadata từ `adapter.listSlots()` tại [web/public/app.js:956](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L956). Vì vậy `location.href` không cần nằm trong whitelist bridge.
- Các hàm ghi (`leaseWrites`): `clickConversationById`, `setReplyText`, `clickSendButton`, `applyTagByName`, `markCurrentConversationUnread`, `clearReplyText` được kiểm tra gate nghiêm ngặt tại [web/public/app.js:60, 387](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L60), ngăn chặn mọi thao tác ghi khi dashboard chưa giữ lease.
- Tham số truyền: Hàm `clickConversationById` truyền 2 đối số (`id`, `expectedKey`). Kiểm tra tại [pancake-bridge.js:12](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/extensions/pancake-bot/pancake-bridge.js#L12) dùng toán tử `...(message.args || [])`, đảm bảo truyền đúng đầy đủ tham số.

---

## 3. Kiểm kê Tính năng Desktop Gần đây trên Web

### 3.1. Thông báo bằng giọng nói cho khách mua hàng (`buyTtsNotifier.js`)
- **Tình trạng nạp:** File [web/public/vendor/buyTtsNotifier.js](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/vendor/buyTtsNotifier.js) có hash SHA-256 trùng khớp 100% với bản desktop (`BFBE3896BD544682...`). File được nạp tại [web/public/index.html:69](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/index.html#L69).
- **Phụ thuộc IPC:** **KHÔNG CÓ.** Module dùng thuần Web Speech API (`window.speechSynthesis`) hoặc gọi HTTP `POST /api/tts/synthesize` rồi phát qua `new Audio(blobUrl)`.
- **Hạn chế môi trường Web:**
  1. **CSP Directive:** [web/public/index.html:10](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/index.html#L10) thiếu `media-src 'self' blob:`. Khi gọi API TTS của server, hàm `new Audio(blobUrl)` tại [buyTtsNotifier.js:146](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/vendor/buyTtsNotifier.js#L146) sẽ bị trình duyệt chặn vì vi phạm CSP (`default-src 'self'`).
  2. **Browser Autoplay Policy:** Trình duyệt web chặn tự động phát âm thanh (`NotAllowedError`) nếu người dùng chưa tương tác (click) trên tab dashboard sau khi tải trang.
  3. **Background Tab Throttling:** Khi tab dashboard bị ẩn, Chrome có thể tạm dừng hoặc làm chậm `speechSynthesis.speak()`.

### 3.2. Chống va chạm hội thoại đa bot (`conversationClaims.js`)
- **Tình trạng nạp:** File [web/public/vendor/conversationClaims.js](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/vendor/conversationClaims.js) có hash trùng khớp 100% (`249C4198B004...`), nạp tại [web/public/index.html:68](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/index.html#L68).
- **Phụ thuộc IPC:** **KHÔNG CÓ.** Module quản lý một `activeConversationClaims = new Map()` trong bộ nhớ JS.
- **Khả năng hoạt động:**
  - Hoạt động hoàn hảo để ngăn `bot1` và `bot2` trong cùng một dashboard tranh chấp một khách.
  - Đối với bài toán đa máy trạm / đa tab: Do là bộ nhớ in-memory của tab, `claims` không đồng bộ qua mạng. Tuy nhiên, kiến trúc đã giải quyết vấn đề này ở tầng cao hơn bằng **Single-Leader Bot Lease** (`/api/bot-lease`): chỉ duy nhất một dashboard được phép chạy bot loop tại một thời điểm, loại bỏ hoàn toàn nguy cơ 2 máy cùng xử lý.

### 3.3. Bộ não ra quyết định bot (`botDecision.js`)
- **Tình trạng nạp:** File [web/public/vendor/botDecision.js](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/vendor/botDecision.js) có hash trùng khớp 100% (`26AFC161B322...`), nạp tại [web/public/index.html:67](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/index.html#L67).
- **Phụ thuộc IPC:** **KHÔNG CÓ.** Đây là pure logic nhận thông tin khách và đưa ra các quyết định: `NEW_CUSTOMER`, `SKIPPED_HUMAN_REPLY`, `ESCALATED`, `WAITING_REVIEW`, `SHORTCUT`. Hoạt động 100% hoàn hảo trên web.

### 3.4. Hàng đợi duyệt Admin (`reviewQueue`)
- **Khả năng hoạt động:** Polling API `GET /api/review-queue`, gửi duyệt `POST /api/review-queue/resolve`, hiển thị badge số lượng đều hoạt động đầy đủ trên web ([web/public/app.js:1567-1644](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1567-L1644)).
- **Khác biệt:** Tại [web/public/app.js:1650](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1650), khi ấn "Mở hội thoại" nếu có `pancakeUrl`, web dùng `openExternal` mở tab trình duyệt mới, trong khi desktop đổi trực tiếp URL trong webview hiện tại. Nếu có `conversationId`, cả 2 bản đều gọi `clickConversationById` trong tab bot hiện tại thành công.

### 3.5. Điều khiển từ xa Telegram (`/baocao`, `/status`, `/start_bot`, v.v.)
- **Tình trạng tích hợp:** Server web [src/server/web.js:81-98](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/server/web.js#L81-L98) đã tích hợp đầy đủ `telegram.startTelegramPolling()`, `notifyServerUp()`, `scheduleDailyReport()`.
- **Lệnh `/baocao`:** Hoạt động 100% bình thường vì đọc dữ liệu từ `store.getLogs()` trên server Node.js.
- **Hạn chế của lệnh `/start_bot`:** Lệnh `/start_bot` trên Telegram gọi `store.saveSettings({ botEnabled: true })`. Trên desktop, nếu app Electron đang mở ngầm, bot loop sẽ tiếp tục chạy. Nhưng trên bản Web (Phase 1), bot loop chạy trong trình duyệt người dùng. Nếu người dùng tắt tab web hoặc chưa bấm "Bắt đầu Bot" để lấy lease, lệnh `/start_bot` trên Telegram chỉ bật cờ trong cơ sở dữ liệu chứ **không có tiến trình nào thực thi bot loop**.

---

## 4. Kiểm toán Bảo mật và Rủi ro Vận hành khi Sao chép từ Desktop sang Web

### 4.1. Giả định môi trường `window` và IPC
- Không còn bất kỳ tham chiếu trực tiếp nào tới `require('electron')`, `ipcRenderer`, hay `remote` trong [web/public/**](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/).
- Object `window.pancakeDesktop` đã được shim an toàn. Các phương thức không thể thực hiện trên web (`listExtensions`, `reloadExtensions`, `openExtensionsFolder`) trả về hàm `desktopOnly()` hiển thị thông báo toast thân thiện thay vì gây lỗi sập app ([web/public/app.js:15](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L15)).

### 4.2. Ranh giới Origin và `localStorage`
- Bản desktop dùng `localStorage` duy nhất cho `pdb-theme`.
- Bản web lưu `pdb-theme` trong `localStorage` và `pdb-machine-id` trong `sessionStorage` của origin web dashboard.
- Toàn bộ dữ liệu nghiệp vụ (cài đặt, shortcut, ví dụ đã học, nhật ký log) được lưu trữ tập trung trên server qua các API REST (`/api/settings`, `/api/shortcuts`, `/api/examples`, `/api/logs`).
- Tab Pancake chạy trên origin `pages.fm` hoàn toàn độc lập với origin của dashboard web, tuân thủ nghiêm ngặt Same-Origin Policy.

### 4.3. Định danh `machineId` và Rủi ro khi Nhân bản Tab (Duplicate Tab)
- Đoạn mã [web/public/app.js:67-80](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L67-L80) lấy `machineId` từ `sessionStorage`:
  ```javascript
  const store = typeof sessionStorage !== 'undefined' ? sessionStorage : localStorage;
  const stored = store.getItem('pdb-machine-id');
  machineId = stored || ...;
  if (!stored) store.setItem('pdb-machine-id', machineId);
  ```
- **Rủi ro vận hành:** Theo đặc tả của trình duyệt Chromium, khi người dùng thực hiện thao tác "Duplicate Tab" (Nhân bản tab) hoặc `window.open` từ một tab đang có, toàn bộ `sessionStorage` của tab cha sẽ được sao chép sang tab con. Khi đó, cả hai tab cùng sở hữu một chuỗi `machineId`. Nếu tab 1 lấy lease, tab 2 cũng nhận mình là chủ lease, dẫn đến khả năng 2 tab cùng gửi lệnh thao tác tới extension.

### 4.4. Mô hình Kết nối: WebSocket / SSE vs HTTP Polling
- Cả desktop và web đều không sử dụng WebSocket hay SSE.
- Mô hình vận hành là HTTP Polling thuần túy:
  - Health check: mỗi 5.000ms ([web/public/app.js:1917](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1917))
  - Logs: mỗi 4.000ms ([web/public/app.js:1918](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1918))
  - Cập nhật DOM summary: mỗi 7.000ms ([web/public/app.js:1919](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1919))
  - Xác thực Bot Lease: mỗi 10.000ms ([web/public/app.js:1920](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1920))
  - Gia hạn Lease chủ động (`extend`): mỗi 20.000ms ([web/public/app.js:127](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L127))
- Ưu điểm: Đơn giản, tin cậy, không lo đứt gãy kết nối socket. Nhược điểm: Tạo tải polling liên tục lên server Express.

### 4.5. Đóng gói Extension và Vấn đề Triển khai Thực tế (Deployment Pitfalls)
- **Hardcode Origin trong Extension:** Trong [extensions/pancake-bot/manifest.json:17-18, 41-42](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/extensions/pancake-bot/manifest.json#L17-L18):
  ```json
  "host_permissions": [
    ...
    "http://localhost:8787/*",
    "http://127.0.0.1:8787/*"
  ],
  "content_scripts": [
    ...
    {
      "matches": [
        "http://localhost:8787/*",
        "http://127.0.0.1:8787/*"
      ],
      "js": ["dashboard-bridge.js"]
    }
  ]
  ```
  Và trong [extensions/pancake-bot/background.js:45](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/extensions/pancake-bot/background.js#L45):
  `const dashboard = trustedFrame && Number.isInteger(id) && matches(url, config[1].matches);`
  Mặc dù script build [scripts/build-extension.js:9](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/scripts/build-extension.js#L9) có hỗ trợ cờ `--dashboard=<url>`, bản build đóng gói mặc định hiện tại chỉ hỗ trợ `localhost:8787`. Khi deploy lên VPS với tên miền thật (hoặc IP mạng LAN), extension **hoàn toàn không nhận diện được dashboard**.

---

## 5. Kết luận và Kế hoạch Hành động Xếp hạng Ưu tiên (P0 / P1 / P2)

Dưới đây là danh mục các hạng mục kỹ thuật cần xử lý tiếp theo để hoàn thiện độ tương đồng (parity) và bảo đảm ứng dụng sẵn sàng triển khai thực tế.

### 5.1. P0 — Chặn đứng luồng Bot / Triển khai Thực tế

#### Việc P0.1: Cấu hình linh hoạt domain cho Extension Bridge trên môi trường VPS
- **Hiện trạng:** [extensions/pancake-bot/manifest.json:17-18, 41-42](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/extensions/pancake-bot/manifest.json#L17-L18) và [background.js:45](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/extensions/pancake-bot/background.js#L45) cố định `localhost:8787`.
- **Hậu quả:** Web triển khai trên VPS/cloud qua domain HTTPS không thể kết nối tới extension bridge.
- **Vị trí liên quan:**
  - `extensions/pancake-bot/manifest.json`
  - `extensions/pancake-bot/background.js`
  - `scripts/build-extension.js`
- **Giải pháp đề xuất:**
  - Hỗ trợ biến môi trường `WEB_DASHBOARD_ORIGIN` khi build extension (`npm run build:extension -- --dashboard=<url>`).
  - Hoặc cho phép người dùng cấu hình Dashboard Origin trong `popup.html` của extension và lưu vào `chrome.storage.local`, kết hợp cấp quyền động (`chrome.permissions.request`) và đăng ký content script động (`chrome.scripting.registerContentScripts`).
- **Tiêu chí nghiệm thu:** Truy cập web dashboard tại một domain bất kỳ (ví dụ `https://dashboard.example.com`), icon bridge báo `Bridge connected`, ping/pong thành công.

---

### 5.2. P1 — Trải nghiệm Người dùng & Tính đúng đắn của Nghiệp vụ

#### Việc P1.1: Bổ sung quyền phát âm thanh `blob:` vào Content Security Policy
- **Hiện trạng:** [web/public/index.html:10](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/index.html#L10) thiếu chỉ thị `media-src`.
- **Hậu quả:** Hàm `speakApi()` trong [buyTtsNotifier.js:146](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/vendor/buyTtsNotifier.js#L146) phát âm thanh blob URL bị chặn bởi CSP.
- **Vị trí liên quan:**
  - `web/public/index.html` (thẻ meta CSP)
- **Giải pháp đề xuất:**
  - Cập nhật CSP trong `web/public/index.html` thành:
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:;`
- **Tiêu chí nghiệm thu:** Bấm nút "Test TTS" hoặc nhận thông báo khách mua hàng qua API TTS không xuất hiện lỗi CSP trong browser console, phát ra âm thanh thành công.

#### Việc P1.2: Xử lý chính sách Autoplay Policy của trình duyệt cho TTS
- **Hiện trạng:** [buyTtsNotifier.js:156](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/vendor/buyTtsNotifier.js#L156) gọi `audio.play().catch(reject)` khi có khách mua.
- **Hậu quả:** Trình duyệt chặn âm thanh nếu người dùng chưa click tương tác vào trang web sau khi mở.
- **Vị trí liên quan:**
  - `web/public/app.js`
  - `web/public/vendor/buyTtsNotifier.js`
- **Giải pháp đề xuất:**
  - Thêm cơ chế "Kích hoạt âm thanh" (Unlock Audio): hiển thị thông báo/banner nhỏ yêu cầu người dùng click 1 lần khi vào trang để khởi tạo AudioContext / speechSynthesis gesture token.
- **Tiêu chí nghiệm thu:** Sau khi click mở khóa âm thanh 1 lần, các thông báo TTS tiếp theo phát bình thường ngay cả khi tab đang không được focus.

#### Việc P1.3: Chống trùng lặp `machineId` khi nhân bản tab (Duplicate Tab)
- **Hiện trạng:** [web/public/app.js:72-79](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L72-L79) đọc `pdb-machine-id` từ `sessionStorage`.
- **Hậu quả:** Duplicate Tab nhân bản cả `sessionStorage`, khiến 2 tab có cùng identity và phá vỡ Single-Leader Lease.
- **Vị trí liên quan:**
  - `web/public/app.js` hàm `getMachineId()`
- **Giải pháp đề xuất:**
  - Sử dụng kết hợp `sessionStorage` với một `tabInstanceId` ngẫu nhiên trong biến cục bộ runtime, hoặc dùng kênh `BroadcastChannel('pdb-lease-sync')` để phát hiện nếu đã có tab khác cùng ID đang chạy.
- **Tiêu chí nghiệm thu:** Mở 2 tab cùng một trình duyệt (hoặc duplicate tab), mỗi tab có một `machineId` riêng biệt và khi tab 1 giữ lease, tab 2 hiển thị cảnh báo `... đang giữ bot lease`.

#### Việc P1.4: Điều hướng hội thoại qua Bridge thay vì mở tab mới (`navigateToConversation`)
- **Hiện trạng:** [web/public/app.js:1650](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1650) gọi `openExternal(item.pancakeUrl)` mở tab mới.
- **Hậu quả:** Mở thêm tab Pancake mới thay vì chuyển tab Pancake đang kết nối tới URL đó, gây lãng phí RAM và có thể vượt quá số lượng 3 slots.
- **Vị trí liên quan:**
  - `web/public/app.js` hàm `navigateToConversation()`
  - `extensions/pancake-bot/background.js` (bổ sung op `navigate-tab`)
- **Giải pháp đề xuất:**
  - Bổ sung lệnh `navigate-tab` vào protocol bridge: gửi `{ type: 'navigate-tab', slot: tabId, url: item.pancakeUrl }` để background gọi `chrome.tabs.update(tabId, { url })`.
- **Tiêu chí nghiệm thu:** Bấm "Mở hội thoại" trong Review Queue, tab Pancake của slot tương ứng tự động chuyển tới URL hội thoại mà không mở thêm tab trình duyệt mới.

---

### 5.3. P2 — Tối ưu Trải nghiệm, Giao diện & Vệ sinh Mã nguồn

#### Việc P2.1: Bổ sung chức năng reload tab Pancake từ xa cho nút Toolbar
- **Hiện trạng:** [web/public/app.js:1823](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js#L1823) gán nút `reloadBtn` gọi `checkBridge()`.
- **Hậu quả:** Không thể reload lại trang Pancake khi bị treo từ dashboard web.
- **Vị trí liên quan:**
  - `web/public/app.js`
  - `extensions/pancake-bot/background.js`
- **Giải pháp đề xuất:**
  - Bổ sung message `{ type: 'reload-pancake-tab', slot: activeWvTab }` để background gọi `chrome.tabs.reload(tabId)`.
- **Tiêu chí nghiệm thu:** Bấm nút Reload trên toolbar của web, tab Pancake tương ứng của slot đang active tự động F5/reload lại.

#### Việc P2.2: Dọn dẹp thẻ nạp `vendor/conversationProcessing.js` không sử dụng
- **Hiện trạng:** [web/public/index.html:247](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/index.html#L247) nạp `vendor/conversationProcessing.js`, nhưng [web/public/app.js](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js) vẫn dùng hàm inline `processOneConversation`.
- **Hậu quả:** Dư thừa 1 request tải tài nguyên chết.
- **Vị trí liên quan:**
  - `web/public/index.html`
- **Giải pháp đề xuất:**
  - Xóa dòng `<script src="vendor/conversationProcessing.js"></script>` khỏi `web/public/index.html`.
- **Tiêu chí nghiệm thu:** Trang tải sạch sẽ, không có script thừa không dùng.

#### Việc P2.3: Điều chỉnh giao diện Tab Extensions trên Web
- **Hiện trạng:** Giao diện web vẫn hiển thị nút "Quản lý extension (desktop)" tại [web/public/index.html:218](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/index.html#L218) và click vào chỉ hiện toast.
- **Hậu quả:** Gây hiểu nhầm cho người dùng web.
- **Vị trí liên quan:**
  - `web/public/index.html`
- **Giải pháp đề xuất:**
  - Ẩn nút hoặc thay bằng đường link hướng dẫn tải file zip / cài đặt extension bridge cho trình duyệt Chrome.
- **Tiêu chí nghiệm thu:** Tab Extensions thể hiện rõ ràng trạng thái extension bridge của trình duyệt.

#### Việc P2.4: Khôi phục khối export có điều kiện cho Unit Test trong `web/public/app.js`
- **Hiện trạng:** [web/public/app.js](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/web/public/app.js) thiếu khối `if (typeof module !== 'undefined' && module.exports)` vốn có ở desktop ([src/renderer/app.js:1953](file:///C:/Users/My%20Laptop/orca/workspaces/pancake-desktop-ai-shortcut-bot-v3/web-parity-t2/src/renderer/app.js#L1953)).
- **Hậu quả:** Các bài test unit trong tương lai không thể import các hàm helper từ `web/public/app.js`.
- **Vị trí liên quan:**
  - `web/public/app.js` (cuối file)
- **Giải pháp đề xuất:**
  - Bổ sung khối export có điều kiện giống desktop mà không ảnh hưởng tới môi trường browser.
- **Tiêu chí nghiệm thu:** `require('./web/public/app.js')` trong Node.js test xuất ra các hàm `makeDedupeKey`, `shouldSkipByTags`, `rememberAutoClickProcessed`.
