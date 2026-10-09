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

## 5. Bảng 9 Biến Môi Trường Thực Tế

Toàn bộ các biến môi trường thực sự được đọc trong mã nguồn máy chủ Web được đối chiếu trực tiếp từ `src/server/web.js` và `src/server/auth.js`.

> [!NOTE]
> Kiểm chứng bằng lệnh:
> ```bash
> grep -n -E "env\.[A-Za-z0-9_]+" src/server/web.js src/server/auth.js
> ```
> Kết quả: Hệ thống đọc chính xác 9 biến môi trường dưới đây, không có bất kỳ biến ẩn hay biến thừa nào.

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

---

## 6. Lệnh Kiểm Thử & Kết Quả Kỳ Vọng

Toàn bộ quy trình kiểm thử đều chạy tự động và độc lập, không yêu cầu mở Electron:

### 6.1. Kiểm tra cú pháp (Syntax Check)
```bash
cd /f/CODE/botcake-v5/pancake-web-bot && npm run check
```
- **Phạm vi:** Kiểm tra cú pháp toàn bộ 29 tệp nguồn JavaScript [package.json:8].
- **Kỳ vọng:** Thoát với mã **Exit Code 0** (không có lỗi cú pháp).

### 6.2. Kiểm thử đơn vị & Tích hợp (Unit & Integration Tests)
```bash
cd /f/CODE/botcake-v5/pancake-web-bot && npm test
```
- **Phạm vi:** Chạy toàn bộ 20 tệp kiểm thử `test/*.test.js` bằng bộ chạy kiểm thử tích hợp `node --test` [package.json:9].
- **Kỳ vọng:** **192 tests pass, 0 fail, 0 skipped**. Thời gian chạy ~2.3 giây.

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

## 8. Giới Hạn Hiện Tại & Lộ Trình

1. **Chưa nghiệm thu với tài khoản Pancake thực tế:** Hệ thống hiện tại đã hoàn tất kiểm chứng tự động 192/192 test và Playwright E2E giả lập Chromium, nhưng cần bước chạy thực tế có tài khoản Pancake live và phiên đăng nhập thật của nhân viên bán hàng để đánh giá hiệu năng DOM Pancake thời gian thực.
2. **Phase 2 (VPS / Docker Host / Headless Host) chưa được duyệt:** Hiện tại hệ thống được thiết kế chạy cục bộ (Phase 1 Local Workstation). Triển khai trên máy chủ đám mây (VPS/Cloud) cần được Admin đánh giá và phê duyệt độc lập.
3. **Các hạng mục bảo mật đang theo dõi:**
   - Thực hiện đầy đủ các khuyến nghị tại tài liệu `docs/superpowers/specs/2026-10-10-web-security-privacy-review.md`.
   - Giới hạn tải tệp tin Excel qua `uploadPolicy.js` [src/server/uploadPolicy.js:1].
   - Ẩn danh hóa số điện thoại và địa chỉ khách hàng trong `logs.json` trước khi ghi lưu trữ lâu dài.
