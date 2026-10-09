# Sổ Tay Vận Hành Phiên Bản Web Local (Runbook) — Pancake Bot Bridge

> **Dành cho Quản trị viên (Admin)**  
> **Phiên bản:** Phase 1 (Chạy cục bộ trên máy tính cá nhân / Local workstation)  
> **Lưu ý bảo mật:** Tài liệu này dùng cho kho mã nguồn công khai (Public Repo). Tuyệt đối không lưu token/key thật vào tài liệu; luôn sử dụng chuỗi mẫu giữ chỗ (placeholder) định dạng `pdb-xxxxxxxx-thay-bang-cua-ban`.

---

## Mục lục

1. [Chuẩn bị môi trường & Khai báo biến](#1-chuẩn-bị-môi-trường--khai-báo-biến)
2. [Khởi động Web Server Local](#2-khởi-động-web-server-local)
3. [Cài đặt & Cập nhật Extension MV3 (Pancake Bot Bridge)](#3-cài-đặt--cập-nhật-extension-mv3-pancake-bot-bridge)
4. [Quy trình Vận hành Trình duyệt & Quản lý Quyền Bot (Bot Lease)](#4-quy-trình-vận-hành-trình-duyệt--quản-lý-quyền-bot-bot-lease)
5. [Quy trình Kiểm thử Tự động (Verification)](#5-quy-trình-kiểm-thử-tự-động-verification)
6. [Xử lý Sự cố Thường gặp (Troubleshooting)](#6-xử-lý-sự-cố-thường-gặp-troubleshooting)
7. [Danh mục Toàn bộ Biến Môi trường & File Cấu hình Mẫu](#7-danh-mục-toàn-bộ-biến-môi-trường--file-cấu-hình-mẫu)
8. Checklist Nghiệm thu Vận hành Nhanh (mục 8 bên dưới)
9. [Lớp Bảo Mật Bổ Sung (bản vá e058c67) — Admin cần biết](#9-lớp-bảo-mật-bổ-sung-bản-vá-e058c67)

---

## 1. Chuẩn bị môi trường & Khai báo biến

### 1.1. Yêu cầu nền tảng & Cài đặt gói

- **Phiên bản Node.js:** Yêu cầu Node.js phiên bản **v20 LTS trở lên** (khuyến nghị Node v20.x, v22.x hoặc v24.x) do hệ thống sử dụng module kiểm thử tích hợp sẵn `node:test`, `node:crypto`, `node:vm` và tính năng `Object.hasOwn` [src/server/auth.js:1, 8].
  
  Lệnh kiểm tra phiên bản Node.js hiện tại:
  ```powershell
  node -v
  ```
  *(Kỳ vọng: Hiển thị từ `v20.0.0` trở lên, ví dụ `v24.15.0`).*

- **Cài đặt thư viện phụ thuộc:**
  ```powershell
  npm install
  ```
  *(Chỉ cài đặt các gói khai báo trong `package.json`, không cài thêm bất kỳ gói mở rộng nào khác).*

### 1.2. Các biến môi trường thực sự được đọc trong mã nguồn

Đối chiếu trực tiếp từ mã nguồn thực tế của hệ thống qua lệnh kiểm tra `grep -rn "env\." src/server/web.js src/server/auth.js`:

> **Ghi chú kiến trúc:** Module xác thực `src/server/auth.js` là module độc lập (pure / dependency-injected) [src/server/auth.js:24], không đọc `process.env` trực tiếp mà nhận tham số cấu hình được truyền từ `src/server/web.js`. Toàn bộ 7 biến môi trường của chế độ web được xử lý tại `src/server/web.js`:

1. **`WEB_ACCESS_TOKEN`** [src/server/web.js:8-9, src/server/auth.js:24-29, 66-70]
   - **Giá trị mặc định:** Không có (**BẮT BUỘC**).
   - **Tác dụng:** Mã token bí mật dùng để bảo vệ Web Dashboard. Nếu biến này bị thiếu hoặc là chuỗi rỗng, server sẽ lập tức dừng khởi động và ném lỗi `WEB_ACCESS_TOKEN is required for web mode` [src/server/web.js:8]. Token được mã hóa băm SHA-256 và so khớp thời gian thực an toàn bằng `crypto.timingSafeEqual` [src/server/auth.js:29, 67] để chống tấn công phân tích thời gian (timing attacks).
2. **`PORT`** [src/server/web.js:69-70]
   - **Giá trị mặc định:** `8787` (nếu để trống hoặc không khai báo). Phải là số nguyên từ 0 đến 65535 [src/server/web.js:70].
   - **Tác dụng:** Cổng TCP mà Web Server lắng nghe. Cổng mặc định 8787 được cố định để khớp chính xác với khai báo quyền truy cập trong Extension Manifest MV3 (`http://localhost:8787/*`).
3. **`WEB_BIND_HOST`** [src/server/web.js:62-67]
   - **Giá trị mặc định:** `127.0.0.1` (chỉ cho phép kết nối nội bộ từ máy local).
   - **Tác dụng:** Địa chỉ IP giao diện mạng máy chủ gắn vào. Luôn giữ mặc định `127.0.0.1` khi chạy local để ngăn chặn truy cập trái phép từ các thiết bị khác trong mạng nội bộ.
4. **`WEB_ALLOW_PUBLIC`** [src/server/web.js:64]
   - **Giá trị mặc định:** `0` (hoặc rỗng — khóa chế độ công khai).
   - **Tác dụng:** Khóa bảo vệ an toàn (safety gate). Nếu `WEB_BIND_HOST` được đặt sang IP ngoài loopback (không phải `127.0.0.1`, `localhost`, `::1`) mà `WEB_ALLOW_PUBLIC` khác `'1'`, server sẽ từ chối khởi động [src/server/web.js:64-67] nhằm chống rò rỉ dữ liệu.
5. **`WEB_ALLOWED_ORIGIN`** [src/server/web.js:19, 23, 40]
   - **Giá trị mặc định:** Rỗng (undefined). Khi để rỗng, server chỉ chấp nhận origin trùng scheme+host **với Host header thuộc danh sách hostname tin cậy** (loopback, `WEB_BIND_HOST`, `WEB_ALLOWED_HOSTS`, hostname của `WEB_ALLOWED_ORIGIN`) — xem cơ chế mới tại mục 6.4.
   - **Tác dụng:** Whitelist tên miền/origin cho cơ chế CORS và lớp bảo vệ CSRF trên các phương thức ghi dữ liệu (`POST`, `PUT`, `DELETE`) [src/server/web.js:23]. Đồng thời trả về cho client qua API `/api/env` [src/server/web.js:40].
6. **`SESSION_TTL_HOURS`** [src/server/web.js:9, src/server/auth.js:24, 74-75]
   - **Giá trị mặc định:** `72` (tương đương 72 giờ = 3 ngày).
   - **Tác dụng:** Thời gian sống của phiên làm việc sau khi đăng nhập thành công. Được chuyển đổi thành mili-giây cho auth module và thiết lập vào thuộc tính `Max-Age` của cookie `pdb_session` [src/server/auth.js:39, 75]. Các phiên quá hạn sẽ tự động bị xóa khỏi bộ nhớ máy chủ [src/server/auth.js:34].
7. **`PREFERRED_PANCAKE_URL`** [src/server/web.js:40]
   - **Giá trị mặc định:** `'https://pages.fm/'`.
   - **Tác dụng:** Địa chỉ URL Pancake ưu tiên, trả về cho trình duyệt qua API `/api/env` để Dashboard và Extension tự động mở đúng trang hội thoại Pancake.
8. **`WEB_ALLOWED_HOSTS`** [src/server/web.js:30-36] *(thêm từ bản vá bảo mật e058c67)*
   - **Giá trị mặc định:** Rỗng. Danh sách sẵn có luôn gồm `127.0.0.1`, `localhost`, `::1` và hostname của `WEB_BIND_HOST`.
   - **Tác dụng:** Khi chạy sau reverse proxy (Caddy/Nginx), trình duyệt gửi `Host: ten-mien-cua-admin` — phải thêm hostname đó vào đây thì same-origin check mới chấp nhận `Origin`. Cách ghi: phân tách dấu phẩy, có thể kèm port (`bot.example.com`, `bot.example.com:8443`).
   - **Lưu ý:** biến này **không** tự động mở quyền truy cập; vẫn cần `WEB_ALLOWED_ORIGIN` hoặc proxy HTTPS đúng cấu hình ở mục 6.4.
9. **`WEB_TELEGRAM_POLLING`** [src/server/web.js:158-177] *(thêm từ bản vá bảo mật e058c67)*
   - **Giá trị mặc định:** `1` (bật) — bản Web nhận đủ remote-control như Desktop: `/status`, `/baocao`, duyệt review-queue, báo cáo hằng ngày.
   - **Khi nào đặt `0`:** khi bản Desktop (`npm start`) **và** bản Web (`npm run web`) cùng chạy với **một** `TELEGRAM_BOT_TOKEN`. Telegram chỉ cho một long-poll tại một thời điểm — hai bên sẽ liên tục nhận `409 Conflict`, và báo cáo hằng ngày sẽ gửi **hai lần**. Đặt `WEB_TELEGRAM_POLLING=0` cho bên phụ.

---

## 2. Khởi động Web Server Local

### 2.1. Thiết lập biến môi trường và khởi chạy

Quản trị viên có hai cách thiết lập token an toàn:

#### Cách 1: Thiết lập trực tiếp qua biến môi trường dòng lệnh (Khuyến nghị — không lưu token vào ổ đĩa)

- **Trên Windows PowerShell:**
  ```powershell
  $env:WEB_ACCESS_TOKEN="pdb-xxxxxxxx-thay-bang-cua-ban"
  npm run web
  ```

- **Trên Windows Command Prompt (CMD):**
  ```cmd
  set WEB_ACCESS_TOKEN=pdb-xxxxxxxx-thay-bang-cua-ban
  npm run web
  ```

- **Trên Linux / macOS Terminal:**
  ```bash
  WEB_ACCESS_TOKEN="pdb-xxxxxxxx-thay-bang-cua-ban" npm run web
  ```

#### Cách 2: Thiết lập thông qua file `.env` cục bộ

1. Sao chép file cấu hình mẫu `.env.example` thành `.env`:
   ```powershell
   Copy-Item .env.example .env
   ```
2. Mở file `.env` bằng trình soạn thảo văn bản và cập nhật dòng:
   ```ini
   PORT=8787
   WEB_ACCESS_TOKEN=pdb-xxxxxxxx-thay-bang-cua-ban
   WEB_BIND_HOST=127.0.0.1
   WEB_ALLOWED_ORIGIN=
   WEB_ALLOW_PUBLIC=0
   SESSION_TTL_HOURS=72
   PREFERRED_PANCAKE_URL=https://pages.fm/
   ```
   *(Lưu ý: File `.env` đã được cấu hình trong `.gitignore`, tuyệt đối KHÔNG commit file chứa token lên Git).*

3. Khởi động server:
   ```powershell
   npm run web
   ```

**Dấu hiệu khởi động thành công trên màn hình:**
```text
[web] listening on 127.0.0.1:8787
```
*(Nếu Telegram Bot được cấu hình, server sẽ tự động thông báo khởi động và đồng bộ polling theo thiết lập [src/server/web.js:85-98]).*

### 2.2. Tại sao Dashboard-Bridge chỉ nạp ở cổng 8787?

- **Ràng buộc của Chrome Extension Manifest V3:**  
  Trong tệp cấu hình `extensions/pancake-bot/manifest.json`:
  + Thuộc tính `host_permissions` [extensions/pancake-bot/manifest.json:17-18] khai báo tĩnh:
    ```json
    "http://localhost:8787/*",
    "http://127.0.0.1:8787/*"
    ```
  + Thuộc tính `content_scripts[1].matches` [extensions/pancake-bot/manifest.json:40-48] chỉ định script `dashboard-bridge.js` chỉ được phép nạp vào các trang khớp mẫu:
    ```json
    "matches": [
      "http://localhost:8787/*",
      "http://127.0.0.1:8787/*"
    ]
    ```
  + Theo cơ chế bảo mật của trình duyệt Chromium Manifest V3, Content Script sẽ **bị chặn hoàn toàn** và không được nạp nếu Dashboard chạy ở một cổng khác (chẳng hạn 3000 hoặc 8080). Khi đó Dashboard không thể kết nối tới Extension (hàm `adapter.ping()` không nhận được phản hồi).

### 2.3. Hướng dẫn thay đổi cổng (Nếu bắt buộc phải đổi)

Nếu cổng 8787 bị xung đột trên máy, Admin có thể đổi cổng sang một cổng mới (ví dụ `8888`) theo hai bước:

1. **Chạy script build lại extension với cổng mới:**
   ```powershell
   node scripts/build-extension.js --dashboard="http://localhost:8888/*" --dashboard="http://127.0.0.1:8888/*"
   ```
   *(Script [scripts/build-extension.js:9-23] sẽ tự động cập nhật lại các trường `host_permissions` và `content_scripts.matches` trong `extensions/pancake-bot/manifest.json`).*

2. **Khởi động server trên cổng mới:**
   ```powershell
   $env:PORT="8888"
   $env:WEB_ACCESS_TOKEN="pdb-xxxxxxxx-thay-bang-cua-ban"
   npm run web
   ```
3. **Nạp lại extension trên trình duyệt:** Vào `chrome://extensions` và bấm nút **Reload** (Mũi tên xoay vòng) tại tiện ích "Pancake Bot Bridge" để áp dụng manifest mới.

---

## 3. Cài đặt & Cập nhật Extension MV3 (Pancake Bot Bridge)

### 3.1. Các bước nạp extension vào trình duyệt Chrome / Cốc Cốc / Edge

1. Mở trình duyệt Chrome (hoặc Edge / Cốc Cốc / Brave).
2. Nhập vào thanh địa chỉ: `chrome://extensions` và nhấn **Enter**.
3. Bật công tắc **Chế độ dành cho nhà phát triển** (**Developer mode**) ở góc trên bên phải màn hình.
4. Bấm nút **Tải tiện ích đã giải nén** (**Load unpacked**) ở góc trên bên trái.
5. Trong cửa sổ chọn thư mục, điều hướng tới và chọn thư mục:  
   `extensions/pancake-bot`
6. **Kiểm tra trạng thái Service Worker:**
   - Tiện ích **Pancake Bot Bridge** (Phiên bản `1.0.0`) sẽ xuất hiện trong danh sách tiện ích đã cài.
   - Tại mục **Kiểm tra chế độ xem** (Inspect views), click vào liên kết **service worker** (hoặc "Trang nền / Background page").
   - Cửa sổ DevTools riêng của extension sẽ hiện ra. Chọn tab **Console**, đảm bảo không có thông báo lỗi đỏ.
7. **Ghim tiện ích:** Bấm vào biểu tượng Mảnh ghép (Extensions) trên thanh công cụ của Chrome, tìm "Pancake Bot Bridge" và bấm biểu tượng Ghim để dễ dàng quan sát trạng thái.

### 3.2. Khi nào cần build lại extension?

Admin cần chạy lệnh build lại extension khi có bất kỳ sự thay đổi nào ở mã nguồn xử lý tự động hóa trong thư mục `src/renderer/`, cụ thể gồm 3 file nguồn:
- `src/renderer/pancakeDom.js` (Bộ đọc cấu trúc DOM của giao diện Pancake)
- `src/renderer/automation.js` (Bộ điều khiển kịch bản phím tắt và tin nhắn)
- `src/renderer/pancakeUrlPolicy.js` (Bộ quy tắc kiểm tra URL an toàn)

**Lệnh thực hiện build đồng bộ:**
```powershell
node scripts/build-extension.js
```
*(Lệnh này đọc từ `src/renderer/` và ghi đè đồng bộ sang `extensions/pancake-bot/vendor/` đồng thời sinh lại `manifest.json` chuẩn [scripts/build-extension.js:20-25]).*

Sau khi chạy lệnh trên, Admin chỉ cần vào lại `chrome://extensions` và bấm nút **Reload** tại extension.

### 3.3. Tại sao các file vendor phải trùng khớp từng byte (Byte-Identical)?

1. **Bảo toàn tính nhất quán (Parity Guarantee):** Phiên bản Web và phiên bản Electron Desktop dùng chung 100% logic can thiệp DOM và gửi phím tắt trên Pancake. Việc giữ nguyên vẹn mã nguồn giúp loại bỏ nguy cơ phát sinh lỗi không đồng nhất giữa hai nền tảng.
2. **Kiểm tra hồi quy tự động:** Bộ test `test/extension-build.test.js:36` sử dụng lệnh `assert.deepEqual(fs.readFileSync(...vendor), fs.readFileSync(...src/renderer))` để kiểm tra nghiêm ngặt từng byte nội dung. Bất kỳ sai lệch nào (kể cả khoảng trắng hay chú thích) đều khiến quá trình kiểm thử thất bại.
3. **Nguyên tắc "Một nguồn duy nhất" (Single Source of Truth):** Toàn bộ cải tiến chỉ viết tại `src/renderer/`, sau đó đồng bộ sang extension qua script tự động, chống phân hóa mã nguồn.

---

## 4. Quy trình Vận hành Trình duyệt & Quản lý Quyền Bot (Bot Lease)

### 4.1. Quy trình mở phiên làm việc hàng ngày

1. **Bước 1: Khởi động Server**  
   Chạy lệnh `npm run web` (với `WEB_ACCESS_TOKEN` đã cấu hình) trên terminal.
2. **Bước 2: Mở Web Dashboard & Đăng nhập**  
   - Mở trình duyệt Chrome, truy cập: `http://localhost:8787/` (hoặc `http://127.0.0.1:8787/`).
   - Server nhận thấy chưa có phiên đăng nhập sẽ tự động chuyển hướng (Redirect 302) sang trang: `http://localhost:8787/api/auth/login` [src/server/web.js:32-34].
   - Nhập token bí mật (`WEB_ACCESS_TOKEN`) vào ô nhập liệu -> Bấm **Đăng nhập**.
   - Trình duyệt lưu cookie phiên `pdb_session` [src/server/auth.js:75] và chuyển hướng về giao diện Dashboard chính (`/`).
3. **Bước 3: Mở Tab Pancake**  
   - Mở một tab mới trên cùng trình duyệt Chrome truy cập vào `https://pages.fm/` hoặc `https://pancake.vn/` (hoặc bấm nút "Mở Pancake" từ popup của extension).
   - Đăng nhập vào trang quản trị hội thoại của shop như bình thường.
4. **Bước 4: Kiểm tra kết nối trên Popup Extension**  
   - Bấm vào biểu tượng "Pancake Bot Bridge" trên thanh công cụ của Chrome.
   - Popup hiển thị:
     + Trạng thái: Nút **Tắt bridge** (thể hiện cầu nối đang BẬT).
     + Danh sách các slot:
       * **Bot 1:** Hiển thị địa chỉ `https://pages.fm/...` (đã kết nối tab).
       * **Bot 2:** Chưa kết nối (hoặc hiển thị tab Pancake thứ 2 nếu mở).
       * **Thủ công:** Chưa kết nối.
5. **Bước 5: Cấp quyền can thiệp Bot (Bot Lease)**  
   - Giao diện Dashboard quản lý quyền gửi phím tắt tự động thông qua cơ chế **Soft Lease** [src/server/auth.js:93-114].
   - Mỗi tab Dashboard tự sinh một định danh máy `machineId` lưu trong `sessionStorage` của tab đó [web/public/app.js].
   - Tab Dashboard hiện tại sẽ gửi yêu cầu cấp quyền `/api/bot-lease` (hành động `acquire`) [src/server/web.js:43-48].
   - Khi huy hiệu **Lease** trên Dashboard hiển thị trạng thái màu xanh lá cây ("Đang giữ lease"), Dashboard mới có quyền gửi lệnh can thiệp DOM (như điền phím tắt `/1`) sang tab Pancake.
   - Nếu có một máy tính khác hoặc một tab Dashboard khác truy cập, tab đó sẽ bị từ chối với lỗi `BOT_LEASE_REQUIRED` [web/public/app.js] nhằm ngăn chặn việc hai người cùng lúc gửi lệnh can thiệp trùng lặp vào cùng một khách hàng.

### 4.2. Bảng mã lỗi Extension & Cách xử lý từng loại

Khi Dashboard hoặc Extension gặp sự cố, hệ thống sẽ trả về các mã lỗi cụ thể sau:

| Mã lỗi | Nguyên nhân trong mã nguồn | Cách xử lý cho Quản trị viên |
| :--- | :--- | :--- |
| **`NO_TAB`** | Extension không tìm thấy tab Pancake nào đang mở hoặc tab được gán vào slot đó đã bị đóng [extensions/pancake-bot/background.js, test/extension-build.test.js:108]. | Mở một tab trình duyệt mới vào `https://pages.fm/` hoặc `https://pancake.vn/`. Extension sẽ tự động nhận diện và gán lại tab vào slot. |
| **`SLOT_FULL`** | Đã mở quá 3 tab Pancake. Extension giới hạn tối đa 3 slot kết nối (Bot 1, Bot 2, và Manual). Tab thứ 4 trở đi sẽ bị từ chối kết nối [extensions/pancake-bot/background.js, test/extension-build.test.js:99]. | Đóng bớt các tab Pancake không cần thiết trên trình duyệt. Khi đóng bớt tab, extension sẽ tự động giải phóng slot cho các tab mới. |
| **`BRIDGE_DISABLED`** | Cầu nối Extension đang bị tắt trong cài đặt (biến `bridgeEnabled = false` trong local storage của extension) [extensions/pancake-bot/background.js, test/extension-build.test.js:111]. | Bấm vào biểu tượng Extension trên thanh công cụ Chrome, nhấn nút **"Bật bridge"** để kích hoạt lại cầu nối. |
| **`NAVIGATION`** | Tab Pancake đang trong quá trình tải lại trang (F5) hoặc chuyển hướng URL khiến content script tạm thời mất kết nối với background worker [extensions/pancake-bot/background.js, test/extension-build.test.js:214]. | Chờ 2-3 giây để tab Pancake tải xong hoàn toàn trang web. Nếu trang bị treo, nhấn F5 để tải lại; content script sẽ tự động kết nối lại (`tab-hello`). |
| **`METHOD_NOT_ALLOWED`** | Dashboard cố gắng gọi một hàm không nằm trong danh sách whitelist cho phép của `__PDB__` [extensions/pancake-bot/dashboard-bridge.js, background.js]. | Kiểm tra lại phiên bản script; chỉ sử dụng các hàm chính thức do Pancake Bot cung cấp. |
| **`UNTRUSTED_SENDER`** | Yêu cầu gửi đến background xuất phát từ một trang web lạ không nằm trong danh sách whitelist an toàn [extensions/pancake-bot/background.js:103]. | Đảm bảo Dashboard chỉ chạy trên `http://localhost:8787` hoặc `http://127.0.0.1:8787`. |

---

## 5. Quy trình Kiểm thử Tự động (Verification)

Quản trị viên có thể kiểm tra toàn diện chất lượng hoạt động của hệ thống bằng 3 lệnh kiểm thử độc lập sau:

> **Lưu ý đặc biệt cho Admin:** **KHÔNG** chạy lệnh `npm test` toàn bộ vì lệnh này sẽ gọi cả các bài test cũ của Electron Desktop đòi hỏi giao diện màn hình. Chỉ chạy đúng 3 lệnh chuyên biệt dưới đây:

### 5.1. Kiểm tra cú pháp mã nguồn (Syntax Check)

```powershell
npm run check
```
- **Kỳ vọng:** Lệnh duyệt qua toàn bộ 34 tệp mã nguồn chính của ứng dụng và extension; hoàn thành với mã thoát `exit 0` (không có bất kỳ lỗi cú pháp nào).

### 5.2. Chạy bộ Unit Tests chuyên biệt cho Web & Extension

```powershell
node --test test/web-server.test.js test/web-dashboard.test.js test/extension-build.test.js
```
- **Kỳ vọng đầu ra:**
  ```text
  ℹ tests 43
  ℹ suites 0
  ℹ pass 43
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ duration_ms ~900ms - 1500ms
  ```
- **Nội dung kiểm tra:** Xác thực token timing-safe, rate-limiting chống dò mật khẩu, quản lý session cookie, whitelist CORS/Origin, kiểm tra đóng gói MV3, giới hạn slot bot, chuyển trang tab Pancake, và cơ chế Bot Lease.

### 5.3. Chạy kiểm thử End-to-End (E2E) trên trình duyệt Chromium thật

```powershell
npx playwright test test/e2e/web-extension-bridge.spec.js
```
- **Kỳ vọng đầu ra:**
  ```text
  Running 1 test using 1 worker
    ok 1 test\e2e\web-extension-bridge.spec.js:... › real MV3 bridge: DOM calls, lease epoch, whitelist layers, slot limits and reconnect (~4.3s)
    1 passed (~5.7s)
  ```
- **Nội dung kiểm tra:** Tự động khởi động Chromium thật (chế độ ngầm - headless) có nạp Extension MV3 thật; kiểm tra toàn bộ luồng thực tế từ Đăng nhập -> Kết nối Extension Bridge -> Giữ Bot Lease -> Đọc cấu trúc hội thoại Pancake -> Thử nghiệm ngắt kết nối và phục hồi slot.

---

## 6. Xử lý Sự cố Thường gặp (Troubleshooting)

### 6.1. Cổng 8787 bị chiếm dụng (`EADDRINUSE`)

- **Triệu chứng:** Khi chạy `npm run web`, terminal báo lỗi:
  ```text
  Error: listen EADDRINUSE: address already in use 127.0.0.1:8787
  [web] Startup failed
  ```
- **Nguyên nhân:** Có một tiến trình web server chạy trước đó chưa tắt hẳn, hoặc một phần mềm khác đang chiếm cổng 8787.
- **Cách xử lý:**
  + **Cách 1 (PowerShell):**
    ```powershell
    # 1. Tìm mã tiến trình (PID) đang chiếm cổng 8787:
    Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    
    # 2. Buộc dừng tiến trình (thay <PID> bằng số tìm được):
    Stop-Process -Id <PID> -Force
    ```
  + **Cách 2 (CMD):**
    ```cmd
    netstat -ano | findstr 8787
    taskkill /PID <PID> /F
    ```
  + Sau đó chạy lại: `npm run web`.

### 6.2. Lỗi Cookie `Secure` khi truy cập qua địa chỉ IP khác

- **Triệu chứng:** Đăng nhập thành công nhưng lập tức bị đẩy ngược lại trang đăng nhập, hoặc trình duyệt liên tục báo lỗi `Chua dang nhap` [src/server/auth.js:83].
- **Cơ chế trong mã nguồn [src/server/auth.js:38-39]:**
  ```javascript
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return `pdb_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  ```
  Trình duyệt hiện đại (Chrome) quy định: `localhost` và `127.0.0.1` là bối cảnh an toàn (Secure Context). Tuy nhiên, nếu Admin truy cập qua IP mạng LAN (ví dụ `http://192.168.1.15:8787`), thuộc tính `SameSite=Strict` kết hợp việc thiếu HTTPS sẽ khiến trình duyệt từ chối lưu hoặc gửi cookie phiên làm việc. Ngoài ra, nếu có proxy gắn cờ `x-forwarded-proto: https` nhưng kết nối thực tế là HTTP thường, cờ `Secure` sẽ khiến cookie bị trình duyệt khóa.
- **Cách xử lý:**
  + Luôn sử dụng địa chỉ chuẩn trên máy cục bộ: `http://localhost:8787` hoặc `http://127.0.0.1:8787`.
  + Không truy cập qua địa chỉ IP mạng ngoài khi chưa có kết nối HTTPS an toàn.

### 6.3. Lỗi Origin bị từ chối (`Origin khong duoc phep` — 403 Forbidden)

- **Triệu chứng:** Khi bấm Đăng nhập hoặc gửi lệnh từ Dashboard, hệ thống trả về mã lỗi HTTP 403: `{"error": "Origin khong duoc phep"}` [src/server/web.js:23].
- **Cơ chế trong mã nguồn [src/server/web.js:18-24]:**
  Server tích hợp lớp kiểm soát CSRF nghiêm ngặt [src/server/web.js:43-46]: mọi yêu cầu thay đổi dữ liệu (`POST`, `PUT`, `DELETE`) phải có header `Origin` trùng scheme+host **và Host header nằm trong danh sách hostname tin cậy** (`127.0.0.1`, `localhost`, `::1`, `WEB_BIND_HOST`, `WEB_ALLOWED_HOSTS`, hostname của `WEB_ALLOWED_ORIGIN`), HOẶC khớp đúng `WEB_ALLOWED_ORIGIN`. Hai trường hợp sau đây BỊ TỪ CHỐI kể từ bản vá e058c67: `Origin: null` (iframe sandbox / trang `data:`) và Origin phản chiếu theo một `Host` giả mạo (Host Header Injection / DNS rebinding).
- **Cách xử lý:**
  + Kiểm tra xem URL trên trình duyệt có khớp đúng với địa chỉ máy chủ hay không (ví dụ đang mở qua `localhost` nhưng request gửi tới IP khác).
  + Nếu Admin cần dùng một hostname cố định, hãy khai báo biến trong file `.env`:
    ```ini
    WEB_ALLOWED_ORIGIN=http://ten-mien-cua-ban:8787
    ```

### 6.4. Phiên làm việc hết hạn (`401 Chua dang nhap`)

- **Triệu chứng:** Dashboard đang hoạt động bỗng báo lỗi mất kết nối, hoặc sau một đêm quay lại thì bị yêu cầu đăng nhập lại.
- **Cơ chế trong mã nguồn [src/server/web.js:9, src/server/auth.js:32-35, 74]:**
  Mỗi phiên làm việc có thời hạn tối đa được cấu hình bởi `SESSION_TTL_HOURS` (mặc định 72 giờ). Sau thời gian này, hàm dọn dẹp `prune()` sẽ hủy phiên. Ngoài ra, do phiên được lưu tạm trong bộ nhớ RAM (`sessions = new Map()`), mỗi khi server được khởi động lại thì tất cả các phiên cũ đều bị vô hiệu hóa.
- **Cách xử lý:**
  + Truy cập lại `http://localhost:8787/api/auth/login` và nhập lại token.
  + Nếu muốn duy trì phiên lâu hơn (ví dụ 7 ngày), đặt biến `SESSION_TTL_HOURS=168` trong file `.env`.

### 6.5. Quản lý 2 Slot Bot (`bot1`, `bot2`) và Slot Thủ công (`manual`)

- **Triệu chứng:** Mở 2 tab Pancake thì hoạt động bình thường, nhưng tab thứ 3 không tự động gửi phím tắt, hoặc tab thứ 4 báo lỗi `SLOT_FULL`.
- **Cơ chế trong mã nguồn [extensions/pancake-bot/background.js, test/extension-build.test.js:94-99]:**
  Extension phân bổ cố định 3 slot theo thứ tự kết nối:
  + **Slot 1 (`bot1`):** Ưu tiên cho Fanpage 1 chạy tự động.
  + **Slot 2 (`bot2`):** Ưu tiên cho Fanpage 2 chạy tự động.
  + **Slot 3 (`manual`):** Dành riêng cho nhân viên tư vấn hỗ trợ thủ công (không cấp quyền tự động gửi phím tắt để tránh can thiệp nhầm vào khách nhân viên đang chăm sóc).
- **Cách xử lý:** Mở popup extension để kiểm tra slot nào đang gắn với tab Pancake nào. Nếu muốn đổi Fanpage khác thành slot bot, chỉ cần đóng tab Pancake cũ đi.

### 6.6. Tab Pancake điều hướng rời khỏi trang -> Tự động nhả Slot

- **Triệu chứng:** Đang kết nối, bỗng nhiên Dashboard báo `NO_TAB` và popup extension hiển thị slot "Chưa kết nối".
- **Cơ chế trong mã nguồn [extensions/pancake-bot/background.js: tabs.onUpdated, test/extension-build.test.js:115-132]:**
  Nhằm đảm bảo an toàn tuyệt đối cho dữ liệu khách hàng, extension giám sát liên tục sự kiện chuyển trang (`tabs.onUpdated`). Nếu tab Pancake chuyển hướng sang bất kỳ tên miền nào khác ngoài Pancake (không khớp `https://pages.fm/*` hoặc `https://pancake.vn/*`), extension sẽ **ngay lập tức giải phóng (release) slot đó**.
- **Cách xử lý:**
  + Không dùng tab Pancake đang gắn bot để duyệt các trang web khác (Facebook cá nhân, tin tức, v.v.).
  + Nếu lỡ chuyển trang, chỉ cần ấn nút Back quay lại Pancake hoặc mở lại `https://pages.fm/`, extension sẽ tự động nhận diện và kết nối lại slot.

---

## 7. Danh mục Toàn bộ Biến Môi trường & File Cấu hình Mẫu

### 7.1. Bảng tra cứu đầy đủ 9 biến môi trường

| Tên biến môi trường | Giá trị mặc định | Bắt buộc? | Vị trí đọc trong mã nguồn | Ý nghĩa & Tác dụng |
| :--- | :--- | :---: | :--- | :--- |
| **`WEB_ACCESS_TOKEN`** | *(Không có)* | **BẮT BUỘC** | [src/server/web.js:8-9], [src/server/auth.js:25-29] | Token bí mật dùng để xác thực và đăng nhập vào Web Dashboard. So khớp an toàn với SHA-256 qua `crypto.timingSafeEqual`. |
| **`PORT`** | `8787` | Tùy chọn | [src/server/web.js:69-70] | Cổng mạng TCP máy chủ lắng nghe. Khớp với cấu hình Extension MV3 Manifest (`8787`). |
| **`WEB_BIND_HOST`** | `127.0.0.1` | Tùy chọn | [src/server/web.js:62-67] | Địa chỉ IP giao diện mạng máy chủ bind vào. Mặc định chỉ cho phép kết nối nội bộ từ máy local. |
| **`WEB_ALLOW_PUBLIC`** | `0` | Tùy chọn | [src/server/web.js:64] | Chốt an toàn ngăn chặn bind ra ngoài loopback nếu chưa có HTTPS được Admin phê duyệt. |
| **`WEB_ALLOWED_ORIGIN`** | *(Rỗng)* | Tùy chọn | [src/server/web.js:19, 23, 40] | Whitelist tên miền/origin cho CORS, CSRF gate phương thức ghi, và trả về cho client qua `/api/env`. |
| **`SESSION_TTL_HOURS`** | `72` | Tùy chọn | [src/server/web.js:9], [src/server/auth.js:24, 75] | Thời gian sống (tính bằng giờ) của cookie phiên làm việc (`pdb_session`). Quá thời hạn sẽ tự hủy. |
| **`PREFERRED_PANCAKE_URL`** | `https://pages.fm/` | Tùy chọn | [src/server/web.js:40] | Địa chỉ Pancake mặc định trả về cho Dashboard để mở tab tương tác. |
| **`WEB_ALLOWED_HOSTS`** *(mới, e058c67)* | *(Rỗng)* | Tùy chọn | [src/server/web.js:30-36] | Danh sách hostname (dấu phẩy) tin cậy cho gate Origin/CSRF sau reverse proxy. Danh sách sẵn có: loopback + `WEB_BIND_HOST` + hostname của `WEB_ALLOWED_ORIGIN`. |
| **`WEB_TELEGRAM_POLLING`** *(mới, e058c67)* | `1` | Tùy chọn | [src/server/web.js:158-177] | Tắt toàn bộ wiring Telegram trên bản Web khi đặt `0` — dùng khi Desktop và Web cùng chạy một Telegram token (tránh 409 và báo cáo kép). |

### 7.2. Cấu hình mẫu trong tệp `.env.example`

Nội dung chuẩn của tệp `.env.example` trong dự án:

```ini
# Cổng server: cả Web (npm run web) và Desktop (npm start) đều mặc định 8787,
# khớp khai báo http://localhost:8787/* trong Extension MV3 manifest.
PORT=8787
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash
BOT_ENABLED=false
AUTO_SEND_ENABLED=false
SHORTCUT_ONLY_MODE=true
MIN_CONFIDENCE_TO_AUTOSEND=0.75
DEFAULT_NEW_CUSTOMER_SHORTCUT=/1
NEW_CUSTOMER_TAG_NAME=KHÁCH MỚI
BUY_TAG_NAME=Mua hàng
ALLOW_SHORTCUT_AFTER_BUY_INTENT=false
PROCESS_DELAY_MS=3000
SCAN_INTERVAL_MS=2500
PREFERRED_PANCAKE_URL=https://pages.fm/
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Cấu hình Web Mode (npm run web)
# WEB_ACCESS_TOKEN: Token bí mật bắt buộc để đăng nhập Web Dashboard (dùng placeholder pdb-xxxxxxxx-thay-bang-cua-ban)
WEB_ACCESS_TOKEN=
WEB_BIND_HOST=127.0.0.1
WEB_ALLOWED_ORIGIN=
WEB_ALLOWED_HOSTS=
WEB_TELEGRAM_POLLING=1
WEB_ALLOW_PUBLIC=0
SESSION_TTL_HOURS=72
```

---

## 8. Checklist Nghiệm thu Vận hành Nhanh dành cho Admin

Trước khi đưa vào sử dụng thực tế hàng ngày, Admin thực hiện nhanh các bước kiểm tra sau:

- [ ] **Kiểm tra cú pháp:** Chạy `npm run check` -> Báo `exit 0`.
- [ ] **Kiểm tra unit tests:** Chạy `node --test test/web-server.test.js test/web-dashboard.test.js test/extension-build.test.js` -> 43/43 passed.
- [ ] **Kiểm tra E2E:** Chạy `npx playwright test test/e2e/web-extension-bridge.spec.js` -> 1 passed.
- [ ] **Khởi động server:** Khởi chạy `npm run web` -> Hiển thị `[web] listening on 127.0.0.1:8787`.
- [ ] **Đăng nhập Dashboard:** Mở `http://localhost:8787/`, nhập token và vào Dashboard thành công.
- [ ] **Nạp Extension:** Nạp `extensions/pancake-bot`, kiểm tra Service Worker hoạt động không có lỗi đỏ.
- [ ] **Kết nối Tab Pancake:** Mở `https://pages.fm/`, mở popup extension thấy Bot 1 hiển thị địa chỉ trang Pancake.
- [ ] **Kiểm tra Lease:** Huy hiệu Lease trên Dashboard chuyển sang màu xanh ("Đang giữ lease").

---

## 9. Lớp Bảo Mật Bổ Sung (bản vá e058c67)

Bốn thay đổi dưới đây áp dụng **riêng cho mặt Web** (`npm run web`). Bản Desktop (`npm start` / `npm run server`) giữ nguyên hành vi cũ.

### 9.1. API Key không còn hiển thị đầy đủ trên Dashboard

`GET /api/settings` và `GET /health` trả `aiApiKey` / `ttsApiKey` **rỗng** và thêm `aiApiKeyMasked` / `ttsApiKeyMasked` dạng `••••<4 ký tự cuối>` (`src/server/web.js:72-90`). Từ bản vá `0559feb`, việc che áp dụng **đệ quy cho mọi phản hồi JSON** của mặt Web — gồm cả `GET/POST /api/ai/config` (vốn trả key đã resolve từ env), `POST /api/ai/test` (key nằm trong `result.config`) và `GET /api/logs` (key bị replay từ log cũ). Khi lưu settings:

| Giá trị Dashboard gửi lên | Kết quả |
| :--- | :--- |
| Rỗng (mặc định — người dùng không chạm vào ô key) | **Giữ nguyên key đã lưu** (`src/server/web.js:92-101`) |
| Một chuỗi key mới | Lưu chuỗi mới |
| `CLEAR` (gõ đúng 5 ký tự) | **Xóa** key đã lưu |

Hệ quả vận hành: Admin không còn "nhìn thấy" key cũ trên màn hình, chỉ thấy 4 ký tự cuối. Muốn đổi key thì gõ key mới rồi Save; muốn xóa thì gõ `CLEAR` rồi Save.

Với riêng `POST /api/ai/config`: route này luôn ghi đè `aiApiKey` từ body (khác `/api/settings`), nên server tự **thế lại giá trị đang lưu** khi Dashboard gửi chuỗi rỗng — không có cảnh nào "Lưu" mà làm mất key AI. Nếu đọc store thất bại, request trả `500` chứ không âm thầm xóa key.

### 9.2. Gate Origin chặt hơn

`Origin: null` và `Host` giả mạo không còn được chấp nhận cho `POST/PUT/DELETE` (`src/server/web.js:43-46`). Chạy local thông thường không ảnh hưởng; chỉ khi đặt Web sau reverse proxy với hostname riêng mới phải khai `WEB_ALLOWED_HOSTS` (mục 1, biến 8).

### 9.3. Header chống chai trang

Mọi phản hồi Web kèm `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: frame-ancestors 'none'` (`src/server/web.js:38-41`). Không thể nhúng Dashboard vào iframe trang khác — đây là hành vi chủ đích.

### 9.4. Quyền điều khiển Telegram

Mặc định bản Web nhận đủ remote-control. Khi **cả Desktop và Web** cùng chạy với một `TELEGRAM_BOT_TOKEN`, hãy đặt `WEB_TELEGRAM_POLLING=0` ở bên phụ để tránh `409 Conflict` và báo cáo hằng ngày bị gửi hai lần (`src/server/web.js:158-177`).

### 9.5. Việc bảo mật còn treo (chưa làm, cần Admin quyết)

- Rate-limit đăng nhập vẫn đếm theo địa chỉ socket → sau reverse proxy mọi client chung một IP, có thể khóa lẫn (MEDIUM, T3).
- PII khách hàng (tên/SDT/địa chỉ) còn trong `server/data/logs.json` và gửi qua Telegram (MEDIUM, T3).
- `server/data` dùng chung giữa bản Desktop và Web; chưa có `DATA_DIR` tách biệt (MEDIUM, T3).
- **Supabase Anon key + project URL đã nằm trong lịch sử commit công khai** (`a0d45ed` trên `origin/main`) — cần xoay vòng key / soát lại RLS trên console Supabase. Đây là quyết định của Admin, không phải việc code.
- `GET /health` và `GET /api/settings` của **server Desktop không có xác thực** vẫn trả key gốc — chỉ an toàn khi server này không bao giờ bind ra ngoài loopback.
