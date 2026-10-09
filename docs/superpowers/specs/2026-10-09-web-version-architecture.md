# Brief Kiến trúc: Phiên bản Web của Pancake Desktop AI Shortcut Bot v3

> Ngày: 2026-10-09. Người duyệt: Admin / Sếp tổng.
> Trạng thái: Phase 1 (extension bridge + web dashboard + auth) — thiết kế chốt, bắt đầu triển khai.
> Quyết định của Admin: triển khai web online (VPS/cloud, truy cập nhiều máy), full parity, dọn secret trước khi commit, commit local không push.

## 1. Vấn đề cốt lõi

App Electron hiện điều khiển Pancake bằng `webview.executeJavaScript` (xem `src/renderer/app.js:240` `executeInTab` và `src/renderer/automation.js` IIFE gán `window.__PDB__`). Trình duyệt web **không thể** đọc/ghi DOM trang khác (same-origin policy). Phiên bản web therefore cần một **AutomationAdapter** thay thế primitive `executeInTab`, phần còn lại giữ nguyên.

Lưu ý quan trọng: thư mục `extensions/pancake/` hiện có là extension CỦA Pancake (Pancake v2, "Provide additional features for Cake Commerce Apps"), KHÔNG phải của ta — không dùng làm cầu nối. Extension bridge của ta là package mới `extensions/pancake-bot/`.

## 2. Nguyên tắc tái sử dụng (đã kiểm chứng)

Các module sau **không phụ thuộc Electron** (0 tham chiếu webview/ipcRenderer/pancakeDesktop), dùng trực tiếp cho cả web:
- `src/renderer/pancakeDom.js` — UMD, gán `window.PDBPancakeDom` (node_modules-style `module.exports` nếu CommonJS).
- `src/renderer/automation.js` — IIFE, gán `window.__PDB__`; tự dùng `window.PDBPancakeDom` và `window.PDBPancakeUrlPolicy`.
- `src/renderer/pancakeUrlPolicy.js` — UMD, gán `window.PDBPancakeUrlPolicy`.
- `src/renderer/botDecision.js`, `conversationClaims.js`, `conversationProcessing.js` — CommonJS/browser-global dual.
- `src/renderer/buyTtsNotifier.js`, `icons.js` — browser global.
- Toàn bộ `src/server/**` — Node thuần, không require('electron').

Phần Electron-only (KHÔNG tái dùng cho web, chỉ giữ cho desktop): `src/main.js`, `src/preload.js`, `src/extensionManager.js`, và lớp webview trong `src/renderer/app.js` / `webviewAutomation.js` / `webviewTabNavigation.js`.

## 3. Kiến trúc Phase 1 — Extension bridge

```
┌─────────────────────┐  HTTPS   ┌──────────────────┐
│  Web dashboard      │─────────▶│  Server Express   │
│  (browser Sếp)      │◀─────────│  (VPS)            │
│  web/public/**      │  REST    │  src/server/**    │
└─────────┬───────────┘          └─────────▲──────────┘
          │ postMessage                    │ REST (Bearer token)
          ▼                                │
┌─────────────────────┐          ┌─────────┴──────────┐
│  Dashboard-bridge   │          │  (agent API tùy     │
│  content script     │          │   chọn triển khai)  │
└─────────┬───────────┘          └────────────────────┘
          │ chrome.runtime.sendMessage
          ▼
┌─────────────────────┐
│  Background service │  định tuyến op tới tab Pancake
│  worker (extension) │  theo bot slot (bot1/bot2)
└─────────┬───────────┘
          │ chrome.tabs.sendMessage
          ▼
┌─────────────────────┐
│  Pancake-bridge     │  content script @ pages.fm/*
│  content script     │  nạp pancakeDom.js + automation.js
│  (chạy __PDB__)     │  → window.__PDB__ thật trong tab Pancake
└─────────────────────┘
```

- **Bot loop vẫn chạy trong dashboard page** (tái dùng logic app.js), primitive `executeInTab(tabId, js)` được thay bằng adapter gọi postMessage → background → pancake content script. Content script Pancake-bridge bơm đúng 2 file `pancakeDom.js` + `automation.js` (build step copy từ `src/renderer/`) nên `window.__PDB__` **giống hệt** bản desktop.
- 2 bot slot như hiện tại (bot1/bot2/manual); extension maps slot → tab Pancake. Lưu ý: cả 2 bot vẫn dùng chung 1 đăng nhập Pancake (giống partition `persist:pancake` hôm nay — hành vi giữ nguyên).
- **Single-leader lease**: khi web truy cập nhiều máy, chỉ 1 dashboard được chạy bot loop. Server giữ `bot_lease` (owner + expire), endpoint acquire/release. Đây là điều kiện bắt buộc chống double-send.

## 4. Giao diện adapter (contract tất cả worker phải theo)

**AutomationAdapter** (dashboard-side, shim cho `window.pancakeDesktop` + `executeInTab`):
- `getEnv()` → `{ serverUrl, pancakeUrl }` (từ `/api/settings` + env).
- `executeInTab(tabId, js)` → trung chuyển qua bridge (chỉ chấp nhận js là tên method `__PDB__` + args, KHÔNG eval chuỗi JS tùy ý — chặt cửa tấn công).
- `listTabs()` → slot bot + trạng thái Pancake tab (connected/missing).

