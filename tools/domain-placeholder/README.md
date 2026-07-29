# หน้า placeholder สำหรับโดเมนที่ซื้อมาแล้วแต่ยังไม่เปิด

เว็บ 3 ไฟล์ (~0.3 KB) ที่ตอบ **HTTP 200 พร้อม `noindex`** เอาไว้ครองโดเมนใหม่ตั้งแต่วันซื้อ
จนถึงวันเปิดแบรนด์ แล้ววันเปิดค่อย `wrangler deploy` เว็บจริงทับลงบน Worker ตัวเดิม

## ปัญหาที่มันแก้

พอเพิ่มโดเมนเข้า Cloudflare แล้ว zone active ระบบจะออก Universal SSL ให้ทันที ชื่อโดเมนจึงไป
โผล่ใน **Certificate Transparency log ซึ่งเปิดสาธารณะ** ภายในไม่กี่นาที — crawler ไปอ่านจาก
ตรงนั้นได้เลย ไม่ต้องมีใครลิงก์มาหา ไม่ต้องมีเว็บด้วยซ้ำ นี่คือคำตอบว่าทำไมโดเมนที่ยังไม่ได้
ขึ้นเว็บถึงโดน index

วิธีเดิม (A record หลอก `192.0.2.1` ตาม `DEPLOY-CLOUDFLARE.md` ขั้นที่ 0) กันกับดัก DNS ได้
แต่ตอบ **Cloudflare error 522** ระหว่างรอ — บอทที่มาไต่ช่วงนั้นเห็นหน้าพัง วิธีนี้กันกับดัก DNS
ได้เท่าเดิมและตอบหน้าจริงแทน

## กฎ 2 ข้อที่พลาดไม่ได้

### 1. `--name` ต้องเป็นชื่อ Worker เดียวกับที่แบรนด์จะใช้ตอนเปิด

ตั้งจากตัวโดเมน: `winup888-brand.com` → `winup888` (ตรงกับของเดิมทุกตัว — `ufayes`,
`mahoranlotto`, `pay69`, `lapdee88`, `bunny555`)

ถ้าใช้ชื่ออื่น วันเปิดแบรนด์ `wrangler deploy` จะไปสร้าง Worker **ตัวที่สอง** ส่วน Custom Domain
ยังผูกกับ Worker ของ placeholder อยู่ → เว็บใหม่ขึ้นแล้วแต่ไม่มีใครเห็น โดเมนยังโชว์ Coming Soon
**และไม่มี error อะไรเตือนเลย**

### 2. ห้ามใส่ `Disallow: /` ใน `robots.txt`

`noindex` ทำงานได้ก็ต่อเมื่อ Google **เข้ามาอ่านหน้าได้** ถ้าบล็อกไว้ = ไม่มีวันเห็น `noindex`
และ Google ยังเก็บ URL เปล่าเข้า index จาก CT log ได้อยู่ดี (ขึ้นเป็นผลลัพธ์ที่ไม่มีคำอธิบาย)
**บล็อกแล้วได้ผลตรงข้ามกับที่ต้องการ** — `site/robots.txt` จึงเป็น `Allow: /` โดยตั้งใจ

## วิธีใช้

### ① วันซื้อโดเมน — ทำต่อกันรวดเดียว

```powershell
# 1. สลับบัญชี Cloudflare ให้ตรงกับบัญชีที่โดเมนอยู่ (ปุ่ม 🔑 ในการ์ด 7 ของ uploader)
npx wrangler whoami

# 2. ยิง placeholder ขึ้นไป
npx wrangler deploy --name <brand-token> --config tools/domain-placeholder/wrangler.toml
```

> ถ้า wrangler ฟ้องว่าบัญชีมีหลายอัน ให้ระบุก่อน: `$env:CLOUDFLARE_ACCOUNT_ID = "<account id>"`

### ② ผูกโดเมนทันที

ตาม `DEPLOY-CLOUDFLARE.md` **ขั้นที่ 4** (Add Domain — ห้ามใช้ Add Route)

ยิ่งช่วงระหว่าง zone active กับ placeholder ขึ้นสั้นเท่าไหร่ยิ่งดี เพราะ CT log โผล่ตั้งแต่
zone active ไม่ได้รอให้มีเว็บ

**เช็กให้ครบก่อนถือว่าจบ:**

```powershell
curl.exe -sI https://<domain>/                        # ต้อง 200
curl.exe -s  https://<domain>/ | findstr noindex      # ต้องเจอ
curl.exe -s  https://<domain>/robots.txt              # ต้อง "ไม่" มี Disallow: /
curl.exe -sI https://<domain>/abcxyz                  # ต้อง 404 ไม่ใช่ 200
```

### ③ วันเปิดแบรนด์

รีแบรนด์ตามปกติ แล้ว **เช็กว่า `name` ใน `wrangler.toml` ที่รากโปรเจกต์ตรงกับ `<brand-token>`
ที่ park ไว้** จากนั้น:

```powershell
npm run build
npx wrangler deploy
```

Custom Domain กับ DNS ไม่ต้องแตะ ไม่ต้องรอ propagate เพราะเป็น Worker ตัวเดิม

**เช็กว่าทับสำเร็จจริง:**

```powershell
curl.exe -s  https://<domain>/ | findstr noindex      # ต้อง "ไม่" เจอแล้ว
curl.exe -sI https://<domain>/                        # ต้อง 200
npx wrangler deployments list --name <brand-token>    # ต้องเห็นทั้งเวอร์ชัน placeholder และเวอร์ชันใหม่ บน Worker ตัวเดียวกัน
```

บรรทัดสุดท้ายคือหลักฐานว่าขั้น ③ **เขียนทับ** จริง ไม่ได้แตก Worker ตัวใหม่ — เป็นจุดที่พังเงียบที่สุด

หลังเปิดแล้วค่อยเข้า Search Console ขอ index · **อย่าส่ง sitemap ระหว่างที่ยัง park อยู่**

## ทำไมไม่ build จาก repo หลัก

- repo เก็บได้ทีละแบรนด์ — build ตอนนี้จะเอารูป/ฟอนต์/เนื้อหาของ**แบรนด์ก่อนหน้า**ไปวางบน
  โดเมนใหม่ = footprint ข้ามแบรนด์แบบเดียวกับที่ commit `20353eb` ไล่ลบไป
- flag `noindex` ใน `MainLayout` มีโอกาสค้างไปโผล่บนเว็บจริง
- ไม่ต้อง build เลย ยิงได้ในไม่กี่วินาที ใช้ได้แม้รีแบรนด์จะมาอีกหลายอาทิตย์

## ข้อแลกเปลี่ยนที่รู้ตัว

หน้านี้เหมือนกันทุกโดเมนแบบไบต์ต่อไบต์ ซึ่งตามทฤษฎีคือสัญญาณจัดกลุ่มอย่างหนึ่ง — ยอมรับได้
เพราะเนื้อหาเป็น "Coming soon" เปล่าๆ ที่เว็บทั้งอินเทอร์เน็ตใช้เหมือนกันหมด ไม่มีโครงสร้าง
ที่บอกความเป็นเจ้าของ ต่างจากการเอา template ของแบรนด์จริงไปวางซึ่งเทียบเคียงกันได้ทันที
