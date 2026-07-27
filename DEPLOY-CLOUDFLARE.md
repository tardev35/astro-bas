# เอาเว็บขึ้น Cloudflare (Workers Static Assets)

คู่มือนี้พาตั้งแต่ `npx wrangler login` จนเว็บขึ้นบนโดเมนจริง
เขียนจากการทำจริงกับ **MAHORANLOTTO** — ทุกข้อผิดพลาดในหัวข้อ "ปัญหาที่เจอจริง" คือของที่เจอมาแล้ว

> 📌 วิธีนี้ **แทนที่** `deploy.ps1` (VPS + SSH) ไม่ใช่ทำคู่กัน
> ตราบใดที่ยังมีแบรนด์อื่นอยู่บน VPS **อย่าเพิ่งปิด VPS**

---

## ทำไมใช้วิธีนี้ ไม่ใช่ R2 + Worker

บทความส่วนใหญ่สอนแบบ **R2 + เขียน Worker เอง** ซึ่ง**ไม่เหมาะกับงานเรา**:

| | Workers Static Assets (วิธีนี้) | R2 + Worker เขียนเอง |
|---|---|---|
| ค่า request | **ฟรี ไม่จำกัด** | ทุก request นับเป็น Worker invocation + ค่า R2 |
| โค้ดที่ต้องเขียน | **ไม่มี** | map path, index.html, content-type, cache, 404, decode URL ไทย |
| เว็บ 15 แบรนด์พังพร้อมกันได้ไหม | ไม่ได้ แยกกันคนละ Worker | **ได้ ถ้าใช้ Worker ตัวเดียวเสิร์ฟทุกโดเมน** |

> "Requests to static assets are free and unlimited"
> — [Cloudflare Workers Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)

**ข้อจำกัดที่ต้องเช็ก** (แผนฟรี): ไม่เกิน **20,000 ไฟล์** ต่อ Worker และไฟล์เดี่ยวไม่เกิน **25 MiB**
เว็บของเราอยู่ที่ ~120 ไฟล์ ไฟล์ใหญ่สุด ~2 MB — ห่างจากเพดานมาก

---

## เตรียมก่อนเริ่ม

1. **บัญชี Cloudflare ที่ยืนยันอีเมลแล้ว** ⚠️ อ่านหัวข้อ "ปัญหาที่เจอจริง ①" ก่อน — ข้อนี้ทำให้เสียเวลามาแล้ว
2. **โดเมนอยู่บน Cloudflare** — nameserver ที่ผู้ให้บริการโดเมนต้องชี้มา Cloudflare แล้ว
3. **Node.js** ติดตั้งแล้ว (ดู [SETUP-NEW-MACHINE.md](SETUP-NEW-MACHINE.md))

---

## ขั้นที่ 1 — login เข้า Cloudflare

```powershell
npx wrangler login
```

- ครั้งแรกจะถามว่าจะติดตั้ง `wrangler` ไหม → ตอบ **y**
- เบราว์เซอร์จะเปิดหน้า Cloudflare ให้กด **Allow**
- กลับมาที่หน้าต่างคำสั่ง จะขึ้นว่า login สำเร็จ

**เช็กว่าติดจริง:**

```powershell
npx wrangler whoami
```

ต้องขึ้นอีเมลกับ Account ID ถ้าขึ้นว่ายังไม่ได้ login ให้ทำข้อ 1 ซ้ำ

> 💡 **ไม่ต้อง `npm i -g wrangler`** — `npx` ดึงตัวล่าสุดมาให้เอง และเลี่ยงปัญหาเวอร์ชันไม่ตรงกันระหว่างเครื่องในทีม

---

## ขั้นที่ 2 — ตั้งค่า `wrangler.toml`

ไฟล์นี้อยู่ที่รากโปรเจกต์แล้ว หน้าตาแบบนี้:

```toml
name = "mahoranlotto"
compatibility_date = "2026-07-27"
workers_dev = false

[assets]
directory = "dist"
not_found_handling = "404-page"
```

