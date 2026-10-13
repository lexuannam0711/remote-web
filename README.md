# Pancake Web Bot

> **Dành cho:** Quản trị viên (Admin / Sếp tổng) & Nhóm phát triển  
> **Phiên bản:** Phase 1 (Web Plane & MV3 Extension Bridge — Local Workstation)  
> **Trạng thái:** Tách kho lưu trữ độc lập từ `pancake-desktop-ai-shortcut-bot-v3` (Commit `3cc0749`)  
> **Nguyên tắc bảo mật:** Tài liệu này có thể được công khai (Public Repo). Tuyệt đối không ghi API key, bot token hoặc secret thật vào tài liệu; luôn dùng chuỗi giữ chỗ (placeholder) mẫu `pdb-xxxxxxxx-thay-bang-cua-ban`.

---

## 1. Giới Thiệu & Quan Hệ Với Bản Desktop

### 1.1. Pancake Web Bot là gì?
Pancake Web Bot là giải pháp tự động hóa trả lời tin nhắn, chốt đơn, gọi AI đề xuất phím tắt (`/n`) và đọc thông báo giọng nói (TTS) cho nền tảng hội thoại Pancake (Pages.fm / Pancake.vn), hoạt động hoàn toàn trên trình duyệt thông qua:
1. **Web Dashboard (`web/public/`):** Giao diện quản trị web hiện đại điều khiển bot, cấu hình phím tắt, xem hàng đợi review và nhật ký hoạt động.
2. **Tiện ích mở rộng Chrome MV3 (`extensions/pancake-bot/`):** Cầu nối (Bridge) chạy trực tiếp trong trình duyệt người dùng để quét DOM Pancake, tương tác tin nhắn và giao tiếp hai chiều với Dashboard qua `postMessage` bảo mật.
3. **Máy chủ Web Backend (`src/server/web.js`):** Web API Express cung cấp xác thực phiên làm việc, quản lý khóa chiếm quyền (Bot Lease), che giấu bí mật (Secret Masking) và đồng bộ dữ liệu.

### 1.2. Mối quan hệ với repo desktop (`pancake-desktop-ai-shortcut-bot-v3`)
- **Tách riêng hoàn toàn:** Bản web đã được tách khỏi kho desktop thành repo độc lập này. Cả hai kho hiện tại đều sở hữu bản sao mã nguồn máy chủ trong `src/server/`.
- **Phân kỳ kiến trúc (Divergence) về sau:** Cần nói thẳng rằng hai phiên bản phục vụ hai mô hình vận hành khác nhau:
  - Bản Desktop gắn liền với môi trường Electron, quản lý webview nhúng và bảo mật ứng dụng máy tính.
  - Bản Web độc lập không phụ thuộc Electron, mở đường cho việc đưa Dashboard lên VPS/Cloud và tách rời luồng trình duyệt người dùng qua Extension MV3.
  - Trong tương lai, mã nguồn `src/server/` ở repo web và repo desktop **sẽ phân kỳ** theo yêu cầu tính năng riêng của từng nền tảng.

---

## 2. Chuẩn Bị & Khởi Chạy

### 2.1. Yêu cầu hệ thống & Cài đặt thư viện
- **Node.js:** Yêu cầu Node.js phiên bản **v20 LTS trở lên** (hỗ trợ `node:test`, `node:crypto`, `node:vm` và `Object.hasOwn` [src/server/auth.js:1, 8]).
- Cài đặt các gói phụ thuộc (chỉ dùng các gói khai báo trong `package.json` [package.json:12-24]):
  ```bash
  cd /f/CODE/botcake-v5/pancake-web-bot && npm install
  ```

### 2.2. Khởi tạo cấu hình môi trường
Tạo tệp `.env` tại thư mục gốc từ mẫu `.env.example`:
```bash
cp .env.example .env
```
Cấu hình bắt buộc biến `WEB_ACCESS_TOKEN` (mã token bí mật để đăng nhập Dashboard).

> [!CAUTION]
> Tuyệt đối không dùng token mặc định hoặc token ngắn dễ đoán. Luôn sử dụng token ngẫu nhiên mạnh và không commit file `.env` lên git!

Thiết lập token bằng biến môi trường hoặc ghi vào file `.env`:
- **Linux / macOS / Git Bash:**
  ```bash
  cd /f/CODE/botcake-v5/pancake-web-bot && WEB_ACCESS_TOKEN="pdb-xxxxxxxx-thay-bang-cua-ban" npm run web
  ```
- **Windows PowerShell:**
  ```powershell
  $env:WEB_ACCESS_TOKEN="pdb-xxxxxxxx-thay-bang-cua-ban"
  npm run web
  ```
