# Hồ Sơ Tách Kho Lưu Trữ (Repository Migration Log) — Pancake Web Bot

> **Dự án nguồn:** `pancake-desktop-ai-shortcut-bot-v3`  
> **Dự án đích (mới):** `pancake-web-bot`  
> **Thời điểm thực hiện:** 2026-10-10  
> **Mục đích:** Tách phiên bản Web (Web Dashboard + MV3 Extension Bridge + Backend Web API) thành repository độc lập, giải phóng khỏi môi trường Electron và chuẩn bị cho giai đoạn vận hành Web/VPS.

---

## 1. Bối Cảnh Lịch Sử & Các Commit Nền Tảng

Phiên bản Web ban đầu được ươm mầm và phát triển thử nghiệm bên trong kho lưu trữ desktop `pancake-desktop-ai-shortcut-bot-v3`. Quá trình phát triển lũy kế qua các commit quan trọng bên repo desktop:

- **`3ba307f`** — `test(e2e): kiem chung cau noi extension MV3 trong Chromium that`: Xây dựng kịch bản kiểm thử E2E đầu tiên cho cầu nối extension MV3 với Chromium headless.
- **`8a35cf6`** — `docs(web): kiem ke parity desktop vs web (T2) - 1 P0, 4 P1`: Báo cáo đối soát tính năng giữa bản desktop và web.
- **`611c901`** — `docs(web): bao cao quet bao mat/privacy mat phang web (T3)`: Rà soát toàn diện an ninh mạng và quyền riêng tư cho mặt phẳng web.
- **`e058c67`** — `fix(web): boc bao mat mat phang web theo bao cao T3`: Bổ sung kiểm soát CSRF, host header injection, rate limit và phân tách token.
- **`f831c63`** — `fix(server): gan uploadPolicy vao route import-excel (T6)`: Khóa kích thước 5MB và lọc MIME type khi tải tệp Excel lên máy chủ.
- **`53ecbfd`** — `docs(web): so tay van hanh ban web local (T5) + 2 bien moi tu va bao mat`: Biên soạn sổ tay vận hành và bổ sung biến môi trường.
- **`0559feb`** — `fix(web): masking key de quy tren mat web + giu key khi luu /api/ai/config`: Che giấu khóa bí mật (`aiApiKey`, `ttsApiKey`) đệ quy tới 4 cấp và hỗ trợ cơ chế gửi chuỗi rỗng để giữ nguyên khóa.
- **`c3eba4c`** — `fix(web): vá 3 lỗi P1 dashboard (CSP audio, autoplay, duplicate-tab lease)`: Sửa lỗi chính sách CSP audio, phát âm thanh gesture và chống chiếm đoạt lease giữa các tab trùng lặp.
- **`9ab3c73`** — `docs(web): runbook muc 9.1 bao dong masking de quy cua 0559feb`: Cập nhật runbook hướng dẫn hợp đồng lưu/xóa khóa bí mật.

### Sự kiện tách repo:
1. **Khởi tạo repo mới `pancake-web-bot`:**
   - Commit đầu tiên: **`3cc0749`** (`feat: phien ban web tach rieng tu pancake-desktop-ai-shortcut-bot-v3`).
   - Tổng số tệp được theo dõi ban đầu: **77 tệp** (`git ls-files`).
2. **Dọn dẹp repo desktop `pancake-desktop-ai-shortcut-bot-v3`:**
   - Commit dọn dẹp: **`2271675`** (`refactor: tach phien ban web sang repo rieng pancake-web-bot`).
   - Xóa bỏ đúng **35 tệp chỉ-phục-vụ-web**; số tệp được theo dõi giảm từ 134 xuống **99 tệp**.

---

## 2. Bảng Phân Bổ Tệp (3 Cột Chi Tiết)

Bảng phân bổ chi tiết hiện trạng toàn bộ tệp giữa hai kho lưu trữ sau khi tách:

