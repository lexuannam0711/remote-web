# Hướng Dẫn Phát Triển Cho AI Agent — Pancake Web Bot

> **Dành cho:** AI Coding Agents (Claude, Antigravity, Orca Workers)  
> **Repository:** `pancake-web-bot` (tách từ `pancake-desktop-ai-shortcut-bot-v3` tại commit `3cc0749`)  
> **Quyền phê duyệt tối cao:** Admin / Sếp tổng.

---

## 1. Lệnh Kiểm Thử Chuẩn & Kết Quả Kỳ Vọng

Mọi thao tác kiểm thử phải thực thi trực tiếp trong thư mục gốc của repo web:

```bash
# 1. Kiểm tra cú pháp (Syntax Check) — kiểm tra 30 tệp nguồn JavaScript
cd /f/CODE/botcake-v5/pancake-web-bot && npm run check
# Kỳ vọng: Exit code 0, không in ra lỗi.

# 2. Kiểm thử đơn vị & tích hợp (Unit & Integration Tests) — 20 test suites
cd /f/CODE/botcake-v5/pancake-web-bot && npm test
# Kỳ vọng: 208 tests pass, 0 fail, 0 skipped, thời gian ~2.6 giây.

# 3. Kiểm thử đầu cuối (E2E Bridge Spec) — Chromium headless
cd /f/CODE/botcake-v5/pancake-web-bot && npx playwright test
# Kỳ vọng: 1 passed (web-extension-bridge.spec.js), thời gian ~7-8 giây.

# 4. Khởi chạy Web Server cục bộ
cd /f/CODE/botcake-v5/pancake-web-bot && WEB_ACCESS_TOKEN="pdb-xxxxxxxx-thay-bang-cua-ban" npm run web
# Kỳ vọng: Server lắng nghe tại [web] listening on 127.0.0.1:8787.
```

> [!WARNING]
> Tuyệt đối KHÔNG chạy đồng thời `npm test` và `npx playwright test` vì bài kiểm thử E2E chiếm dụng cổng `8787` trên loopback.

---

## 2. Cấu Trúc Kho Mã Nguồn (Repo Layout)

Kho mã nguồn được tổ chức theo kiến trúc một mảng (single-plane) tinh gọn:

```text
pancake-web-bot/
├── .env.example              # Khai báo biến mẫu cho chế độ Web
├── .gitattributes            # Quy định bắt buộc ký tự kết dòng LF
├── package.json              # Khai báo phụ thuộc và npm scripts (web, check, test, test:e2e)
├── playwright.config.js      # Cấu hình Playwright cho E2E bridge test
├── scripts/
│   └── build-extension.js    # Script đóng gói extension MV3 và đồng bộ vendor
├── src/
│   ├── server/               # Backend Express Server & Authentication
│   │   ├── auth.js           # Session auth, timing-safe login, bot lease engine
│   │   ├── supabaseAuth.js   # Đăng nhập Supabase, bootstrap pdb 1 lần, duyệt user
│   │   ├── web.js            # Entry point npm run web, route bảo mật, CORS, CSRF gate
│   │   ├── index.js          # Desktop API adapter & router lõi
│   │   ├── store.js          # Quản lý đọc/ghi cài đặt (server/data/*.json)
│   │   ├── ai.js             # Kết nối Google Gemini API
│   │   ├── telegram.js       # Telegram Bot thông báo và điều khiển từ xa
│   │   ├── tts.js            # Xử lý tổng hợp giọng nói
│   │   ├── rules.js          # Hệ thống luật an toàn và gán nhãn hội thoại
│   │   ├── validators.js     # Kiểm tra tính hợp lệ dữ liệu
│   │   ├── uploadPolicy.js   # Chính sách upload file Excel
│   │   ├── addressLookup.js  # Nhận diện địa chỉ hành chính 3 cấp
│   │   ├── shortcutImporter.js # Nhập phím tắt từ Excel
│   │   └── shortcutMatcher.js  # Đối sánh từ khóa phím tắt
│   └── renderer/             # 8 browser modules — NGUỒN DUY NHẤT (SSOT) cho vendor
│       ├── automation.js
│       ├── botDecision.js
│       ├── buyTtsNotifier.js
│       ├── conversationClaims.js
│       ├── conversationProcessing.js
│       ├── icons.js
│       ├── pancakeDom.js
│       └── pancakeUrlPolicy.js
├── web/
│   └── public/               # Web Dashboard phục vụ client trình duyệt
│       ├── index.html        # Giao diện chính của dashboard
│       ├── style.css         # Bảng kiểu dáng giao diện
│       ├── app.js            # Logic giao diện điều khiển dashboard
│       ├── adapter.js        # Cầu nối PostMessage giao tiếp với extension
│       ├── env.js            # Khởi tạo thông tin môi trường phía client
│       └── vendor/           # Bản sao đồng bộ từ src/renderer/
├── extensions/
│   └── pancake-bot/          # Tiện ích mở rộng Chrome MV3 (Pancake Bot Bridge)
│       ├── manifest.json     # Manifest V3 (quyền host: localhost:8787, pages.fm, pancake.vn)
│       ├── background.js     # Service worker định tuyến tin nhắn giữa tab
│       ├── dashboard-bridge.js # Content script tiêm vào trang Dashboard
│       ├── pancake-bridge.js # Content script tiêm vào tab Pancake
│       ├── popup.html        # Popup giao diện tiện ích
│       ├── popup.js          # Logic điều khiển popup
│       └── vendor/           # Bản sao đồng bộ từ src/renderer/
└── test/                     # Bộ kiểm thử tự động (20 unit/integration tests)
    └── e2e/                  # 4 tệp kiểm thử E2E Playwright và báo cáo
```