- **Windows Command Prompt (CMD):**
  ```cmd
  set WEB_ACCESS_TOKEN=pdb-xxxxxxxx-thay-bang-cua-ban
  npm run web
  ```

### 2.3. Mở giao diện Dashboard
Khi server khởi động thành công (`[web] listening on 127.0.0.1:8787` [src/server/web.js:163]):
1. Mở trình duyệt truy cập: [http://localhost:8787](http://localhost:8787)
2. Nếu chưa đăng nhập, hệ thống tự động chuyển hướng sang trang đăng nhập [src/server/web.js:61-62].
3. Nhập token đã cấu hình ở `WEB_ACCESS_TOKEN` để vào Dashboard.

---

## 3. Bản Chất Của Extension Manifest & Cổng Kết Nối

### 3.1. Tại sao Dashboard Bridge chỉ nạp ở `localhost:8787` hoặc `127.0.0.1:8787`?
Trong kiến trúc Chrome Extension Manifest V3 (`extensions/pancake-bot/manifest.json`):
- Thuộc tính `host_permissions` [extensions/pancake-bot/manifest.json:17-18] khai báo:
  ```json
  "http://localhost:8787/*",
  "http://127.0.0.1:8787/*"
  ```
- Thuộc tính `content_scripts[1].matches` [extensions/pancake-bot/manifest.json:40-43] khai báo:
  ```json
  {
    "matches": [
      "http://localhost:8787/*",
      "http://127.0.0.1:8787/*"
    ],
    "js": ["dashboard-bridge.js"],
    "run_at": "document_end"
  }
  ```
**Bản chất:** Trình duyệt Chromium dựa vào khai báo này để quyết định có tiêm tập lệnh `dashboard-bridge.js` vào tab web hay không. Nếu truy cập Dashboard qua cổng khác (ví dụ `:9000`) hoặc qua IP mạng LAN / tên miền VPS (`https://bot.ten-mien-cua-admin.com`), trình duyệt sẽ **từ chối tiêm bridge script**. Khi đó, Dashboard không thể bắt tay với Extension và tính năng tự động hóa không hoạt động.

### 3.2. Muốn đổi cổng (PORT) hoặc tên miền (DOMAIN) thì phải sửa gì?
Nếu Admin muốn đổi cổng hoặc chạy sau tên miền reverse proxy:
1. **Sửa cấu hình môi trường `.env`:**
   - Cập nhật `PORT=<cong_moi>` (ví dụ `PORT=9000`) [src/server/web.js:158].
   - Cập nhật `WEB_ALLOWED_ORIGIN=https://bot.ten-mien-cua-admin.com` [src/server/web.js:35-38, 129].
   - Cập nhật `WEB_ALLOWED_HOSTS=bot.ten-mien-cua-admin.com` [src/server/web.js:31-34].
2. **Tái tạo Manifest của Extension bằng script:**
   Chạy script build extension tích hợp sẵn với tham số `--dashboard` [scripts/build-extension.js:5-18]:
   ```bash
   cd /f/CODE/botcake-v5/pancake-web-bot && node scripts/build-extension.js --dashboard=https://bot.ten-mien-cua-admin.com/*
   ```
   *(Hoặc sửa thủ công cả 2 vị trí `host_permissions` và `content_scripts[1].matches` trong `extensions/pancake-bot/manifest.json`).*
3. **Nạp lại tiện ích mở rộng:** Vào `chrome://extensions` và bấm nút **Reload** để Chrome nạp manifest mới.

---

## 4. Cài Đặt & Cập Nhật Extension MV3

### 4.1. Cài đặt vào trình duyệt Chrome / Brave / Edge
1. Mở trình duyệt và truy cập: `chrome://extensions`
2. Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Bấm nút **Load unpacked** (Tải tiện ích đã giải nén).
4. Chọn đường mục thư mục: `F:/CODE/botcake-v5/pancake-web-bot/extensions/pancake-bot`.
5. Ghim tiện ích **Pancake Bot Bridge** lên thanh công cụ trình duyệt.

### 4.2. Build lại Vendor khi mã nguồn thay đổi
Toàn bộ mã xử lý DOM và tự động hóa trong extension nằm trong `extensions/pancake-bot/vendor/` và được sinh tự động từ `src/renderer/`:
```bash
cd /f/CODE/botcake-v5/pancake-web-bot && node scripts/build-extension.js
```
Script sẽ sao chép các tệp `pancakeDom.js`, `automation.js`, `pancakeUrlPolicy.js` [scripts/build-extension.js:21] và xuất ra manifest hợp lệ. Sau khi chạy lệnh này, chỉ cần reload extension trong `chrome://extensions`.

---

## 5. Bảng 12 Biến Môi Trường Thực Tế

Toàn bộ các biến môi trường thực sự được đọc trong mã nguồn máy chủ Web được đối chiếu trực tiếp từ `src/server/web.js`, `src/server/auth.js` và `src/server/supabaseAuth.js`.

> [!NOTE]
> Kiểm chứng bằng lệnh:
> ```bash
> grep -n -E "env\.[A-Za-z0-9_]+" src/server/web.js src/server/auth.js src/server/supabaseAuth.js
> ```
> Kết quả: Hệ thống đọc chính xác 12 biến dưới đây, không có bất kỳ biến ẩn hay biến thừa nào.

| STT | Tên Biến Môi Trường | Giá Trị Mặc Định | Vị Trí Mã Nguồn | Mô Tả Kỹ Thuật & Tác Dụng |
| :-: | :--- | :--- | :--- | :--- |
| 1 | **`WEB_ACCESS_TOKEN`** | *(Bắt buộc)* | [src/server/web.js:8-9]<br>[src/server/auth.js:25] | Token bí mật bắt buộc dùng để xác thực phiên làm việc Web Dashboard. Nếu thiếu hoặc rỗng, server sẽ ném ngoại lệ dừng khởi động ngay (`fail-fast`) [src/server/web.js:8]. Được băm SHA-256 và so sánh an toàn bằng `crypto.timingSafeEqual` [src/server/auth.js:29, 67]. |
| 2 | **`PORT`** | `8787` | [src/server/web.js:158-159] | Cổng TCP lắng nghe của máy chủ Web. Phải là số nguyên hợp lệ trong khoảng `0 - 65535` [src/server/web.js:159]. Mặc định `8787` ăn khớp với quyền truy cập khai báo trong Extension Manifest [extensions/pancake-bot/manifest.json:17-18]. |
| 3 | **`WEB_BIND_HOST`** | `127.0.0.1` | [src/server/web.js:30, 151] | Địa chỉ IP giao diện mạng máy chủ gắn vào. Mặc định gắn loopback `127.0.0.1` để ngăn truy cập trái phép từ bên ngoài mạng nội bộ. |
| 4 | **`WEB_ALLOW_PUBLIC`** | `0` (hoặc rỗng) | [src/server/web.js:153-157] | Khóa an toàn mở bind mạng ngoài. Nếu `WEB_BIND_HOST` không thuộc loopback (`127.0.0.1`, `localhost`, `::1`) mà `WEB_ALLOW_PUBLIC !== '1'`, máy chủ lập tức từ chối khởi động [src/server/web.js:153-156]. Khi mở công khai thành công, bot tự động bắn cảnh báo qua Telegram [src/server/web.js:167]. |
| 5 | **`WEB_ALLOWED_ORIGIN`** | *(rỗng / undefined)* | [src/server/web.js:35-38, 43, 129] | Whitelist Origin cho bộ lọc CORS và bảo vệ CSRF trên các phương thức ghi dữ liệu (`POST`, `PUT`, `DELETE`) [src/server/web.js:43, 52]. Đồng thời trả về cho client qua API `/api/env` làm `serverUrl` [src/server/web.js:129]. |
| 6 | **`WEB_ALLOWED_HOSTS`** | *(rỗng / undefined)* | [src/server/web.js:31-34] | Danh sách hostname tin cậy (phân cách bằng dấu phẩy) khi triển khai sau reverse proxy (ví dụ `bot.ten-mien-cua-admin.com`), dùng để đối chiếu `Host` header trong cơ chế cùng nguồn gốc [src/server/web.js:44]. |
| 7 | **`WEB_TELEGRAM_POLLING`** | `1` (bật) | [src/server/web.js:175-193] | Kiểm soát việc kích hoạt nhận lệnh Telegram (`getUpdates`) và báo cáo định kỳ. Đặt `0` để tắt polling khi bản desktop đang chạy cùng token (xem chi tiết mục 7). |
| 8 | **`SESSION_TTL_HOURS`** | `72` (giờ) | [src/server/web.js:9]<br>[src/server/auth.js:24, 75] | Thời gian sống của phiên đăng nhập sau khi xác thực thành công. Được quy đổi sang mili-giây và gán vào `Max-Age` của cookie `pdb_session` [src/server/auth.js:39, 75]. |
| 9 | **`PREFERRED_PANCAKE_URL`**| `https://pages.fm/` | [src/server/web.js:129] | Địa chỉ URL Pancake ưu tiên, trả về cho Dashboard và Extension qua API `/api/env` [src/server/web.js:129] để tự động mở tab hội thoại khách hàng. |
| 10 | **`WEB_SUPABASE_URL`** | *(rỗng = tắt)* | [src/server/supabaseAuth.js:15] | URL project Supabase cho đăng nhập người dùng. Chỉ chấp nhận `https://*.supabase.co|in`, không userinfo, không path lạ (chặn trỏ bí mật tới host lạ). Kèm `WEB_SUPABASE_ANON_KEY` bật chế độ bootstrap/active (xem mục 5b). |
| 11 | **`WEB_SUPABASE_ANON_KEY`** | *(rỗng = tắt)* | [src/server/supabaseAuth.js:16] | Anon key (public theo thiết kế Supabase) dùng để server verify `access_token` qua `GET /auth/v1/user`. TUYỆT ĐỐI không dùng service key trong repo này. |
| 12 | **`WEB_PDB_EMERGENCY`** | `0` | [src/server/supabaseAuth.js:87] | Break-glass: `1` cho phép quay lại đăng nhập bằng `WEB_ACCESS_TOKEN` khi Supabase không dùng được; phiên pdb lúc đó là quyền chủ. Mặc định `0` — sau bootstrap, pdb bị chặn `410`. |

---

## 5b. Đăng Nhập Supabase & pdb Chỉ Dán 1 Lần

Máy trạng thái 3 chế độ (state lưu ở `server/data/supabase.json`, đã gitignore):

1. **`unconfigured`** — thiếu 2 biến mục 10+11: hành vi cũ 100% (đăng nhập `WEB_ACCESS_TOKEN`).
2. **`bootstrap`** — đủ 2 biến nhưng **chưa** có chủ: trang đăng nhập yêu cầu dán **pdb 1 lần duy nhất** + email/mật khẩu Supabase. Mật khẩu chỉ đi thẳng từ trình duyệt lên Supabase (password grant); server của ta chỉ nhận `access_token` đã verify. Thành công → bind tài khoản đó làm **owner**, cấp session, pdb nghỉ hưu.
3. **`active`** — mọi máy khác chỉ cần tài khoản Supabase. `POST /api/auth/login` trả `410`; đặt `WEB_PDB_EMERGENCY=1` để cứu cánh khi Supabase sập.

**Người dùng mới**: đăng nhập đúng Supabase nhưng chưa được duyệt → hệ thống ghi vào hàng đợi `pending` và từ chối phiên (`403`). Owner mở card **"Người dùng được phép"** trong Dashboard để Duyệt/Từ chối. Không có chế độ tự duyệt, owner không thể tự gỡ quyền chính mình.

**Điều kiện cần (Admin làm 1 lần):** tạo project Supabase mới, bật provider **Email/Password** trong Authentication → Providers, tạo tài khoản owner, rồi điền `WEB_SUPABASE_URL` + `WEB_SUPABASE_ANON_KEY` vào `.env` (không commit).

---

## 6. Lệnh Kiểm Thử & Kết Quả Kỳ Vọng

Toàn bộ quy trình kiểm thử đều chạy tự động và độc lập, không yêu cầu mở Electron:

### 6.1. Kiểm tra cú pháp (Syntax Check)
```bash
cd /f/CODE/botcake-v5/pancake-web-bot && npm run check
```
- **Phạm vi:** Kiểm tra cú pháp toàn bộ 30 tệp nguồn JavaScript [package.json:8].
- **Kỳ vọng:** Thoát với mã **Exit Code 0** (không có lỗi cú pháp).

### 6.2. Kiểm thử đơn vị & Tích hợp (Unit & Integration Tests)
```bash
cd /f/CODE/botcake-v5/pancake-web-bot && npm test
```
- **Phạm vi:** Chạy toàn bộ 20 tệp kiểm thử `test/*.test.js` bằng bộ chạy kiểm thử tích hợp `node --test` [package.json:9].
- **Kỳ vọng:** **214 tests pass, 0 fail, 0 skipped**. Thời gian chạy ~2.6 giây.

### 6.3. Kiểm thử đầu cuối Cầu nối Extension (E2E Bridge Spec)
```bash
cd /f/CODE/botcake-v5/pancake-web-bot && npx playwright test
```
- **Phạm vi:** Kiểm tra luồng bắt tay và trao đổi thông điệp thực giữa Web Dashboard và Extension Bridge MV3 trên trình duyệt Chromium headless thật [test/e2e/web-extension-bridge.spec.js:44].
- **Kỳ vọng:** **1 passed**, thời gian chạy ~7-8 giây.

> [!WARNING]
> Không chạy đồng thời `npm test` và `npx playwright test` vì bài kiểm thử E2E sẽ chiếm dụng cổng `8787` trên loopback.

---

## 7. Xử Lý Xung Đột Telegram (`WEB_TELEGRAM_POLLING=0`)

### 7.1. Khi nào bắt buộc phải đặt `WEB_TELEGRAM_POLLING=0`?
Khi Quản trị viên cho chạy song song **bản Desktop** (`npm start`) và **bản Web** (`npm run web`) trên cùng máy tính hoặc khác máy nhưng cấu hình **cùng một `TELEGRAM_BOT_TOKEN`**.

### 7.2. Hậu quả nếu không đặt:
1. **Lỗi HTTP 409 Conflict:** Telegram Bot API sử dụng cơ chế HTTP Long Polling (`getUpdates`). Mỗi bot token chỉ cho phép đúng một tiến trình kết nối nhận cập nhật tại một thời điểm. Hai bên cùng poll sẽ tranh chấp và liên tục bị văng lỗi `409 Conflict`.
2. **Báo cáo hàng ngày bị nhân đôi:** Cả hai bên đều lập lịch gửi báo cáo tự động `scheduleDailyReport` [src/server/web.js:180], dẫn đến tin nhắn báo cáo gửi lên nhóm Telegram bị lặp lại 2 lần.

### 7.3. Cách cấu hình:
Trong tệp `.env` của bản Web, cấu hình:
```env
WEB_TELEGRAM_POLLING=0
```
Khi đó, server Web sẽ log dòng thông báo:  
`[web] WEB_TELEGRAM_POLLING=0 — remote control stays with the desktop app` [src/server/web.js:192],  
nhường toàn bộ quyền nhận lệnh Telegram (`/status`, `/baocao`, duyệt review queue) và báo cáo định kỳ cho bản Desktop.

> [!IMPORTANT]
> **Xung đột cổng 8787 giữa hai repo:** bản Desktop (`npm start` trong `pancake-desktop-ai-shortcut-bot-v3`) và bản Web (`npm run web` ở đây) **đều mặc định cổng 8787**. Muốn chạy song song trên cùng máy: giữ Web ở 8787 (Manifest khóa dashboard-bridge vào đúng cổng này [extensions/pancake-bot/manifest.json:17-18]) và đặt `PORT` khác cho bản Desktop qua file `.env` của repo đó. Chạy cùng lúc không được thì một bên sẽ nhận `EADDRINUSE`.

---

## 8. Hướng Dẫn Triển Khai VPS Linux

Tài liệu hướng dẫn triển khai hệ thống Pancake Web Bot lên máy chủ ảo VPS Linux (Ubuntu / Debian / Rocky Linux) phục vụ truy cập qua mạng Internet hoặc mạng nội bộ công ty.

### 8.1. Kiến Trúc Vận Hành & Hai Lỗi Gốc Cần Khắc Phục

**Mô hình kiến trúc:**
- **Mặt tiền (Frontend / Reverse Proxy):** Caddy hoặc Nginx lắng nghe cổng 80/443 với tên miền riêng (ví dụ `https://bot.ten-mien-cua-admin.com`), đảm nhiệm cấp phát chứng chỉ SSL/TLS và chuyển tiếp (reverse proxy) tới cổng nội bộ `127.0.0.1:8787`. Proxy bắt buộc gửi header `X-Forwarded-Proto: https`.
- **Máy chủ Backend (`src/server/web.js`):** Luôn giữ cấu hình `WEB_BIND_HOST=127.0.0.1` (giao diện loopback cục bộ). Vì proxy đóng vai trò mặt tiền tiếp nhận mọi kết nối bên ngoài, hệ thống **KHÔNG cần bật** `WEB_ALLOW_PUBLIC=1`.
- **Máy trạm nhân viên (Client Workstations):** Trình duyệt Chrome của từng nhân viên truy cập Web Dashboard qua HTTPS và nạp Extension MV3 (`extensions/pancake-bot`) để kết nối tự động hóa với tab Pancake (`pages.fm`).

**Hai lỗi gốc khi truy cập từ máy khác (đã chẩn đoán & giải pháp):**
1. **Extension Bridge không hoạt động:** Tiện ích mở rộng mặc định chỉ khai báo khớp `http://localhost:8787/*` và `http://127.0.0.1:8787/*` [extensions/pancake-bot/manifest.json:17-18, 41-42]. Khi nhân viên mở Dashboard bằng tên miền VPS (`https://bot.ten-mien-cua-admin.com`), Chrome từ chối tiêm `dashboard-bridge.js`. Khắc phục bằng cách chạy script build extension với tham số `--dashboard` tương ứng tên miền (xem mục 8.4).
2. **Lỗi HTTP 403 Forbidden trên các request ghi:** Cơ chế CSRF Gate [src/server/web.js:43-44, 116] sẽ từ chối toàn bộ request thay đổi dữ liệu (`POST`, `PUT`, `DELETE`) nếu `Host` hoặc `Origin` của tên miền VPS chưa được khai báo trong `WEB_ALLOWED_ORIGIN` hoặc `WEB_ALLOWED_HOSTS`. Khắc phục bằng cách cấu hình đúng whitelist trong file `.env` (xem mục 8.2).

> [!CAUTION]
> **CẢNH BÁO: CHỈ CHẠY MỘT TIẾN TRÌNH DUY NHẤT (SINGLE PROCESS ONLY)**
> Cơ chế chiếm quyền điều khiển bot (`Bot Lease`) được thiết kế lưu trữ trong bộ nhớ in-memory của tiến trình [src/server/auth.js:115: *"process-local soft lease; use a DB for multiple server processes"*]. Do đó, máy chủ **BẮT BUỘC chỉ chạy đúng 1 tiến trình duy nhất** thông qua systemd service. **TUYỆT ĐỐI KHÔNG** sử dụng PM2 cluster mode (`instances: 'max'`) hoặc chạy song song nhiều worker/instance, vì sẽ làm gãy cơ chế khóa lease và gây xung đột gửi đúp tin nhắn giữa các máy nhân viên.

---

### 8.2. Checklist Cấu Hình Biến Môi Trường (`.env`) Trên VPS

Sao chép `.env.example` thành `.env` trên VPS và thiết lập các biến sau:

| Tên Biến | Giá Trị Khuyến Nghị Trên VPS | Giải Thích & Tác Dụng |
| :--- | :--- | :--- |
| **`WEB_BIND_HOST`** | `127.0.0.1` | Giữ server lắng nghe loopback nội bộ; không mở trực tiếp ra ngoài Internet vì reverse proxy là mặt tiền công khai. Không cần đặt `WEB_ALLOW_PUBLIC=1`. |
| **`PORT`** | `8787` | Cổng TCP nội bộ Express server lắng nghe, khớp với cổng proxy_pass của reverse proxy. |
| **`WEB_ALLOWED_ORIGIN`** | `https://bot.ten-mien-cua-admin.com` | Whitelist Origin chính thức của Dashboard để vượt qua bộ lọc CSRF Gate (`POST`/`PUT`/`DELETE`) và cấu hình CORS. |
| **`WEB_ALLOWED_HOSTS`** | `bot.ten-mien-cua-admin.com` | Whitelist Host header tin cậy khi request đi qua proxy. Nếu còn truy cập song song bằng địa chỉ IP VPS, thêm IP vào danh sách (phân tách bằng dấu phẩy, ví dụ `bot.ten-mien-cua-admin.com,192.168.1.100`). |
| **`TRUST_PROXY`** | `1` | Sau reverse proxy (Caddy/Nginx), đặt `1` để bộ giới hạn tốc độ đăng nhập (Rate Limiter chống brute force) lấy đúng IP thật của máy client từ header `X-Forwarded-For` thay vì IP loopback của proxy. |
| **`WEB_ACCESS_TOKEN`** | `pdb-xxxxxxxx-thay-bang-cua-ban` | Token bí mật quản trị dùng để bootstrap tài khoản chủ sở hữu (Owner) qua Supabase lần đầu tiên (xem mục 5b / CLAUDE.md mục 7). Sau bootstrap, token này tự động hết hạn sử dụng. |
| **`WEB_SUPABASE_URL`** | `https://<project-ref>.supabase.co` | URL dự án Supabase để xác thực tài khoản nhân viên và chủ sở hữu. |
| **`WEB_SUPABASE_ANON_KEY`**| *(anon key từ Supabase)* | Public anon key của Supabase (chỉ dùng anon key, tuyệt đối không dùng service role key). |
| **`WEB_TELEGRAM_POLLING`** | `1` (hoặc `0`) | Bật `1` để nhận lệnh điều khiển từ xa qua Telegram trên VPS; đặt `0` nếu máy trạm Desktop đang chạy cùng lúc chung một bot token nhằm tránh xung đột HTTP 409 Conflict (xem mục 7). |
| **`SESSION_TTL_HOURS`** | `72` | Thời gian sống của phiên làm việc cookie (mặc định 72 giờ). |

---

### 8.3. Cấu Hình Reverse Proxy (Caddy & Nginx)

Reverse proxy bắt buộc chuyển tiếp header `X-Forwarded-Proto: https` để backend nhận diện đúng giao thức HTTPS, giúp đối chiếu Origin hợp lệ và tự động gắn thuộc tính `Secure` cho cookie phiên làm việc `pdb_session`.

#### Tùy chọn A: Caddy (Khuyến nghị — Cấu hình tối giản & Tự động SSL)
Caddy tự động đăng ký và gia hạn chứng chỉ HTTPS qua Let's Encrypt, đồng thời tự động thiết lập các header chuyển tiếp cần thiết (`X-Forwarded-For`, `X-Forwarded-Proto`):

Tạo hoặc cập nhật file `/etc/caddy/Caddyfile`:
```caddy
bot.ten-mien-cua-admin.com {
    reverse_proxy 127.0.0.1:8787
}
```
Khởi động lại Caddy:
```bash
sudo systemctl reload caddy
```

#### Tùy chọn B: Nginx
Nếu sử dụng Nginx, cấu hình block `server` và `location` chuyển tiếp kèm các header proxy:

Tạo file `/etc/nginx/sites-available/pancake-bot.conf`:
```nginx
server {
    listen 80;
    server_name bot.ten-mien-cua-admin.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name bot.ten-mien-cua-admin.com;

    # Cấu hình chứng chỉ SSL (Let's Encrypt Certbot)
    ssl_certificate /etc/letsencrypt/live/bot.ten-mien-cua-admin.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bot.ten-mien-cua-admin.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Kiểm tra cú pháp và kích hoạt:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

### 8.4. Đóng Gói & Cài Đặt Extension MV3 Cho Tên Miền VPS

#### Bước 1: Build lại extension theo origin của tên miền VPS
Tại máy phát triển hoặc thư mục nguồn, chạy lệnh sau:
```bash
node scripts/build-extension.js --dashboard="https://bot.ten-mien-cua-admin.com/*"
```
> [!IMPORTANT]
> - Cờ `--dashboard` có thể gọi nhiều lần để cộng dồn các origin (ví dụ vừa hỗ trợ localhost vừa hỗ trợ VPS: `node scripts/build-extension.js --dashboard="http://localhost:8787/*" --dashboard="https://bot.ten-mien-cua-admin.com/*"`).
> - Nếu đổi `PORT` hoặc đổi tên miền, bắt buộc phải chạy lại lệnh build trên.
> - **TUYỆT ĐỐI KHÔNG sửa thủ công `manifest.json`** vì `background.js` phụ thuộc nghiêm ngặt vào thứ tự mảng `content_scripts`: phần tử `[0]` là Pancake Bridge và phần tử `[1]` là Dashboard Bridge [scripts/build-extension.js:22]. Việc sửa tay rất dễ làm xáo trộn thứ tự và gây lỗi ngắt cầu nối.

#### Bước 2: 3 bước nạp lại tiện ích trên từng máy nhân viên (Client Workstations)
Sau khi build xong, đóng gói thư mục `extensions/pancake-bot` gửi cho từng nhân viên thực hiện:
1. Mở trình duyệt Chrome / Brave / Edge và truy cập vào đường dẫn: `chrome://extensions`.
2. Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Bấm nút **Load unpacked** (Tải tiện ích đã giải nén) và chọn thư mục `extensions/pancake-bot`.
   *(Nếu extension đã được nạp từ trước, chỉ cần bấm nút **Reload** 🔄 trên card extension để Chrome cập nhật manifest và bridge mới).*

---

### 8.5. Khởi Tạo Dịch Vụ Systemd Trên VPS

Tạo tệp cấu hình dịch vụ `/etc/systemd/system/pancake-web.service`:
```ini
[Unit]
Description=Pancake Web Bot Backend Server
After=network.target

[Service]
Type=simple
User=botuser
WorkingDirectory=/opt/pancake-web-bot
EnvironmentFile=/opt/pancake-web-bot/.env
ExecStart=/usr/bin/node src/server/web.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Kích hoạt và quản lý tiến trình:
```bash
# Nạp lại cấu hình và kích hoạt tự khởi động cùng hệ thống
sudo systemctl daemon-reload
sudo systemctl enable --now pancake-web.service

# Kiểm tra trạng thái hoạt động
sudo systemctl status pancake-web.service

# Xem nhật ký hoạt động thời gian thực
sudo journalctl -u pancake-web.service -f
```

---

### 8.6. Kiểm Tra & Tự Đánh Giá Từ Máy Lẻ (3 Lệnh Curl Tự Kiểm)

Từ máy tính cá nhân của nhân viên hoặc máy bên ngoài mạng, mở terminal chạy 3 lệnh sau để kiểm tra máy chủ VPS:

1. **Kiểm tra CSRF Gate với Origin hợp lệ (Kỳ vọng: HTTP 200):**
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://bot.ten-mien-cua-admin.com/api/bot-lease \
     -H "Origin: https://bot.ten-mien-cua-admin.com" \
     -H "Content-Type: application/json" \
     -d '{"owner":"test-probe"}'
   ```
   - **Kỳ vọng:** Trả về mã `200`.
   - **Xử lý nếu lỗi:** Nếu nhận `403 Forbidden`, kiểm tra lại xem tên miền đã được khai báo chính xác trong `WEB_ALLOWED_ORIGIN` hoặc `WEB_ALLOWED_HOSTS` trong file `.env` trên VPS chưa.

2. **Kiểm tra luật an toàn chống giả mạo Origin (Kỳ vọng: HTTP 403):**
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://bot.ten-mien-cua-admin.com/api/bot-lease \
     -H "Origin: null" \
     -H "Content-Type: application/json" \
     -d '{"owner":"test-probe"}'
   ```
   - **Kỳ vọng:** Trả về mã `403`.
   - **Giải thích:** CSRF Gate luôn từ chối `Origin: null` (nguồn từ iframe sandboxed hoặc dữ liệu không an toàn). Đây là luật an ninh bắt buộc phải luôn hoạt động.

3. **Kiểm tra trạng thái xác thực hệ thống (Kỳ vọng: HTTP 200 kèm JSON mode):**
   ```bash
   curl -s https://bot.ten-mien-cua-admin.com/api/auth/mode
   ```
   - **Kỳ vọng:** Trả về chuỗi JSON thông tin mode, ví dụ: `{"mode":"bootstrap",...}` hoặc `{"mode":"active",...}`.

---

### 8.7. Ghi Chú Quan Trọng Về Cookie Phiên Làm Việc (`SameSite=Strict`)

- Cookie xác thực phiên làm việc `pdb_session` được cấu hình với chính sách bảo mật nghiêm ngặt `SameSite=Strict` [src/server/auth.js:42] nhằm ngăn chặn hoàn toàn các cuộc tấn công Cross-Site Request Forgery (CSRF).
- **Hành vi theo thiết kế tiêu chuẩn:** Khi người dùng nhấn vào đường link Dashboard từ một trang web bên ngoài hoặc ứng dụng bên thứ ba (ví dụ: bấm link từ tin nhắn Telegram, nhóm Zalo, Facebook Messenger, tài liệu Google Docs...), trình duyệt Chromium/Firefox sẽ **tuyệt đối không gửi kèm cookie `pdb_session`** trong request đầu tiên. Khi đó, server sẽ chuyển hướng người dùng về trang đăng nhập `/api/auth/login`.
- **Cách truy cập chuẩn của nhân viên:** Người dùng phải mở Dashboard bằng cách bấm vào **Bookmark (Dấu trang)** trên trình duyệt hoặc gõ trực tiếp URL `https://bot.ten-mien-cua-admin.com` trên thanh địa chỉ. Đây là cơ chế bảo mật tiêu chuẩn theo thiết kế an ninh của web, hoàn toàn không phải lỗi hệ thống.

---

## 9. Giới Hạn Hiện Tại & Lộ Trình

1. **Chưa nghiệm thu với tài khoản Pancake thực tế:** Hệ thống hiện tại đã hoàn tất kiểm chứng tự động 192/192 test và Playwright E2E giả lập Chromium, nhưng cần bước chạy thực tế có tài khoản Pancake live và phiên đăng nhập thật của nhân viên bán hàng để đánh giá hiệu năng DOM Pancake thời gian thực.
2. **Phase 2 (VPS / Docker Host / Headless Host) chưa được duyệt:** Hiện tại hệ thống được thiết kế chạy cục bộ (Phase 1 Local Workstation). Triển khai trên máy chủ đám mây (VPS/Cloud) cần được Admin đánh giá và phê duyệt độc lập.
3. **Các hạng mục bảo mật đang theo dõi:**
   - Thực hiện đầy đủ các khuyến nghị tại tài liệu `docs/superpowers/specs/2026-10-10-web-security-privacy-review.md`.
   - Giới hạn tải tệp tin Excel qua `uploadPolicy.js` [src/server/uploadPolicy.js:1].
   - Ẩn danh hóa số điện thoại và địa chỉ khách hàng trong `logs.json` trước khi ghi lưu trữ lâu dài.