| (a) 35 Tệp DI CHUYỂN Hoàn Toàn (Chỉ có ở `pancake-web-bot`, đã xóa khỏi desktop tại commit `2271675`) | (b) 41 Tệp Được COPY và CẢ HAI Repo Đều Giữ | (c) 58 Tệp CHỈ CÒN Ở DESKTOP (`pancake-desktop-ai-shortcut-bot-v3`) |
| :--- | :--- | :--- |
| **Tài liệu & Specs Web (4 tệp):**<br>• `docs/superpowers/specs/2026-10-09-web-version-architecture.md`<br>• `docs/superpowers/specs/2026-10-10-web-parity-audit.md`<br>• `docs/superpowers/specs/2026-10-10-web-security-privacy-review.md`<br>• `docs/web-version-runbook.md`<br><br>**Extension MV3 Bridge (6 tệp):**<br>• `extensions/pancake-bot/background.js`<br>• `extensions/pancake-bot/dashboard-bridge.js`<br>• `extensions/pancake-bot/manifest.json`<br>• `extensions/pancake-bot/pancake-bridge.js`<br>• `extensions/pancake-bot/popup.html`<br>• `extensions/pancake-bot/popup.js`<br><br>**Vendor của Extension (3 tệp):**<br>• `extensions/pancake-bot/vendor/automation.js`<br>• `extensions/pancake-bot/vendor/pancakeDom.js`<br>• `extensions/pancake-bot/vendor/pancakeUrlPolicy.js`<br><br>**Công cụ build (1 tệp):**<br>• `scripts/build-extension.js`<br><br>**Server Web & Auth Entry (2 tệp):**<br>• `src/server/auth.js`<br>• `src/server/web.js`<br><br>**Web E2E Tests (4 tệp):**<br>• `test/e2e/fixture/web-extension-bridge-server.js`<br>• `test/e2e/fixture/web-extension-bridge.html`<br>• `test/e2e/web-extension-bridge-report.md`<br>• `test/e2e/web-extension-bridge.spec.js`<br><br>**Web Unit/Integration Tests (3 tệp):**<br>• `test/extension-build.test.js`<br>• `test/web-dashboard.test.js`<br>• `test/web-server.test.js`<br><br>**Web Dashboard Public (5 tệp):**<br>• `web/public/adapter.js`<br>• `web/public/app.js`<br>• `web/public/env.js`<br>• `web/public/index.html`<br>• `web/public/style.css`<br><br>**Web Dashboard Vendor (7 tệp):**<br>• `web/public/vendor/botDecision.js`<br>• `web/public/vendor/buyTtsNotifier.js`<br>• `web/public/vendor/conversationClaims.js`<br>• `web/public/vendor/conversationProcessing.js`<br>• `web/public/vendor/icons.js`<br>• `web/public/vendor/pancakeDom.js`<br>• `web/public/vendor/pancakeUrlPolicy.js` | **Cấu hình & Dữ liệu gốc (6 tệp):**<br>• `.env.example`<br>• `.gitignore`<br>• `package-lock.json`<br>• `package.json`<br>• `playwright.config.js`<br>• `server/data/.gitkeep`<br><br>**8 Module Trình Duyệt trong `src/renderer/` (8 tệp - copy vì Dashboard & Vendor cần):**<br>• `src/renderer/automation.js`<br>• `src/renderer/botDecision.js`<br>• `src/renderer/buyTtsNotifier.js`<br>• `src/renderer/conversationClaims.js`<br>• `src/renderer/conversationProcessing.js`<br>• `src/renderer/icons.js`<br>• `src/renderer/pancakeDom.js`<br>• `src/renderer/pancakeUrlPolicy.js`<br><br>**Mã Nguồn Máy Chủ Backend trong `src/server/` (11 tệp - copy cả bộ, trừ web.js và auth.js chỉ có ở web):**<br>• `src/server/addressLookup.js`<br>• `src/server/ai.js`<br>• `src/server/index.js`<br>• `src/server/rules.js`<br>• `src/server/shortcutImporter.js`<br>• `src/server/shortcutMatcher.js`<br>• `src/server/store.js`<br>• `src/server/telegram.js`<br>• `src/server/tts.js`<br>• `src/server/uploadPolicy.js`<br>• `src/server/validators.js`<br><br>**Bộ Kiểm Thử Dùng Chung trong `test/` (16 tệp):**<br>• `test/address-lookup.test.js`<br>• `test/automation-tags.test.js`<br>• `test/bot-decision.test.js`<br>• `test/buy-tts-notifier.test.js`<br>• `test/conversation-claims.test.js`<br>• `test/conversation-processing.test.js`<br>• `test/pancake-dom.test.js`<br>• `test/pancake-url-policy.test.js`<br>• `test/repurchase-orchestration.test.js` *(có khác biệt fixture dòng 21)*<br>• `test/repurchase-policy.test.js`<br>• `test/server-boundary.test.js`<br>• `test/telegram-polling.test.js`<br>• `test/tts.test.js`<br>• `test/upload-policy.test.js`<br>• `test/v4-safety-rules.test.js`<br>• `test/v4-safety-shortcuts.test.js` | **Electron Core & Main Process (6 tệp):**<br>• `src/main.js`<br>• `src/preload.js`<br>• `src/devtoolsPolicy.js`<br>• `src/guestSecurity.js`<br>• `src/automationActivity.js`<br>• `src/extensionManager.js`<br><br>**Desktop UI & Webview Management (5 tệp):**<br>• `src/renderer/app.js`<br>• `src/renderer/index.html`<br>• `src/renderer/style.css`<br>• `src/renderer/webviewAutomation.js`<br>• `src/renderer/webviewTabNavigation.js`<br><br>**Tiện ích mở rộng nhúng cũ cho Electron Webview (15 tệp trong `extensions/pancake/**`):**<br>• `extensions/pancake/manifest.json`<br>• `extensions/pancake/electron-shim.js`<br>• `extensions/pancake/service-worker-loader.js`<br>• `extensions/pancake/sandbox.html`<br>• `extensions/pancake/offscreen.html`<br>• `extensions/pancake/pancext.html`<br>• `extensions/pancake/images/*` (4 tệp PNG)<br>• `extensions/pancake/assets/*` (5 tệp JS)<br>• `extensions/pancake/_locales/en/messages.json`<br><br>**Script, Khởi Động & Tài Liệu Riêng Desktop (19 tệp):**<br>• `setup-claude-boss.ps1`<br>• `start-desktop.bat`<br>• `start-server-only.bat`<br>• `.gitnexusignore`<br>• `AGENTS.md`<br>• `CLAUDE.md`<br>• `PROMPT_GOOGLE_AI_STUDIO_PHASE3.md`<br>• `README.md`<br>• `docs/ai-dev-department.md`<br>• `docs/superpowers/plans/*` (3 tệp plans)<br>• `docs/superpowers/specs/*` (6 tệp specs lịch sử desktop)<br><br>**Kiểm Thử & Fixture Riêng Desktop (13 tệp):**<br>• `test/automation-activity.test.js`<br>• `test/boss-skill.test.js`<br>• `test/devtools-policy.test.js`<br>• `test/guest-security.test.js`<br>• `test/unread-identity-integration.test.js`<br>• `test/webview-automation.test.js`<br>• `test/webview-tab-navigation.test.js`<br>• `test/e2e/blank-webview-lazy-load.spec.js`<br>• `test/e2e/two-bot-webviews.spec.js`<br>• `test/e2e/unread-identity.spec.js`<br>• `test/e2e/fixture/electron-main.js`<br>• `test/e2e/fixture/fixture-server.js`<br>• `test/.gitkeep`<br>• `uploads/.gitkeep` |

