# Huong Dan Su Dung Tren VPS

Tai lieu danh cho Admin van hanh Pancake Web Bot sau khi da trien khai tren VPS Linux.

## 1. Nguyen tac bat buoc

- Chay dung **mot** tien trinh Node.js.
- Dat backend sau Caddy/Nginx; bind noi bo tai `127.0.0.1:8787`.
- Chi bat `TRUST_PROXY=1` khi reverse proxy duoc kiem soat.
- Khong ghi `WEB_ACCESS_TOKEN`, khoa AI hoac secret khac vao Git, log, anh chup man hinh.
- Moi may nguoi dung phai truy cap cung origin da dung de build extension.

## 2. Kiem tra nhanh

```bash
sudo systemctl status pancake-web.service --no-pager
curl -fsS http://127.0.0.1:8787/health
curl -fsS https://bot.example.com/api/auth/mode
```

Neu health loi, xem log truoc khi restart. Neu HTTPS tra `403`, kiem tra `WEB_ALLOWED_ORIGIN` va `WEB_ALLOWED_HOSTS`.

## 3. Quan ly dich vu

```bash
sudo systemctl start pancake-web.service
sudo systemctl stop pancake-web.service
sudo systemctl restart pancake-web.service
sudo systemctl enable pancake-web.service
sudo systemctl daemon-reload
```

Xac nhan khong chay them Node/PM2:

```bash
pgrep -af 'node.*src/server/web.js'
```

## 4. Xem log

```bash
sudo journalctl -u pancake-web.service -n 100 --no-pager
sudo journalctl -u pancake-web.service -f
```

Tim nhanh loi thuong gap:

```bash
sudo journalctl -u pancake-web.service --since '1 hour ago' | rg -i 'error|failed|listen|csrf|lease|supabase'
```

## 5. Cap nhat phien ban

```bash
cd /opt/pancake-web-bot
git fetch origin
git pull --ff-only origin main
npm ci --omit=dev
npm run check
sudo systemctl restart pancake-web.service
curl -fsS http://127.0.0.1:8787/health
```

Neu buoc kiem tra hoac health that bai, dung tai do; khong tiep tuc cap nhat extension.

## 6. Cap nhat extension

Build theo dung origin Dashboard:

```bash
cd /opt/pancake-web-bot
node scripts/build-extension.js --dashboard='https://bot.example.com/*'
```

Tren tung may nguoi dung:

1. Mo `chrome://extensions`.
2. Bat **Developer mode**.
3. Chon **Load unpacked** hoac bam **Reload**.
4. Mo Dashboard bang dung `https://bot.example.com`.
5. Kiem tra bridge bao connected truoc khi bat bot.

## 7. Cau hinh reverse proxy

`.env` toi thieu:

```dotenv
WEB_BIND_HOST=127.0.0.1
WEB_PORT=8787
WEB_ALLOWED_ORIGIN=https://bot.example.com
WEB_ALLOWED_HOSTS=bot.example.com
TRUST_PROXY=1
```

Proxy phai truyen cac header chuan:

- `Host`
- `X-Forwarded-For`
- `X-Forwarded-Proto: https`

Cookie phien chi co `Secure` khi request duoc nhan dien HTTPS. Khong expose truc tiep cong `8787` ra Internet.

## 8. Su co thuong gap

| Trieu chung | Kiem tra |
|---|---|
| `502 Bad Gateway` | `systemctl status`, port `8787`, log service |
| `403 Forbidden` khi ghi du lieu | `WEB_ALLOWED_ORIGIN`, `WEB_ALLOWED_HOSTS`, `Origin` |
| Extension khong ket noi | build lai voi `--dashboard`, reload extension |
| Dang nhap bi khoa theo toan bo proxy | `TRUST_PROXY=1`, proxy gui dung `X-Forwarded-For` |
| Bot khong chay sau restart | lease cu, log service, chi giu mot process |
| Telegram bao `409 Conflict` | chi bat `WEB_TELEGRAM_POLLING=1` o mot noi |

## 9. Rollback

```bash
cd /opt/pancake-web-bot
git log --oneline -5
git checkout <commit-an-toan>
npm ci --omit=dev
npm run check
sudo systemctl restart pancake-web.service
curl -fsS http://127.0.0.1:8787/health
```

Khong rollback bang `git reset --hard` khi chua sao luu `.env` va du lieu runtime.

## 10. Checklist sau van hanh

- `systemctl status` bao `active (running)`.
- `/health` tra HTTP `200`.
- Dashboard mo dung HTTPS origin.
- Extension bao connected.
- Dang nhap, lease, thao tac ghi hoat dong.
- Log khong co loi lap lien tuc.
- Chi co mot tien trinh `src/server/web.js`.
