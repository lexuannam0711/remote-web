# W1 — Web extension bridge E2E

## Kết quả

1 test Playwright, browser Chromium thật, extension MV3 thật, 3 lượt liên tiếp PASS.
Không phát hiện lỗi product trong phạm vi assertion; không sửa extensions/pancake-bot/** hoặc web/public/**.
Coordinator đã xác nhận xử lý sự cố chẩn đoán ngoài test, yêu cầu ghi rõ và tiếp tục hoàn thành (msg_1b8be22246ed).

## Evidence

Lệnh chạy riêng, tuần tự:

```text
npx playwright test test/e2e/web-extension-bridge.spec.js
Lượt 1: 1 passed (5.6s) — test duration 4.2s
Lượt 2: 1 passed (5.4s) — test duration 4.2s
Lượt 3: 1 passed (5.8s) — test duration 4.4s
npm run check — exit 0
node --test test/extension-build.test.js test/web-dashboard.test.js
tests 33; pass 33; fail 0; skipped 0; duration_ms 864.6763
node --check test/e2e/web-extension-bridge.spec.js — exit 0
node --check test/e2e/fixture/web-extension-bridge-server.js — exit 0
```

## Vòng tròn đã kiểm chứng

- Form login thật chuyển về dashboard; adapter.ping() nhận pong từ extension thật.
- createWebApp thật, token giả, HTTP 127.0.0.1:8787 cố định; probe bind kiểm tra cổng, không reuse server khác.
- Một persistent context headless, extension path tuyệt đối; chờ service worker.
- Một HTTPS fixture phụ trên loopback cổng ephemeral; host-resolver-rules MAP pages.fm 127.0.0.1:<port>; URL browser https://pages.fm/ không port; --ignore-certificate-errors, --test-type, ignoreHTTPSErrors, --no-proxy-server.
- Cert/key/profile trong os.tmpdir(), xóa trong teardown; context và cả hai listener đều đóng tuần tự.
- DOM giả dùng conversation-list-item unread, list_tags_conv, name-text, snippet-text, btn-tag-item/ellipse, pageCustomer/customer-name, replyBoxComposer, conv-action-btn, Mail Unread; mẫu identity theo test/pancake-dom.test.js.
- adapter.call lấy hai unread identity cùng tên/snippet/tags; đọc customer/tags/composer/mark-unread.
- Dashboard giữ lease thật; dashboard thứ hai có identity riêng bị từ chối acquire và write với BOT_LEASE_REQUIRED; textarea không thay đổi; holder viết /1 thành công.
- Giữ response HTTP extend thật sau route.fetch, gọi loseLease, thả response muộn; epoch guard không phục hồi lease, write tiếp bị từ chối.
- NO_TAB trước khi nối và sau khi đóng tab; SLOT_FULL từ tab thứ tư qua isolated world thật; ba slot vẫn được giữ.
- Đóng tab giải phóng bot1; mở lại nối bot1 và đọc DOM thành công.
- Unknown method bị adapter từ chối INVALID_CALL; dashboard content script, background runtime, Pancake content script độc lập trả METHOD_NOT_ALLOWED, không thay bridge bằng mock.

## Giới hạn và lỗi harness đã sửa

- Playwright yêu cầu revision 1228, cache máy có full Chromium 1234; helper dùng Chromium đã cài, không tải/cài dependency. Revision fallback có thể lệch Playwright ở máy khác.
- Fixture URL có port explicit bị background matches từ chối NO_TAB. Sửa harness bằng resolver port mapping, coordinator đã duyệt; không sửa manifest/background.
- Login URL đạt đích trước khi app.js chạy: thêm waitForLoadState('load'), không sửa product.
- Ancillary API dashboard (health/settings/logs/AI/shortcuts/examples/review) trả dữ liệu synthetic trong context route để tránh đọc private store hoặc ghi log. Login/lease/env/static assets và bridge/DOM không mock.
- Không dùng account thật, không gọi send button, không chạy npm test toàn bộ, không commit/push/deploy. Không đo coverage; kết quả không suy rộng sang production hoặc browser khác.

## Sự cố constraint ngoài E2E

Sau các check, lệnh chẩn đoán chrome.exe --version trên Windows giữ process 120208 không có headless flag. Đã xác minh exact PID + command line, đóng chỉ process tự tạo; báo escalation msg_c8f3daccc043 cho coordinator. Không dùng process đó cho E2E; cả ba lượt E2E đều headless. Không xác minh được process chẩn đoán có hiển thị cửa sổ hay không; không thể khẳng định tuân thủ tuyệt đối ràng buộc không launch headful trong toàn phiên. Coordinator xác nhận đã hiểu vi phạm, xử lý đúng và yêu cầu tiếp tục hoàn thành, ghi rõ sự cố (msg_1b8be22246ed). Kiểm tra sau cleanup: process 120208 không còn, cổng 8787 không lắng nghe.

## Files

- test/e2e/web-extension-bridge.spec.js
- test/e2e/fixture/web-extension-bridge.html
- test/e2e/fixture/web-extension-bridge-server.js
- test/e2e/web-extension-bridge-report.md

## Self-evaluation

| Trục | Điểm | Evidence / giới hạn |
|---|---:|---|
| Accuracy | 4 | Ba output PASS, 33 scoped checks; không suy rộng production |
| Completeness | 3 | Đủ vòng E2E; constraint diagnostic launch đã vi phạm |
| Clarity | 4 | Nêu rõ mock ancillary, bridge thật, sự cố ngoài test |
| Actionability | 4 | Chạy spec trực tiếp; cần coordinator review sự cố |
| Conciseness | 4 | Một spec, helper, HTML; một report evidence |

Trung bình 3.8/5. Ưu tiên: coordinator review sự cố; lần sau đọc FileVersionInfo hoặc browser.version() trong context headless, không gọi chrome.exe --version trên Windows. Đánh giá phản ánh bằng chứng, không tự coi artifact PASS là dispatch tuân thủ hoàn toàn.