---

## 3. Quy Tắc Bắt Buộc Về Vendor & Định Dạng File

1. **Vendor phải Byte-Identical:**
   - Các tệp trong `extensions/pancake-bot/vendor/*` và `web/public/vendor/*` PHẢI giống hệt từng byte với các tệp nguồn tương ứng trong `src/renderer/*` [test/web-dashboard.test.js:12-16].
   - **Sinh tự động bằng script:** Mỗi khi sửa đổi bất kỳ tệp nào trong `src/renderer/`, BẮT BUỘC chạy lệnh:
     ```bash
     cd /f/CODE/botcake-v5/pancake-web-bot && node scripts/build-extension.js
     ```
   - **Tuyệt đối KHÔNG copy tay** mã nguồn giữa các thư mục vendor.
2. **Ký tự kết dòng LF (Line Feed):**
   - Tệp `.gitattributes` [.gitattributes:1-5] đã chốt cấu hình `text eol=lf` cho toàn bộ các định dạng `*.js`, `*.json`, `*.html`, `*.css`, `*.md`.
   - Các công cụ và trình soạn thảo KHÔNG ĐƯỢC chuyển đổi ký tự kết thúc dòng thành CRLF.

---

## 4. Hợp Đồng Bảo Mật Của `npm run web` (Commit `3cc0749`)

Toàn bộ các yêu cầu bảo mật nghiêm ngặt từ bản vá bảo mật commit `3cc0749` phải được duy trì nguyên vẹn:

1. **Che giấu bí mật đệ quy (Recursive Secret Masking):**
   - Mọi phản hồi JSON (`res.json`) từ server đều được quét và che các trường nhạy cảm `SENSITIVE_KEYS = ['aiApiKey', 'ttsApiKey']` đệ quy tới độ sâu 4 tầng [src/server/web.js:75-95, 96-100, 122-126].
   - Giá trị key thật bị xóa thành chuỗi rỗng `''`, đồng thời bổ sung trường `<key>Masked` hiển thị dạng `••••xxxx` (ví dụ `aiApiKeyMasked: '••••1234'`) [src/server/web.js:77-80, 87].
2. **Hợp đồng lưu và xóa khóa (Keep / Clear / Replace):**
   - Khi client gửi `POST` tới các route chứa bí mật (`/api/settings`, `/api/ai/config`) [src/server/web.js:76]:
     - Gửi `''` (chuỗi rỗng), `null` hoặc `undefined`: Server hiểu là **GIỮ NGUYÊN** giá trị cũ đã lưu trữ [src/server/web.js:108-118].
     - Gửi `'CLEAR'`: Server sẽ **XÓA** khóa (`req.body[key] = ''`) [src/server/web.js:107].
     - Gửi chuỗi giá trị mới: Server lưu trữ nguyên văn giá trị mới [src/server/web.js:108].
3. **Thế lại giá trị cho `/api/ai/config`:**
   - Vì route `/api/ai/config` luôn ghi đè bản vá (patch) tường minh, server tự động đọc `store.getSettings()` và thế lại key lưu trữ nếu client gửi chuỗi rỗng [src/server/web.js:113-116]. Nếu không đọc được store, server sẽ trả lỗi HTTP 500 fail-closed [src/server/web.js:117].
4. **Cổng kiểm soát Origin theo danh sách Host tin cậy (CSRF Gate):**
   - Chỉ cho phép các request ghi dữ liệu (`POST`, `PUT`, `DELETE`) từ các Origin tin cậy [src/server/web.js:43-44, 52].
   - Danh sách hostname tin cậy gồm: `127.0.0.1`, `localhost`, `::1`, hostname của `WEB_BIND_HOST`, danh sách từ `WEB_ALLOWED_HOSTS`, và hostname của `WEB_ALLOWED_ORIGIN` [src/server/web.js:30-36].
   - **Tuyệt đối KHÔNG còn chấp nhận `Origin: null`** [src/server/web.js:39-44].
5. **Tiêu đề bảo mật bắt buộc (Security Headers):**
   - Mọi phản hồi HTTP đều gắn các header chống Clickjacking và MIME sniffing [src/server/web.js:47-51]:
     - `Cache-Control: no-store`
     - `X-Frame-Options: DENY`
     - `X-Content-Type-Options: nosniff`
     - `Content-Security-Policy: frame-ancestors 'none'`