> [!NOTE]
> Ngoài 35 tệp chuyển hẳn, repo `pancake-web-bot` còn có thêm tệp `.gitattributes` để khóa cứng quy định `text eol=lf`. Tổng số tệp được theo dõi lúc khởi tạo là 36 + 41 = 77 tệp.

---

## 3. Hai Sai Biệt Chủ Đích Giữa Hai Bản Sao

Mặc dù `src/server/` và 8 module `src/renderer/` được sao chép nguyên vẹn để bảo đảm tính tương thích logic, có **2 sai biệt kỹ thuật chủ đích** bắt buộc phải duy trì:

### Sai biệt 1: Đường dẫn Fixture trong `test/repurchase-orchestration.test.js`
- **Ở repo web (`pancake-web-bot`):**
  Dòng 21 trỏ trực tiếp tới ứng dụng Dashboard Web [test/repurchase-orchestration.test.js:21]:
  ```javascript
  const source = fs.readFileSync(path.join(__dirname, '../web/public/app.js'), 'utf8');
  ```
- **Ở repo desktop (`pancake-desktop-ai-shortcut-bot-v3`):**
  Dòng 21 trỏ tới ứng dụng giao diện Electron [test/repurchase-orchestration.test.js:21]:
  ```javascript
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
  ```
- **Lý do kỹ thuật:** Bản web vận hành bằng `web/public/app.js` (giao diện web phục vụ client), trong khi bản desktop chạy trên `src/renderer/app.js` (giao diện nhúng Electron). Bài kiểm thử cần nạp đúng mã nguồn thực thi của giao diện đích để kiểm tra orchestration mua hàng lại.