| บรรทัด | ความหมาย |
|---|---|
| `name` | **ชื่อ Worker = ตัวตนของ deployment** เปลี่ยนทุกครั้งที่รีแบรนด์ (ดูหัวข้อ "รีแบรนด์รอบหน้า") |
| `compatibility_date` | วันที่ล็อกพฤติกรรม runtime — ใส่วันที่ตั้งค่าครั้งแรก ไม่ต้องขยับบ่อย |
| `workers_dev = false` | **ปิด `*.workers.dev`** — สำคัญมาก อ่านด้านล่าง |
| `directory` | โฟลเดอร์ที่ Astro build ออกมา |
| `not_found_handling` | ให้ URL มั่วได้หน้า 404 จริง **ถ้าไม่ใส่ ทุก URL ผิดจะได้หน้าแรกพร้อม HTTP 200** |

### ⚠️ `workers_dev = false` ห้ามลืม

Cloudflare แถม URL ฟรีให้แบบ `ชื่อ.ซับโดเมน.workers.dev` ซึ่ง**เสิร์ฟเว็บชุดเดียวกันเป๊ะ**
= มีเว็บสาธารณะ 2 ชุดให้ Google เก็บ index = **duplicate content**

ปิดผ่านหน้า dashboard ได้ **แต่ไม่พอ** — ค่า default ของ key นี้คือ `true`
**ถ้าไม่เขียนไว้ในไฟล์ `wrangler deploy` รอบหน้าจะเปิดกลับมาเงียบๆ**

---

## ขั้นที่ 3 — build แล้ว deploy

```powershell
npm run build
npx wrangler deploy
```

ครั้งแรกจะได้ URL ชั่วคราวแบบ `https://<name>.<ซับโดเมน>.workers.dev`
(ถ้าตั้ง `workers_dev = false` แล้ว URL นี้จะปิด — ข้ามไปเช็กที่โดเมนจริงเลย)

---

## ขั้นที่ 4 — ผูกโดเมนจริง (ใช้ Custom Domain เท่านั้น)

**Workers & Pages → เลือก Worker → แท็บ Domains → ปุ่ม `+ Add Domain`**

ใส่โดเมนเปล่าๆ ไม่ต้องมี `www` ไม่ต้องมี `*` ไม่ต้องมี `/*`:

```
mahoranlotto-brand.com
```

Cloudflare จะ**สร้าง DNS record ให้เอง** + ออกใบรับรอง รอ 1-2 นาที

### 🚨 ห้ามใช้ `+ Add Route`

ปุ่ม **Add Route** อยู่ข้างๆ กัน หน้าตาคล้ายกัน แต่**คนละเรื่องกันสิ้นเชิง**:

| | Custom Domain (ถูก) | Route (ผิดสำหรับงานนี้) |
|---|---|---|
| สร้าง DNS ให้ | ✅ อัตโนมัติ | ❌ **ต้องมี record อยู่ก่อน** |
| ครอบโดเมนหลัก | ✅ | ❌ `*.example.com/*` **ไม่ครอบ** `example.com` |
| ใช้เมื่อ | **Worker คือเว็บเอง** ← กรณีเรา | มี origin จริงอยู่ข้างหลัง อยากเอา Worker ไปคั่น |

> เอกสาร Cloudflare: *"If your Worker is your application's origin, use Custom Domains"*

**หลัง add เสร็จ** ไปดูหน้า **DNS records** จะเห็นรายการใหม่ประเภท **`Worker`** มีไอคอนกุญแจ 🔒
(แก้ไม่ได้ ถูกต้องแล้ว) — **อย่าไปสร้าง record ของโดเมนหลักเองเด็ดขาด จะชนกัน**

---

## ขั้นที่ 5 — ทำให้ `www` เด้งมาโดเมนหลัก

ถ้าไม่ทำ คนพิมพ์ `www.` จะเข้าไม่ได้เลย

**5.1 สร้าง DNS record หลอก**
DNS records → **Add record**