6. **Cách ly điều khiển Telegram (`WEB_TELEGRAM_POLLING`):**
   - Toàn bộ luồng khởi tạo Telegram polling và báo cáo định kỳ bị chặn lại nếu `WEB_TELEGRAM_POLLING === '0'` [src/server/web.js:175-193] để tránh lỗi HTTP 409 Conflict khi chạy song song với bản Desktop.

---

## 5. Luật Phép Quản Trị (Admin Authority Rules)

- **Thẩm quyền tối cao:** Admin (Sếp tổng) là người có thẩm quyền quyết định cuối cùng đối với toàn bộ các thay đổi trong repository.
- **Những hành động BẮT BUỘC phải có Admin phê duyệt tường minh:**
  1. `git commit`, `git merge`, `git push`.
  2. Triển khai (Deploy), xuất bản (Publish) hoặc tải gói ứng dụng.
  3. Thay đổi các biến cấu hình bí mật, token, key.
  4. Thực hiện các thao tác mang tính phá hủy (xóa tệp, reset nhánh, dọn dẹp git).
- **Nguyên tắc kho công khai (Public Repo Readiness):**
  - Kho mã nguồn có thể được mở công khai trên GitHub. Tuyệt đối KHÔNG hardcode token, API key, địa chỉ IP mạng nội bộ hoặc dữ liệu khách hàng vào bất kỳ tệp mã nguồn hay tài liệu nào.

---

## 6. Trạng Thái GitNexus

- Repo `pancake-web-bot` đã được đánh chỉ mục GitNexus lần đầu ngày 2026-10-12 sau khi Admin phê duyệt (65 tệp nguồn, ~2.408 symbols, ~4.900 relationships, 196 execution flows). Thư mục `.gitnexus/` tự chứa `.gitignore` nên không lọt vào git.
- Không tự ý thực thi lại lệnh `npx gitnexus analyze` trong repo này vì đây là tác vụ nặng tốn bộ nhớ và thời gian. Chỉ chạy khi Admin có chỉ thị phê duyệt trực tiếp (kể cả cờ `--force`).
- Lưu ý: tool `gitnexus_query` hiện trả kết quả rỗng kèm cảnh báo FTS index thiếu (đã thử `analyze --force` lần 2 vẫn vậy). Các tool `context`, `impact`, `cypher`, `detect_changes` hoạt động bình thường. Khi cần tìm khái niệm, ưu tiên gọi trực tiếp `context`/`impact` theo tên symbol.

---

## 7. Hợp Đồng Đăng Nhập Supabase & Bootstrap pdb

1. **Máy trạng thái 3 chế độ** (`src/server/supabaseAuth.js`, state tại `server/data/supabase.json` — đã bị `.gitignore` chặn):
   - `unconfigured` (thiếu `WEB_SUPABASE_URL` hoặc `WEB_SUPABASE_ANON_KEY`): đăng nhập pdb cổ điển, toàn bộ hành vi cũ giữ nguyên.
   - `bootstrap`: lần đầu phải dán **pdb (1 lần duy nhất)** + tài khoản Supabase → bind owner, ghi state, cấp session. Bootstrap lần hai luôn `410`.
   - `active`: chỉ đăng nhập Supabase (`POST /api/auth/supabase-login`); `POST /api/auth/login` (pdb) trả `410`, trừ break-glass.
2. **Break-glass `WEB_PDB_EMERGENCY=1`**: cấp lại đường pdb khi Supabase sập (có log WARN kiểm toán); phiên pdb được coi là quyền chủ (quản lý được user).
3. **Chỉ dùng anon key** (verify `access_token` qua `GET <url>/auth/v1/user`). TUYỆT ĐỐI không đưa service key vào repo hay mã nguồn. `resolveSupabaseConfig` chỉ chấp nhận `https://*.supabase.co|in`, không userinfo, không path lạ.
4. **access_token / pdb token không bao giờ** được ghi vào `logs.json`, response JSON, hay bất kỳ tệp nào; mật khẩu Supabase chỉ đi thẳng từ trình duyệt lên Supabase, không qua server của ta.
5. **User lạ**: verify hợp lệ nhưng chưa duyệt → tự ghi vào hàng đợi `pending` và bị từ chối phiên (`403 {status:'pending'}`); owner duyệt/từ chối qua `/api/auth/users/decide`. Không có chế độ tự duyệt.
6. **Session cookie giữ nguyên hợp đồng cũ**: `pdb_session`, HttpOnly, SameSite=Strict, Secure khi HTTPS; CSRF gate + 4 security headers + masking vẫn phủ toàn bộ route mới; mọi endpoint đăng nhập mới bị rate-limit theo socket IP như `createAuth.login`.
7. **CSP dashboard** bắt buộc có `connect-src 'self' https://*.supabase.co` (test `web-dashboard.test.js` chặn hồi quy) — trình duyệt gọi thẳng Supabase password grant.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **remote-web** (2602 symbols, 5192 relationships, 203 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/remote-web/context` | Codebase overview, check index freshness |
| `gitnexus://repo/remote-web/clusters` | All functional areas |
| `gitnexus://repo/remote-web/processes` | All execution flows |
| `gitnexus://repo/remote-web/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
