# BRAND SPEC — LUCKYGAME689 (rebrand 2026-08-06)

Single source of truth for this rebrand. **Do NOT re-extract the docx and do NOT
re-choose variants.** Everything below was decided by the orchestrator in Phase 0.

---

## 1. Identity

| key | value |
|---|---|
| Brand name | `LUCKYGAME689` |
| Outgoing brand | `DEVA555` (grep for it; also older strays: `MIRACLE55`, `LAPDEE88`, `TUNJAI123`) |
| Real URL | `https://luckygame689-play.net/` |
| Font | `kanit` (was `google-sans`) — set in `src/lib/brandProfile.ts`, orchestrator owns it |
| Genre / mood | Premium arcade-luxury. Gold + hot magenta on deep crimson-black. "Premium Material" per the docx. |

## 2. Palette — use these exact hex values

Measured from `src/assets/palette.json` + the artwork (logo = gold console with a
magenta screen; banner1 = deep crimson stage with gold type; slides = gold on magenta).

**Gold is the primary accent, magenta is the secondary.** The outgoing brand was
gold + ivory/silver, so *the magenta pair is what makes this brand not look like
the last one* — use it on borders, glows, badges, secondary buttons and hover
states, not just as a stray highlight.

| role | hex | replaces (DEVA555) |
|---|---|---|
| gold — bright / top of gradient | `#ffd84d` | `#fded9a` |
| gold — core accent | `#faad23` | `#dfb85f` |
| gold — deep / bottom of gradient | `#b8760f` | `#a57a32` |
| magenta — bright | `#ff3d8a` | `#dfe4e7` (the old silver/ivory second colour) |
| magenta — core | `#e01b5d` | `#dfe4e7` |
| crimson — deep | `#7a0426` | — |
| surface — card base | `#3d0410` | `#1e1408` |
| surface — panel / darker card | `#2b0204` | `#140d04` |
| surface — page base (body background-color) | `#1a0106` | `#070502` |
| body copy (BRAND_TEXT) | `#ffe9c4` | `#e9ddbe` |
| bright cream (strong/emphasis text) | `#fff3d6` | `#fded9a` |
| ink on gold buttons | `#2b0204` | `#140d04` |

Glow / `rgba()` conversions:

- gold glow `rgba(223,184,95,X)` → **`rgba(250,173,35,X)`**
- ivory glow `rgba(253,237,154,X)` → **`rgba(255,216,77,X)`**
- silver glow `rgba(223,228,231,X)` → **`rgba(224,27,93,X)`** (becomes magenta)

Tailwind hue families: **`amber-*`** for gold, **`rose-*` / `pink-*`** for magenta.
Any `amber-*` already present in a variant you adopt is fine to keep; anything
`emerald-*`, `lime-*`, `cyan-*`, `blue-*`, `violet-*`, `purple-*`, `green-*` that is
the *old brand's identity colour* must move to amber/rose. Leave semantic colours
alone: LINE green `#00B900`, bank brand colours, live/success green dots.

## 3. Variant rotation — DECIDED, do not change

| family | before (DEVA555) | after (LUCKYGAME689) |
|---|---|---|
| Navbar | `NavbarStyle6` | **`NavbarStyle9`** |
| Footer | `FooterStyle3` | **`FooterPremium`** |
| Announcement | `Announcement3` | **`AnnouncementPremium`** |
| LatestWinners | `LatestWinners2` | **`LatestWinnersPremium`** |
| Faq | `Faq3` | **`Faq4`** |
| ContentBox mix | CyberCut + FloatingBadge + SevenThreeCyberCut + SevenThree + plain + Special | **Premium + Neumorphism + SevenThreePremium + TwoPremium** |
| Font | google-sans | **kanit** |

**Unused variants are inventory for the next brand — never delete one.**

## 4. Docx heading checklist (document order) — every one must survive

Home page (`index.astro`):

1. **H1** — `LUCKYGAME689 เว็บสล็อตเจ้าใหญ่ โปรโมชั่นเด็ด บริการระดับ VVIP`
2. **H2** — `รวมเกมคุณภาพระดับโลกบนแพลตฟอร์ม LUCKYGAME689 เว็บสล็อตเจ้าใหญ่`
   - **H3** — `Hacksaw Gaming มินิมอลสไตล์ โบนัสแตกหนักจัดเต็ม`
   - **H3** — `Nolimit City ขีดสุดแห่งฟีเจอร์ ท้าทายทุกความกล้า`
   - **H3** — `Relax Gaming แอนิเมชันลื่นไหล เสถียรภาพไร้ที่ติ`