| ช่อง | ค่า |
|---|---|
| Type | `A` |
| Name | `www` |
| IPv4 address | `192.0.2.1` |
| Proxy status | **Proxied (เมฆส้ม)** ⚠️ ต้องส้ม |

> `192.0.2.1` เป็น IP สงวนสำหรับเอกสาร ไม่มีเครื่องจริง — **ไม่เคยถูกเรียกถึง** เพราะ
> Cloudflare เด้ง 301 ตั้งแต่ที่ขอบก่อนจะไปหา origin record นี้มีไว้ให้ Cloudflare
> ยอมรับ request ที่ชื่อ `www` เท่านั้น

**5.2 สร้าง Redirect Rule**
**Rules → Redirect Rules → Create rule**

- **When incoming requests match:** `Hostname` `equals` `www.mahoranlotto-brand.com`
- **Then:** Type `Dynamic` · Status **301**
- **Expression:** `concat("https://mahoranlotto-brand.com", http.request.uri.path)`

> ใช้ **Redirect Rules** ไม่ใช่ **Page Rules** — Page Rules เป็นของเก่า โควตาน้อยกว่า
> และ **Page Rule จะไม่ทำงานกับ hostname ที่ผูกเป็น Custom Domain ของ Worker**

---

## ขั้นที่ 6 — ตรวจให้ครบก่อนบอกว่าเสร็จ

```powershell
curl.exe -sI https://mahoranlotto-brand.com/
curl.exe -sI https://www.mahoranlotto-brand.com/
curl.exe -sI https://mahoranlotto-brand.com/promotion/
curl.exe -sI "https://mahoranlotto-brand.com/%E0%B8%95%E0%B8%A3%E0%B8%A7%E0%B8%88%E0%B8%AB%E0%B8%A7%E0%B8%A2/"
curl.exe -sI https://mahoranlotto-brand.com/abcxyz
```

| ต้องได้ | |
|---|---|
| โดเมนหลัก | **200** |
| `www` | **301** ไปโดเมนหลัก |
| `/promotion/` | 200 |
| **หน้าไทย** (`/ตรวจหวย`) | **200** ← จุดที่พังบ่อยสุด |
| URL มั่ว | **404** ไม่ใช่ 200 |
| `*.workers.dev` | **404** (ปิดแล้ว) |

**แล้วเปิดดูด้วยตาอีกรอบ** — เทียบกับเว็บเดิมว่าเนื้อหา รูป สี เหมือนกันทุกอย่าง

---

## ปัญหาที่เจอจริง (เรียงตามที่เจอ)

### ① `[code: 10034] You need to verify your email address to use Workers`

ไฟล์อัปโหลดขึ้นครบแล้วแต่ตายตอนสุดท้าย — **บัญชี Cloudflare ยังไม่ได้ยืนยันอีเมล**

**กับดัก:** ถ้าสมัครด้วยอีเมลที่ไม่มีจริง **จะเปลี่ยนอีเมลไม่ได้ด้วย** เพราะการเปลี่ยนอีเมลต้องผ่านการยืนยันอีเมลเดิมก่อน

> "You cannot change your email address ... if you did not successfully verify the original email address"
> "If you cannot access your original email address, **you will need to create a new account** with a working email address and move domains"

**ทางแก้:** ลองเข้า My Profile ดูว่ากดปุ่ม Change Email Address ได้ไหม ถ้าไม่ได้ = ต้องสร้างบัญชีใหม่แล้วย้ายโดเมน

**ทำให้ถูกตั้งแต่แรก:** ใช้**อีเมลกลางของบริษัทที่หลายคนเข้าถึงได้** ไม่ใช่อีเมลส่วนตัวคนใดคนหนึ่ง และไม่ใช่อีเมลมั่ว — บัญชีนี้จะถือเว็บทุกแบรนด์

### ② เว็บขึ้นที่ `www` แต่โดเมนหลักเป็นหน้า "Site Under Construction"

เกิดจากใช้ **Route** `*.mahoranlotto-brand.com/*` แทน Custom Domain