**HTTP agent protocol** (extension → server, nếu cần phase sau): `POST /api/agent/hello`, `GET /api/agent/events?since=<seq>` (long-poll), `POST /api/agent/results`. Auth: `Authorization: Bearer <token>`. Phase 1 dùng trực tiếp dashboard relay, không cần.

**API web mới (T3)** — phục vụ qua **entry riêng `src/server/web.js`** (wrapper của `createApp()`), `npm run web`; `npm start` (desktop) giữ nguyên 100%, `src/server/index.js` không sửa:
- `POST /api/auth/login` `{token}` → HttpOnly cookie (so sánh timing-safe, rate limit).
- `POST /api/auth/logout`, `GET /api/auth/session`.
- `GET /api/env` → `{ serverUrl, pancakeUrl }` (cho shim dashboard, đọc `PREFERRED_PANCAKE_URL`).
- `GET/POST /api/bot-lease` (acquire/release/extend, TTL 60s).
- Static: `express.static('web/public')` tại `/`.
- Env mới: `WEB_ACCESS_TOKEN`, `WEB_BIND_HOST` (mặc định 127.0.0.1), `WEB_ALLOWED_ORIGIN`.

**Bất biến (constraints toàn cục)**:
- KHÔNG đụng `extensions/pancake/` (extension của Pancake).
- KHÔNG thay đổi hành vi Electron hiện tại (desktop phải chạy như cũ).
- Mọi endpoint mới có auth (trừ login + static login page). Không log secret/key đầy đủ (theo mẫu `summarizeAIConfig` mask).
- Không hardcode key nào trong code (fallback env như `resolveAudioConfig`).

## 4bis. Protocol bridge CHÍNH (frozen — gửi cho T1/T2 lúc dispatch, mọi bên theo đúng bản này)

A. page ⇄ dashboard-bridge (`window.postMessage`, `targetOrigin = window.location.origin`, chỉ nhận `e.source === window`):
- page→bridge: `{source:'pdb-page', type:'pdb-call', callId, slot, method, args}` | `{type:'get-slots'}` | `{type:'bridge-ping'}`
- bridge→page: `{source:'pdb-bridge', type:'pdb-result', callId, ok, data|error:{code,message}}` | `{type:'slots-changed', slots}` | `{type:'bridge-ready', slots}` | `{type:'bridge-pong', slots}`
- `slots = [{slot:'bot1'|'bot2'|'manual', tabId, url, lastSeen, connected}]`

B. dashboard-bridge ⇄ background: forward nguyên message A; thêm `{type:'open-pancake-tab'}`.

C. pancake-bridge ⇄ background: tab load → `{type:'tab-hello', url}`; background gán slot bot1→bot2→manual (tối đa 3, vượt → `SLOT_FULL`); pdb-call/`{callId, ok, data|error}` trả trực tiếp; đóng tab → nhả slot + broadcast slots-changed; slot persist qua service-worker ngủ/thức bằng `chrome.storage.session`.

D. Mã lỗi fail-closed (chuẩn hóa sau review chéo T5): mã "core" `NO_TAB`, `SLOT_FULL`, `BRIDGE_DISABLED`, `TIMEOUT`, `NAVIGATION`, `DOM_DEGRADED`; mã vận hành bổ sung `BRIDGE_ERROR` (bridge/lỗi không rõ), `METHOD_NOT_ALLOWED`, `INVALID_CALL`, `INVALID_URL`, `UNTRUSTED_SENDER`, `STALE_CONVERSATION` (passthrough từ `__PDB__`). Mọi mã đều kết thúc KHÔNG send/click/gõ; code không bao giờ rỗng (fallback `BRIDGE_ERROR`), message giới hạn 200 ký tự.

E. Whitelist method = đúng danh sách hàm `window.__PDB__` (src/renderer/automation.js); cả 3 lớp kiểm tra; không eval, không chuỗi JS.

## 4ter. Bot-lease contract (frozen — T2 client, T3 server, T4 wiring)

- Client identity: **per-tab** `machineId` (sessionStorage UUID, fallback localStorage khi private mode; fallback random khi http không secure) — hai tab cùng trình duyệt là hai chủ lease khác nhau. Reload trong tab giữ nguyên identity.
- `POST /api/bot-lease` body `{action:'acquire'|'release'|'extend', machineId}`:
  - acquire/extend: trống/hết TTL/mình là chủ → `{ok:true, lease:{owner, expiresAt:ISOMillis}}`; người khác giữ còn hạn → `{ok:false, holder, expiresAt}` (acquire và extend *đồng nhất* khi lease trống/hết hạn — đã chốt sau review T5a; xung đột chủ khác vẫn fail-closed nên chống double-send giữ nguyên).
  - release: chủ → `{ok:true}`; người khác → `{ok:false, holder, expiresAt}`.