3. **H2** — `LUCKYGAME689 คัดสรร โปรโมชั่นเด็ด รับสิทธิพิเศษเหนือระดับ`
4. **H2** — `ยกระดับประสบการณ์ด้วย บริการระดับ VVIP แท้ 100%`
5. **H2** — `ความปลอดภัยของ LUCKYGAME689 มั่นคง ผ่านระบบ Premium Loader`
6. **H2** — FAQ title (`Faq4`'s `title` prop)

Target rendered inventory for `dist/index.html`: **h1×1, h2×5, h3×3.**
The three H3s come from `FeatureHighlights` and nowhere else.

Full body paragraphs for each are in `src/assets/content.txt` lines 21–44 — use the
**full** paragraph, never a summary.

## 5. Docx sub-page Title / Meta

**Titles: verbatim. Metas: NOT verbatim — every one is too short.**

`verify-build.mjs` (`DESC_MIN = 150`, line 65 / 478) fails the build on any
indexable page whose meta description is outside **150–160 characters**, and this
brand's docx metas measure:

| page | docx meta | short by |
|---|---|---|
| home | 145 | 5 |
| ติดต่อเรา | 133 | 17 |
| โปรโมชั่น | 129 | 21 |
| ทางเข้า | 130 | 20 |
| ทดลองเล่น | 139 | 11 |

Keep the brief's sentence **byte-identical** and append a short trailing clause
that adds nothing the brief doesn't already say, landing in 150–160. Count
**characters, not bytes** (Thai is 3 bytes/char, so `wc -c` reads ~3× too long) —
check with `python -c "print(len('<string>'))"`.

```
ติดต่อเรา   Title: LUCKYGAME689 ติดต่อเรา บริการระดับ VVIP ทีมงานดูแล 24 ชม.
            Meta:  ช่องทางการติดต่อ LUCKYGAME689 ทีมงานผู้เชี่ยวชาญพร้อมให้การดูแลและซัพพอร์ตด้วย บริการระดับ VVIP ตอบไว แก้ไขปัญหาตรงจุดตลอด 24 ชั่วโมง

โปรโมชั่น    Title: LUCKYGAME689 โปรโมชั่น ศูนย์รวม โปรโมชั่นเด็ด สุดคุ้มค่า
            Meta:  อัปเดตสิทธิพิเศษล่าสุดจาก LUCKYGAME689 คัดสรร โปรโมชั่นเด็ด จัดเต็มโบนัสเพื่อซัพพอร์ตทุกการลงทุนของคุณ รับสิทธิ์ง่ายผ่านระบบออโต้

ทางเข้า      Title: LUCKYGAME689 เข้าสู่ระบบ ปลอดภัยขั้นสุด ผ่าน Premium Popup
            Meta:  หน้าเข้าสู่ระบบ LUCKYGAME689 ยกระดับความปลอดภัยด้วยเทคโนโลยี Secure Transition Popup โหลดไว ลื่นไหล ปกป้องข้อมูลส่วนตัวของคุณ 100%

ทดลองเล่น   Title: LUCKYGAME689 ทดลองเล่นฟรี เว็บสล็อตเจ้าใหญ่ สัมผัสความพรีเมียม
            Meta:  โหมดทดลองเล่นฟรีบนแพลตฟอร์ม LUCKYGAME689 เปิดโอกาสให้คุณสัมผัสระบบ เว็บสล็อตเจ้าใหญ่ ระดับพรีเมียมได้อย่างอิสระ ไร้ขีดจำกัด ไม่มีค่าใช้จ่าย
```

Home page:

```
Title: LUCKYGAME689 เว็บสล็อตเจ้าใหญ่ โปรโมชั่นเด็ด บริการระดับ VVIP
Meta:  LUCKYGAME689 เว็บสล็อตเจ้าใหญ่ อาณาจักรการลงทุนเหนือระดับ คัดสรร โปรโมชั่นเด็ด สุดคุ้มค่า มอบประสบการณ์เอ็กซ์คลูซีฟผ่าน บริการระดับ VVIP แท้ 100%
```

Any description you write yourself (about-us, 404, login, register): **150–160
characters** (characters, not bytes — Thai is 3 bytes/char).

## 6. Images

- `banner1.png` (2026-08-06) — the hero, handled by `MainLayout`. Nobody else touches it.
- `slide1.png` (2026-08-06) — **CASHBACK 10%** promo art: gold "CASHBACK 10%" on
  magenta, woman in a gold dress, caption `โปรดี คุ้มสุด คืนยอดทุกการช้อป` and
  `ช้อปมาก ยิ่งได้คืนมาก`, four feature chips (ช้อปครบรับเงินคืนทันที / ปลอดภัย
  มั่นใจได้ 100% / บริการดี ตอบไว 24 ชม. / คุ้มค่า คืนจริง ทุกการใช้จ่าย).
- `slide2.png` (2026-08-06) — **ชวนเพื่อน รับค่าคอม 0.8%** referral art: gold "0.8%"
  on magenta, caption `ยิ่งชวนมาก ยิ่งได้มาก ไม่จำกัดเพื่อน` and
  `ชวนเพื่อนตอนนี้ รับโบนัสเลย`, four chips (ชวนง่ายแชร์ลิงก์ได้ทันที /
  รับรายได้ไม่อั้นจากยอดเพื่อน / ถอนได้จริงโอนไวไม่มีขั้นต่ำ / ปลอดภัยมั่นใจได้ 100%).
- `slide3.png`, `slide4.png`, `banner.png`, `banner2.png`, `banner3.png` — **STALE,
  previous brands.** Nothing may import them. There is no `banner2/3/4` article
  illustration for this brand.
- No `banner1-mobile.*` on disk — correct, nothing to do.
- `og.png` — written by the uploader at 1200x630, `MainLayout` already picks it up.

**Alt text must describe the picture** (read the descriptions above), never
`"banner"` / `"ภาพที่ 2"`.

## 7. Hard rules that apply to every agent

1. **Never delete an unused component variant** — it is inventory for the next brand.
2. **Do NOT run `npm run build`.** The orchestrator runs the single build in Phase 5.
3. **Only article content may produce a heading.** Chrome (navbar, footer, ticker,
   winners feed, ranking widget, login box, card labels, carousel captions) renders
   its label as `<p>`/`<span>` with the same classes + `aria-label` on the container.
4. **No HTML comments (`<!-- … -->`)** in anything that renders — Astro ships them.
   Strip them from every component you rewrite. Frontmatter `//` comments are fine.
5. **Body copy is `text-left text-base leading-relaxed <colour>`.** No `text-sm`,
   no `text-lg`, no `mx-auto max-w-4xl` on a `<p>` inside a content box.
6. **Decorative emoji need their own `<span aria-hidden="true">`**, sibling to the
   label text, never concatenated into it.
7. **No `href="#"`, no `onclick=`, no `define:vars`, no Swiper.**
8. **Never type a domain or build a URL with `+`.** Use `pageGraph()` from
   `src/lib/schema.ts`. No `Review`, `AggregateRating`, `sameAs`, `address`/
   `PostalAddress`, or `email:` in JSON-LD.
9. **Never write `isActive` by hand** — `isActivePath` from `src/lib/nav`.
10. **Don't add a `<style>` block that only contains `.font-sans { font-family: var(--font-sans) }`.**
11. `terms.astro` / `privacy.astro` are brand-neutral by construction — they read
    `BRAND_NAME`. Do not hardcode a colour or a brand word into them.
12. Contact address/email come from `BRAND_ADDRESS` in `src/lib/brandProfile.ts`,
    derived from `BRAND_NAME`. Never retype the lines.

## 8. Site decisions already made (do not re-litigate)

- **Lottery pages stay OFF.** `ตรวจหวย.astro` / `แนวทาง.astro` are in
  `src/pages-disabled/` and no active navbar/footer links to them. LUCKYGAME689 is a
  slot brand. Nothing to do.
- **`about-us.astro` stays ON** and gets a full rebrand. It has shipped on the last
  three brands and is linked from the active navbar and footer.
- **No `บทความ.astro`** — the uploader did not scaffold one (the docx SUB-PAGES list
  has always carried a บทความ entry as boilerplate; the previous brand shipped
  without the page too).
- `login.astro` / `register.astro` are **button pages**: one `<h1>`, one button,
  `targetUrl` must not change.
- `contact-us.astro` and `ทางเข้า.astro` are **button pages**: `<h1>` + buttons only.
  **No `<h2>`, no explanatory paragraphs.** `h2×0` on both is checked in Phase 5.