### Sai biệt 2: Độc lập xây dựng Vendor từ `src/renderer/` của từng repo
- Mỗi repo sở hữu quy trình build vendor độc lập:
  - Bản web chạy `node scripts/build-extension.js` [scripts/build-extension.js:20-25] để sao chép từ `src/renderer/` nội bộ sang `extensions/pancake-bot/vendor/`.
  - Bản desktop duy trì các bản sao vendor phục vụ cho Electron webview và không gọi chéo sang repo web.
- **Nguyên tắc:** Hai kho mã nguồn tuyệt đối không có phụ thuộc tương hỗ (no cross-repo dependency). Mọi thay đổi trong `src/renderer/` của repo nào phải được build và kiểm thử độc lập trong repo đó.

---

## 4. Số Liệu Nghiệm Thu Tại Thời Điểm Tách Repo

Tất cả các bài kiểm thử đã được chạy thực tế tại thời điểm tách kho lưu trữ (2026-10-10) và ghi nhận kết quả tuyệt đối:

### 4.1. Repo Web mới (`pancake-web-bot`) — Commit `3cc0749`
- **Số tệp theo dõi (`git ls-files`):** **77 tệp**
- **Kiểm tra cú pháp (`npm run check`):** Kiểm tra **29 tệp** mã nguồn JavaScript, hoàn tất với mã **Exit Code 0** [package.json:8].
- **Kiểm thử tự động (`npm test`):** **192 tests pass, 0 fail, 0 skipped** (20 test suites, thời gian chạy ~2.3s) [package.json:9].
- **Kiểm thử E2E Cầu nối Extension (`npx playwright test`):** **1 passed** (Chromium headless, thời gian chạy ~7.8s) [package.json:10, test/e2e/web-extension-bridge.spec.js:44].

### 4.2. Repo Desktop sau dọn dẹp (`pancake-desktop-ai-shortcut-bot-v3`) — Commit `2271675`
- **Số tệp theo dõi (`git ls-files`):** **99 tệp** (giảm đúng 35 tệp từ 134 tệp ban đầu).
- **Kiểm tra cú pháp (`npm run check`):** Kiểm tra **25 mục** mã nguồn Electron & Backend, hoàn tất với mã **Exit Code 0** [package.json:10].
- **Kiểm thử tự động (`npm test`):** **227 tests pass, 0 fail, 0 skipped** (giảm đúng 50 bài kiểm thử phục vụ web so với 277 bài test trước khi tách; toàn bộ 227 test dành riêng cho desktop và server lõi vượt qua hoàn hảo).
