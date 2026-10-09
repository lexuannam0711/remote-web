# Báo Cáo Quét Bảo Mật & Quyền Riêng Tư Mặt Phẳng Web (Security & Privacy Sweep)

> **Mã tài liệu:** `2026-10-10-WEB-SEC-PRIVACY-SWEEP`  
> **Dự án:** `pancake-desktop-ai-shortcut-bot-v3`  
> **Phiên bản:** Phase 1 (Web Plane & Extension Bridge)  
> **Người phê duyệt cuối cùng:** Admin / Sếp tổng  
> **Trạng thái:** Hoàn tất quét toàn diện (Read-Only Audit)  
> **Thời điểm thực hiện:** 2026-10-10  
> **Nguyên tắc an toàn:** Tuyệt đối không in đầy đủ chuỗi bí mật ra báo cáo công khai; chỉ sử dụng tiền tố và định danh.

---

## Tóm Tắt Điều Hành (Executive Summary)

Đợt quét bảo mật và quyền riêng tư (Security & Privacy Sweep) này được thực hiện trước khi Admin quyết định cho phép push lên GitHub public hoặc triển khai lên môi trường máy chủ (VPS/Cloud). Toàn bộ mã nguồn mới tại các commit gần đây (`17c804d`, `6ed74af`) cùng lịch sử git (`git log -p`, toàn bộ nhánh local và remote `origin/main`) đã được rà soát chi tiết qua 6 hạng mục trọng yếu.

### Bảng Tổng Hợp Số Lượng Phát Hiện Theo Xếp Hạng

| Xếp Hạng (Severity) | Số Lượng | Nội Dung Cần Quyết Định / Xử Lý Ngay |
| :--- | :---: | :--- |
| **CRITICAL** | **0** | Không có lỗ hổng thực thi mã từ xa (RCE) tức thì hoặc lộ master secret trong nhánh hiện tại. |
| **HIGH** | **4** | 1. Supabase Anon Key & DB URL trong lịch sử public `origin/main` (`a0d45ed`).<br>2. Endpoint `/health` và `/api/settings` trả về `aiApiKey` và `ttsApiKey` dạng plaintext.<br>3. `uploadPolicy.js` không được gắn vào `multer` tại `index.js`, file upload không bị giới hạn kích thước/loại và không bị xóa sau khi parse.<br>4. CSRF / Host header injection gate tại `web.js`: cho phép `origin === 'null'` và phản chiếu `Host` chưa whitelist. |
| **MEDIUM** | **4** | 1. Rate-limit IP tại `auth.js` dùng trực tiếp socket address: nguy cơ DoS toàn bộ người dùng khi đứng sau reverse proxy.<br>2. Lộ PII khách hàng (tên, SĐT, địa chỉ) trong `logs.json` (`/api/logs`) và truyền qua Telegram Bot API.<br>3. Thiếu header bảo vệ Clickjacking (`X-Frame-Options` / CSP `frame-ancestors`) trên web dashboard.<br>4. Xung đột trạng thái (state collision) và xung đột Telegram polling (409 Conflict) giữa bản desktop và web khi cùng trỏ vào `server/data`. |
| **LOW** | **3** | 1. Header `x-forwarded-proto` tại `auth.js` không tách danh sách dấu phẩy khi gán cờ `Secure` cookie.<br>2. Extension manifest chỉ cho phép `localhost:8787`, chặn triển khai web qua domain VPS từ xa.<br>3. Hardcoded URL tunnel ngoài `https://rtltbar.abc-tunnel.us` trong `store.js`. |
| **INFO** | **6** | Các cơ chế an toàn đã kiểm chứng hoạt động tốt: Timing-safe login, Session fixation mitigation, PostMessage same-origin gate, 3-layer method whitelist, Lease epoch guard, Fail-fast non-loopback bind. |

---

## 1. Bí Mật & Khóa Truy Cập (Secrets & Key Audit)

### Phương pháp kiểm tra
- Thực hiện quét toàn bộ cây tệp tin được theo dõi (`git ls-files`).
- Quét toàn bộ lịch sử commit của nhánh hiện tại `lexuannam0711/web-sec-t3` (`git log -p`).
- Quét đối soát lịch sử trên toàn bộ các nhánh (`git log --all -p`) tìm kiếm các định dạng khóa API (OpenAI `sk-...`, Gemini `AIza...`, Telegram bot token `[0-9]{8,11}:[A-Za-z0-9_-]{35}`, GitHub tokens `ghp_...`, JWT, PEM private keys, Base64 khả nghi).