`*.` ครอบแค่ subdomain **ไม่ครอบโดเมนหลัก** → `www` เข้า Worker ส่วนโดเมนหลักตกไปที่ VPS เก่า

**แก้:** ลบ route ทิ้ง แล้วใช้ **Add Domain** ตามขั้นที่ 4

### ③ ลบ route แล้วขึ้น "The route you are trying to access does not exist"

route ถูกลบไปแล้วที่ฝั่งเซิร์ฟเวอร์ (มักโดน `wrangler deploy` sync ให้ตรงกับไฟล์ที่ไม่มี `routes`)
เหลือแต่ UI ค้าง → กด **Cancel** แล้ว **refresh หน้า (F5)**

### ④ หน้า DNS ขึ้น 0 records แต่เว็บใช้งานได้

record ของ Custom Domain ใช้เวลาสักครู่กว่าจะโผล่ในหน้า DNS
เมื่อขึ้นแล้วจะเป็นประเภท **`Worker`** พร้อมไอคอนกุญแจ — **ปกติ ไม่ต้องแก้อะไร**

### ⑤ `ERR_NAME_NOT_RESOLVED` ทั้งที่คนอื่นเข้าได้

**เว็บไม่ได้พัง — DNS ที่เครื่อง/เราเตอร์ของคุณจำผลเก่าตอนที่ยังไม่มี record ไว้**

เช็กว่าใช่ไหม — เทียบกับ DNS สาธารณะ:

```powershell
nslookup mahoranlotto-brand.com            # เครื่องคุณ
nslookup mahoranlotto-brand.com 8.8.8.8    # Google
```

ถ้าอันแรกไม่เจอแต่อันหลังเจอ = แคชค้าง **ไม่ต้องไปแก้อะไรที่ Cloudflare**

| วิธีแก้ | ได้ผลเมื่อไร |
|---|---|
| **เปิดจากมือถือ ปิด WiFi ใช้ 4G** | ทันที — ใช้พิสูจน์ว่าเว็บขึ้นจริง |
| **เปลี่ยน DNS เครื่องเป็น `1.1.1.1` / `8.8.8.8`** | ทันที (`Win+R` → `ncpa.cpl` → คลิกขวาการ์ดเน็ต → Properties → IPv4) |
| `ipconfig /flushdns` | ล้างแค่แคชใน Windows **ไม่ได้ล้างของเราเตอร์** |
| ล้างแคช Chrome | `chrome://net-internals/#dns` → Clear host cache |
| ไม่ทำอะไร | 15 นาที - 2 ชม. |

---

## รีแบรนด์รอบหน้า — สิ่งที่ต้องเปลี่ยน

🚨 **`name` ใน `wrangler.toml` ผูกกับแบรนด์**
ถ้ารีแบรนด์แล้วไม่เปลี่ยนชื่อ `wrangler deploy` จะไป **เขียนทับ Worker ของแบรนด์เดิม เว็บที่ออนไลน์อยู่หายทันที**

รายการที่ต้องแก้ให้ครบทุกครั้งที่ได้โดเมนจริงใหม่:

| ไฟล์ | แก้อะไร |
|---|---|
| `wrangler.toml` | `name` |
| `astro.config.mjs` | `site:` |
| `src/pages/index.astro` | `webSiteSchema.url` |
| `public/robots.txt` | สร้างเองจาก `site:` แล้ว — ไม่ต้องแก้ |

แล้วทำขั้นที่ 3-6 ใหม่ทั้งหมด (สร้าง Custom Domain ของโดเมนใหม่ + www redirect ของโดเมนใหม่)

---

## คำสั่งที่ใช้บ่อย

```powershell
npx wrangler whoami                  # login อยู่ด้วยบัญชีไหน
npm run build ; npx wrangler deploy  # อัปเว็บขึ้น
npx wrangler deploy --dry-run        # เช็ก config ไม่ได้อัปจริง
npx wrangler deployments list        # ดูประวัติ deploy
npx wrangler rollback                # ย้อนกลับเวอร์ชันก่อนหน้า
```