- `GET /api/bot-lease` → `{lease:{owner, expiresAt} | null}`.
- TTL 60s; dashboard chạy bot heartbeat `extend` mỗi 20s; mất lease → EMERGENCY STOP tự động, không tự acquire lại. **Epoch guard** (vá T5c): response extend trả về SAU khi mất lease bị bỏ qua hoàn toàn — không thể "hồi sinh" lease.
- Gate T2: fail-closed mọi automation write method (`clickConversationById`, `setReplyText`, `clickSendButton`, `applyTagByName`, `markCurrentConversationUnread`, `clearReplyText`) cho tới khi acquire thành công; read-only không cần lease.
- HTTP: 200 cho mọi response lease (phân biệt qua `ok`); 401 chưa auth; 404 = T3 chưa có (dashboard ẩn cảnh báo, không sập).
- Reverse proxy HTTPS: gate Origin so theo `x-forwarded-proto` (entry đầu tiên nếu comma-list) + `Host`, hoặc cấu hình `WEB_ALLOWED_ORIGIN` tường minh.


## 5. Server security posture (đa máy, internet)

- Bind mặc định giữ 127.0.0.1; chỉ mở khi Admin set `WEB_BIND_HOST` (kèm cảnh báo Telegram `notifySystemAlert` khi mở non-loopback).
- CORS: cho same-origin (dashboard do server phục vụ), Electron null-origin (giữ `isAllowedCorsOrigin`), + `WEB_ALLOWED_ORIGIN` nếu có.
- Login rate-limit (10 lần/phút), cookie HttpOnly+SameSite=Strict, token so sánh timing-safe (sha256 hai vế rồi `crypto.timingSafeEqual`).
- `/api/logs` chứa dữ liệu khách → phải sau auth; review-queue tương tự. Log xoay vòng như hiện tại.
- HTTPS do reverse proxy (Caddy/Nginx) — chạy bằng Docker ở phần deploy (Admin duyệt riêng).

## 6. Phân công Phase 1

| Task | Scope (files) | Giao cho | Acceptance |
|------|---------------|----------|------------|
| T1 | `scripts/build-extension.js`, `extensions/pancake-bot/**` (sinh ra), `test/extension-build.test.js` | Codex worker | build script chạy, manifest MV3 hợp lệ, node --check tất cả file sinh ra, test byte-identity vendored pass |
| T2 | `web/public/**` (shell + shim + adapter, CHƯA gồm bot loop), `test/web-dashboard.test.js` | Codex worker | node --check pass, test framing callId/timeout/env-shim pass, adapter dùng đúng protocol brief §4 |
| T3 | `src/server/web.js`, `src/server/auth.js`, `test/web-server.test.js`, `package.json` (thêm script `web`) | Codex worker | test auth/lease/static/fail-fast pass; `npm test` cũ không hỏng thêm; `src/server/index.js` KHÔNG đổi |
| T4 | Bot loop trên adapter (port `executeInTab` + điều phối slot từ webviewAutomation/webviewTabNavigation sang protocol brief §4) | Claude (sếp — phần suy luận nặng) | loop chạy thật qua extension trên tab Pancake thật (Playwright e2e mock dashboard + fake bridge) |
| T5 | Review chéo (worker review task khác) + tích hợp + verify + báo cáo | Sếp + workers |详见 §8 |

Phase 2 (Playwright server-side headless, cần Admin duyệt hosting): AutomationAdapter thứ hai chạy Chromium trên VPS, tái dùng đúng contract trên. Phase 3: Docker/Caddy deploy.

## 7bis. Quy trình review chéo (Admin yêu cầu)

Sau khi T1/T2/T3 đều `worker_done` và sếp verify đạt, mỗi worker nhận task review ĐỘC LẬP trên sản phẩm của người khác (không review chính mình, không sửa file được review):
- Worker T1 review T3 (an ninh auth/lease: timing-safe, cookie flags, fail-fast bind, rate limit).
- Worker T2 review T1 (an ninh extension: không remote code/eval, host_permissions tối thiểu, protocol đúng brief §4).
- Worker T3 review T2 (đúng protocol, không regression Electron, tái dùng module chuẩn).
Mỗi review trả về danh sách finding: severity + file:line + bằng chứng + đề xuất. Sếp (Claude) quyết định finding nào thành task sửa, tối đa 2 vòng/task.

## 7. Rủi ro đã đánh giá

1. **OAuth Facebook/login từ IP datacenter** — chỉ ảnh hưởng Phase 2; Phase 1 đăng nhập trên máy Sếp như thường.
2. **pages.fm đổi DOM** — như hiện tại, `DOM_DEGRADED` + Telegram alert đã có; extension bridge không thay đổi rủi ro này.
3. **Double-bot từ nhiều máy** — xử bằng bot-lease (T3) + badge "đang bị máy khác giữ".
4. **Token lộ** — cookie HttpOnly, token từ env server, không lưu trong extension storage dạng plaintext nếu tránh được (dùng sessionStorage dashboard, TTL ngắn).
5. **Test boss-skill fail có sẵn** — track riêng, không thuộc scope.