### Bảng Phát Hiện & Đánh Giá

| Đường Dẫn Tệp | Số Dòng | Xếp Hạng | Mô Tả Hiện Trạng | Cách Vá Đề Xuất |
| :--- | :---: | :---: | :--- | :--- |
| `src/control-plane/clientConfig.js` *(lịch sử commit `a0d45ed`, `5d3df25`, `e694c0f` trên `origin/main`)* | 3 | **HIGH** | Khóa JWT Supabase Anon (`eyJhbGciOiJIUzI1NiIsInR5cCI6...`) và URL `https://db•••(redacted).supabase.co` đã từng được commit trực tiếp lên GitHub public trong phiên bản 3.0.1. Bất kỳ ai clone repo đều có thể đọc được key này. | 1. Xoay vòng (rotate) JWT secret của dự án Supabase ngay trên Supabase Console.<br>2. Kiểm tra lại toàn bộ chính sách Row Level Security (RLS) của Supabase.<br>3. Không bao giờ commit giá trị default chứa key thật. |
| `src/server/store.js` | 52 | **LOW** | Giá trị mặc định `ttsBaseUrl` được hardcode là `https://rtltbar.abc-tunnel.us/v1` (URL tunnel dịch vụ ngoài của hệ thống cũ). | Thay thế bằng chuỗi rỗng `''` hoặc đọc từ biến môi trường `TTS_BASE_URL`. Tránh đưa domain tunnel cá nhân vào mã nguồn. |
| `extensions/pancake/manifest.json` | 22 | **INFO** | Thuộc tính `"key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAranA8VQ4jdoA..."` chứa chuỗi Base64 dài. Đây là RSA Public Key tiêu chuẩn của Chrome Extension (Pancake v2) dùng để ghim cố định Extension ID, không phải private key hay token bí mật. | Giữ nguyên (đây là metadata công khai của extension vendored của Pancake). |
| `.env.example` | 1-24 | **INFO** | Tệp mẫu không chứa bất kỳ secret thật nào. Các biến `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `WEB_ACCESS_TOKEN` đều để trống hoặc mang giá trị placeholder `your_gemini_api_key_here`. | Duy trì trạng thái này. Đảm bảo `.gitignore` chặn triệt để `.env` và `.env.*`. |
| Toàn bộ nhánh `lexuannam0711/web-sec-t3` (các commit `17c804d`, `6ed74af`) | - | **INFO** | **KHÔNG PHÁT HIỆN** token thật nào trong commit mặt phẳng web mới. Các khóa trong kiểm thử (`test/web-server.test.js`, `test/tts.test.js`) đều là giả lập (`'secret-token'`, `'sk-test-123'`). | Giữ vững quy tắc: luôn nạp khóa từ biến môi trường `.env`, không hardcode vào test hay source. |

---

## 2. Dữ Liệu Khách Hàng & Quyền Riêng Tư (Customer Data Privacy)

### Phương pháp kiểm tra
- Truy vết luồng ghi log (`appendLog`), tệp lưu trữ dữ liệu người dùng (`store.js`, `server/data/*.json`), chính sách upload tệp (`uploadPolicy.js`, `multer`), và các endpoint API của Express trong `src/server/index.js` và `src/server/web.js`.

### Bảng Phát Hiện & Đánh Giá

| Đường Dẫn Tệp | Số Dòng | Xếp Hạng | Mô Tả Hiện Trạng | Cách Vá Đề Xuất |
| :--- | :---: | :---: | :--- | :--- |
| `src/server/index.js` | 66-70 | **HIGH** | Endpoint `GET /health` trả về toàn bộ đối tượng `settings`, trong đó có chứa `aiApiKey` và `ttsApiKey` dạng plaintext (không được che/mask bằng `summarizeAIConfig`). | Sửa `GET /health` để chỉ trả về cấu hình an toàn, loại bỏ hoặc che hoàn toàn `aiApiKey` và `ttsApiKey` (chỉ trả về dạng `sk-...xxxx` hoặc boolean `hasAiKey: true`). |
| `src/server/index.js` | 76 | **HIGH** | Endpoint `GET /api/settings` trả về toàn bộ `settings` dạng thô chứa `aiApiKey` và `ttsApiKey`. Phía web dashboard (`web/public/app.js:52`) nạp các key này vào trường input HTML của trình duyệt. Nếu xảy ra XSS hoặc phiên làm việc bị lộ, key sẽ bị đọc trộm. | Che các trường nhạy cảm khi trả về client (`aiApiKeyMasked`, `ttsApiKeyMasked`). Client chỉ gửi đè key mới khi người dùng chủ động nhập vào input. |
| `src/server/index.js` | 15, 152-163 | **HIGH** | Module `uploadPolicy.js` (được định nghĩa với `MAX_EXCEL_BYTES = 5MB` và kiểm tra extension/MIME type) **chưa bao giờ được import hay sử dụng** trong `index.js`. `multer({ dest: UPLOADS })` nhận mọi loại tệp không giới hạn dung lượng, và tệp tạm trong `uploads/` không bao giờ được xóa (`fs.unlink`) sau khi đọc xong. | 1. Import `uploadPolicy` vào `index.js` và cấu hình `limits: { fileSize: MAX_EXCEL_BYTES }` cùng `fileFilter`.<br>2. Bổ sung khối `finally { await fs.unlink(req.file.path).catch(() => {}); }` để dọn tệp tạm ngay lập tức. |
| `src/server/index.js` | 43-48 | **MEDIUM** | Hàm `handleAnalyzeMessage` ghi toàn bộ tin nhắn gốc của khách (`customerMessage`) vào `server/data/logs.json`. Tin nhắn này thường chứa họ tên, số điện thoại, địa chỉ giao hàng và thông tin đơn hàng nhạy cảm. | Áp dụng hàm ẩn danh hóa (masking/sanitization) đối với số điện thoại (`098****123`) và số nhà trước khi lưu vào `logs.json`. |
| `src/server/index.js`<br>`src/server/telegram.js` | 346-350<br>63-73 | **MEDIUM** | Khi có khách chốt đơn (`/api/notify/buy`), bot gửi họ tên, số điện thoại, địa chỉ đầy đủ của khách hàng sang Telegram Bot API (`api.telegram.org`). Dữ liệu này lưu trữ trên hạ tầng đám mây của bên thứ ba (Telegram). | 1. Đảm bảo nhóm/kênh Telegram nhận tin là kênh riêng tư tuyệt đối của Admin.<br>2. Cân nhắc cấu hình ẩn 3 chữ số giữa của số điện thoại khi gửi qua thông báo. |
| `src/server/store.js` | 196-237 | **LOW** | Hàng đợi duyệt `review-queue.json` lưu trữ trường `addressLookup` gồm liên kết tìm kiếm Google Maps chứa chuỗi địa chỉ chi tiết của khách hàng (`googleMapsUrl`). | Đảm bảo tệp `server/data/review-queue.json` được phân quyền nghiêm ngặt và không bao giờ bị public. |
| `src/server/web.js` | 37 | **INFO** | **KHÔNG PHÁT HIỆN** rò rỉ dữ liệu cho client chưa xác thực. Middleware `webAuth.requireAuth` được đặt ở dòng 37, bảo vệ toàn bộ các endpoint chứa PII khách hàng (`/api/logs`, `/api/review-queue`, `/api/shortcuts`, `/api/env`, `/api/bot-lease`). Client chưa đăng nhập đều bị chặn với mã HTTP 401. | Duy trì kiến trúc: tuyệt đối không di chuyển bất kỳ route nghiệp vụ nào lên phía trước `requireAuth`. |

---

## 3. Mặt Phục Vụ Web (Web Server Surface & Attack Posture)

### Phương pháp kiểm tra
- Phân tích mã nguồn `src/server/auth.js` và `src/server/web.js`.
- Kiểm tra các tiêu chuẩn bảo mật web: timing attack, session fixation, rate limit bypass, cookie attributes, CSRF, DNS rebinding / host header injection, và kiểm soát mở cổng mạng (bind socket).

### Bảng Phát Hiện & Đánh Giá

| Đường Dẫn Tệp | Số Dòng | Xếp Hạng | Mô Tả Hiện Trạng | Cách Vá Đề Xuất |
| :--- | :---: | :---: | :--- | :--- |
| `src/server/web.js` | 19, 23 | **HIGH** | Bộ lọc Origin (`allowed`) cho phép `origin === 'null'` và `!origin` vượt qua cổng kiểm tra POST/DELETE. Trong trình duyệt, các iframe sandboxed (`<iframe sandbox="allow-scripts allow-forms">`) có `Origin: null`. Ngoài ra, công thức `origin === \`${scheme(req)}://${req.get('host')}\`` phản chiếu trực tiếp header `Host` mà không kiểm tra qua whitelist tên miền cố định, dẫn đến nguy cơ vượt kiểm tra Origin thông qua Host Header Injection / DNS Rebinding. | 1. Loại bỏ `origin === 'null'` khỏi danh sách allowed trên môi trường web (chỉ chấp nhận origin hợp lệ từ domain chỉ định).<br>2. Bắt buộc kiểm tra `req.get('host')` khớp với danh sách domain hợp lệ hoặc `WEB_ALLOWED_ORIGIN`. |
| `src/server/auth.js` | 55-60 | **MEDIUM** | Rate-limit đăng nhập sử dụng `req.socket?.remoteAddress` để chống giả mạo `X-Forwarded-For`. Tuy nhiên, khi web được triển khai thực tế sau Reverse Proxy (Nginx, Caddy), địa chỉ socket của mọi client đều là `127.0.0.1`. Kẻ tấn công cố tình nhập sai 10 lần sẽ gây **Từ chối Dịch vụ (DoS)** cục bộ, khóa quyền đăng nhập của chính Admin trong 60 giây. | Bổ sung cơ chế nhận diện proxy an toàn: khi cấu hình `TRUST_PROXY=1` (kèm secret proxy header hoặc dải IP loopback được tin cậy), mới trích xuất IP client thực tế từ đầu danh sách `X-Forwarded-For`. |
| `src/server/web.js` | 10-25 | **MEDIUM** | Web server thiếu các header bảo vệ chống Clickjacking và MIME sniffing: `X-Frame-Options: DENY` (hoặc `SAMEORIGIN`), `Content-Security-Policy: frame-ancestors 'none'`, và `X-Content-Type-Options: nosniff`. Dashboard có thể bị nhúng lén vào trang web khác để lừa Admin thao tác. | Thêm middleware bảo mật đặt các header tiêu chuẩn:<br>`res.setHeader('X-Frame-Options', 'DENY');`<br>`res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");`<br>`res.setHeader('X-Content-Type-Options', 'nosniff');`. |
| `src/server/auth.js` | 38 | **LOW** | Hàm `cookie()` kiểm tra `req.headers['x-forwarded-proto'] === 'https'`. Nếu qua proxy nhiều tầng gửi chuỗi `'https, http'`, phép so sánh bằng tuyệt đối này sẽ trả về `false`, khiến cờ `Secure` bị bỏ quên trên cookie phiên, trong khi `web.js` dòng 18 đã xử lý tách chuỗi đúng đắn. | Chuẩn hóa dòng 38: `String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'`. |
| `src/server/auth.js` | 29, 66-67 | **INFO** | **ĐẠT CHUẨN:** So sánh mã token đăng nhập sử dụng SHA-256 băm cả hai vế rồi gọi `crypto.timingSafeEqual(supplied, expected)`. Chống hoàn toàn tấn công timing attack đo thời gian so sánh chuỗi. | Giữ nguyên hiện trạng. |
| `src/server/auth.js` | 72-74, 86 | **INFO** | **ĐẠT CHUẨN:** Session fixation mitigation hoạt động tốt: phiên cũ bị xóa khỏi bộ nhớ `sessions.delete` trước khi cấp phát session ID ngẫu nhiên 32 bytes (`crypto.randomBytes(32)`). Đăng xuất thu hồi session ngay lập tức. | Giữ nguyên hiện trạng. |
| `src/server/auth.js` | 8 | **INFO** | **ĐẠT CHUẨN:** Hàm `parseCookie` kiểm tra và loại trừ các thuộc tính `__proto__`, `constructor`, `prototype`, loại trừ nguy cơ Prototype Pollution qua tiêu đề cookie. | Giữ nguyên hiện trạng. |
| `src/server/web.js` | 8, 62-68 | **INFO** | **ĐẠT CHUẨN:** Cơ chế Fail-fast hoạt động nghiêm ngặt: Server ném ngoại lệ dừng khởi động ngay nếu `WEB_ACCESS_TOKEN` rỗng, hoặc nếu cấu hình bind ra địa chỉ mạng ngoài (`0.0.0.0`) mà thiếu cờ xác nhận `WEB_ALLOW_PUBLIC=1`. Khi mở bind công khai, bot tự động bắn cảnh báo lên Telegram Admin. | Giữ nguyên hiện trạng. |

---

## 4. Cầu Nối PostMessage (Dashboard ⇄ Extension Bridge)

### Phương pháp kiểm tra
- Rà soát mã nguồn `web/public/adapter.js`, `extensions/pancake-bot/dashboard-bridge.js`, `extensions/pancake-bot/background.js`, `extensions/pancake-bot/pancake-bridge.js`, và `web/public/app.js`.

### Bảng Phát Hiện & Đánh Giá

| Đường Dẫn Tệp | Số Dòng | Xếp Hạng | Mô Tả Hiện Trạng | Cách Vá Đề Xuất |
| :--- | :---: | :---: | :--- | :--- |
| `extensions/pancake-bot/manifest.json` | 17-19, 40-43 | **LOW** | Thuộc tính `matches` của `dashboard-bridge.js` và `host_permissions` bị giới hạn cứng ở `http://localhost:8787/*` và `http://127.0.0.1:8787/*`. Khi triển khai web dashboard trên domain VPS thật (như `https://bot.domain.vn`), extension sẽ không tự động nạp content script. | Bổ sung cơ chế khai báo URL dashboard tùy chỉnh trong trang Options/Popup của extension hoặc cho phép Admin thêm match pattern cho domain VPS khi đóng gói extension. |
| `web/public/adapter.js`<br>`extensions/pancake-bot/dashboard-bridge.js` | 4, 70<br>7, 12 | **INFO** | **ĐẠT CHUẨN:** Toàn bộ giao tiếp `postMessage` đều truyền tường minh `targetOrigin = window.location.origin` (tuyệt đối không dùng `*`). Trình lắng nghe kiểm tra chặt chẽ `event.source === window`, `event.origin === window.location.origin` và cấu trúc tin nhắn. | Giữ nguyên hiện trạng. |
| `web/public/adapter.js`<br>`extensions/pancake-bot/background.js` | 63<br>75 | **INFO** | **ĐẠT CHUẨN:** Mỗi lời gọi hàm sinh một `callId` duy nhất (`pdb-call-${++nextCallId}`). Background service worker và Adapter kiểm tra khớp nối chính xác `result.callId === message.callId`, ngăn chặn hoàn toàn việc nhầm lẫn kết quả giữa các tác vụ bất đồng bộ. | Giữ nguyên hiện trạng. |
| `web/public/app.js` | 54, 78, 100-109, 388 | **INFO** | **ĐẠT CHUẨN:** Cơ chế **Lease Epoch Guard** hoạt động chuẩn mực: biến `leaseEpoch` tăng lên mỗi khi mất lease (`loseLease`). Các phản hồi `extend` đến muộn sau khi mất quyền sẽ bị hủy bỏ, ngăn chặn tình trạng hồi sinh lease giả tạo. Mọi hàm ghi tự động (`leaseWrites`) đều bị khóa nếu không nắm giữ lease hợp lệ (`BOT_LEASE_REQUIRED`). | Giữ nguyên hiện trạng. |
| `web/public/adapter.js`<br>`extensions/pancake-bot/dashboard-bridge.js`<br>`extensions/pancake-bot/background.js`<br>`extensions/pancake-bot/pancake-bridge.js` | 8-14<br>6<br>4, 70<br>4, 10 | **INFO** | **ĐẠT CHUẨN:** Danh sách trắng 21 hàm `window.__PDB__` được kiểm tra qua **3 lớp độc lập** (Adapter ➔ Dashboard Bridge ➔ Background & Pancake Bridge). Không chấp nhận thực thi chuỗi JavaScript tùy ý (không `eval`), loại trừ triệt để nguy cơ tiêm mã độc (Code Injection). | Giữ nguyên hiện trạng. |
| `extensions/pancake-bot/background.js` | 42, 83-101 | **INFO** | **ĐẠT CHUẨN:** Biến `trustedFrame` kiểm tra `sender.frameId === 0`, chỉ chấp nhận lệnh từ top-level frame. Khi tab Pancake bị đóng hoặc điều hướng sang trang ngoài (`chrome.tabs.onUpdated`, `onRemoved`), slot được thu hồi ngay lập tức và phát thông báo `slots-changed`. | Giữ nguyên hiện trạng. |

---

## 5. An Toàn Môi Trường Chạy Độc Lập (Electron vs Web Runtime Safety)

### Phương pháp kiểm tra
- Đối chiếu cấu trúc khởi chạy của `npm start` (`src/main.js`, `src/server/index.js`) và `npm run web` (`src/server/web.js`).
- Đánh giá đường dẫn ghi dữ liệu, phân vùng lưu trữ, chia sẻ cổng mạng, và tài nguyên tiến trình.

### Bảng Phát Hiện & Đánh Giá

| Đường Dẫn Tệp | Số Dòng | Xếp Hạng | Mô Tả Hiện Trạng | Cách Vá Đề Xuất |
| :--- | :---: | :---: | :--- | :--- |
| `src/server/store.js` | 4-5 | **MEDIUM** | Cả hai chế độ `npm start` và `npm run web` đều sử dụng chung một module `store.js` trỏ cố định vào thư mục `server/data/*.json` và `uploads/` trong repo. Nếu người dùng chạy đồng thời cả hai phiên bản trên cùng một máy, các thao tác đọc/ghi file song song sẽ gây xung đột dữ liệu (race conditions). | Cho phép ghi đè đường dẫn thư mục dữ liệu qua biến môi trường (ví dụ `DATA_DIR`), để phiên bản web có thể sử dụng thư mục dữ liệu tách biệt khi cần. |
| `src/server/web.js` | 81-98 | **MEDIUM** | Khi chạy `npm run web`, server tự động kích hoạt tiến trình Telegram Long-Polling (`telegram.startTelegramPolling`). Nếu ứng dụng Desktop cũng đang mở trên cùng một máy tính hoặc máy khác sử dụng chung một `TELEGRAM_BOT_TOKEN`, cả hai bên sẽ liên tục gọi `getUpdates`, dẫn đến lỗi **Telegram Conflict Error 409** và làm gián đoạn tính năng điều khiển từ xa của Admin. | Thêm cờ cấu hình `WEB_TELEGRAM_POLLING=0` để tắt polling trên bản web nếu bản desktop đang nắm quyền điều khiển Telegram, hoặc phân tách 2 bot token riêng biệt. |
| `src/server/web.js`<br>`src/server/index.js` | 69<br>57, 392 | **LOW** | Cả hai chế độ đều có cổng mặc định là `8787`. Nếu chạy đồng thời mà không đổi biến môi trường `PORT`, tiến trình thứ hai sẽ sập ngay lập tức do lỗi `EADDRINUSE`. | Khuyến nghị đặt cổng mặc định của web là `8888` hoặc kiểm tra cảnh báo người dùng đổi `PORT` trong tài liệu hướng dẫn. |
| `src/server/store.js` | 7-10 | **INFO** | **ĐẠT CHUẨN:** Toàn bộ dữ liệu ghi đĩa đều nằm trong phạm vi thư mục của dự án (`server/data` và `uploads`), không có hành vi ghi đè ra ngoài thư mục ứng dụng hay can thiệp vào các tệp tin hệ thống của hệ điều hành. | Giữ nguyên hiện trạng. |

---

## 6. Việc Cần Xử Lý Của Admin (Action Items & Key Rotation)

### Bảng Danh Mục Khóa & Hành Động Cần Quyết Định

| Tên Khóa / Thành Phần | Nơi Từng Xuất Hiện | Xếp Hạng | Lý Do Cần Quay Vòng (Rotation) / Xử Lý | Hành Động Của Admin |
| :--- | :--- | :---: | :--- | :--- |
| **Supabase Anon Key & URL** | Commit `a0d45ed`, `5d3df25` trên `origin/main` (GitHub public) | **HIGH** | Khóa `eyJhbGciOiJIUzI1NiIsInR5cCI6...` của dự án `dbxraxyytegqmzhygosc` đã nằm trên commit công khai của GitHub. Bất kỳ ai cũng có thể đọc và truy vấn trực tiếp vào database Supabase nếu RLS chưa chặt. | **Quyết định quay vòng:** Truy cập Supabase Dashboard, đổi JWT Secret / Anon Key, hoặc xóa project nếu đây là môi trường test cũ không còn sử dụng. |
| **TTS External Tunnel URL & Token** | `src/server/store.js:52`, tài liệu spec `2026-09-21-session-comprehensive-report.md` | **MEDIUM** | Tên miền tunnel `https://rtltbar.abc-tunnel.us` đã được lưu trong tài liệu và code mặc định. Nếu tunnel này còn trỏ về server riêng, kẻ lạ có thể scan và gửi request thử nghiệm. | Kiểm tra xem tunnel còn hoạt động không; nếu còn, đổi token Bearer của dịch vụ TTS và hủy tunnel cũ. |
| **Telegram Bot Token** | `.env` runtime, spec điều khiển 2 chiều | **MEDIUM** | Bot Token cho phép đọc mọi tin nhắn duyệt đơn và gửi tin nhắn mạo danh bot đến Admin. | Khuyến nghị tạo một Bot mới qua `@BotFather` dành riêng cho phiên bản Web, tách biệt với Bot của bản Desktop để tránh lỗi xung đột 409 Conflict. |
| **AI API Key (Gemini / OpenAI)** | `server/data/settings.json` | **MEDIUM** | Khóa API hiện được lưu trong tệp JSON và đang bị trả về nguyên văn qua endpoint `GET /health` và `GET /api/settings`. | Đảm bảo xóa bỏ tệp `settings.json` cục bộ trước khi push, cấu hình khóa qua `.env` trên VPS và duyệt bản vá che giấu key trên API. |
| **WEB_ACCESS_TOKEN** | Môi trường VPS Web mới | **HIGH** | Mã token bảo vệ toàn bộ mặt phẳng web khi public lên Internet. Nếu đặt ngắn hoặc dễ đoán (dưới 16 ký tự), kẻ tấn công có thể brute-force (mỗi phút 10 lần). | Sinh token ngẫu nhiên có độ dài tối thiểu 32 ký tự bằng lệnh `openssl rand -hex 24` khi cấu hình VPS. |
| **Giả định của Admin trong tài liệu cũ** | Spec `2026-10-09-web-version-architecture.md` | **INFO** | Tài liệu ghi nhận: *"Dọn secret trước khi commit, commit local không push"*. Thực tế kiểm tra cho thấy commit local của Phase 1 (`17c804d`, `6ed74af`) hoàn toàn sạch, nhưng commit lịch sử cũ trên remote `origin/main` có chứa secret Supabase cần xử lý dứt điểm. | Admin đối chiếu và phê duyệt kế hoạch làm sạch lịch sử git trước khi thực hiện push mới. |

---

## 7. Kết Luận & Đề Xuất Trình Duyệt Admin

1. **Về mặt kỹ thuật Phase 1:** Kiến trúc bảo vệ mặt phẳng web được xây dựng rất cẩn trọng (Timing-safe, 3-layer whitelist, PostMessage targetOrigin, Lease Epoch Guard, Fail-fast bind).
2. **Các điểm HIGH cần Admin phê chuẩn để giao task sửa (Refactor Task):**
   - **Vá lỗ hổng rò rỉ khóa tại API:** Che giấu `aiApiKey` và `ttsApiKey` trong `GET /health` và `GET /api/settings`.
   - **Kích hoạt chính sách upload:** Import và áp dụng `uploadPolicy.js` vào `multer` trong `src/server/index.js`, đồng thời xóa ngay tệp tạm sau khi xử lý.
   - **Siết chặt cổng kiểm tra Origin tại `src/server/web.js`:** Loại bỏ ngoại lệ `origin === 'null'` trên môi trường web và xác thực `Host` header qua whitelist.
3. **Trước khi thực hiện `git push` hoặc deploy:** Admin xem xét quay vòng khóa Supabase cũ và sinh `WEB_ACCESS_TOKEN` độ an toàn cao.
