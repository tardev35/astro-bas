# BRAND SPEC — PGW44 (scratchpad, delete after rebrand)

Read this file instead of re-extracting the docx or re-choosing variants.
Everything below was decided by the orchestrator in Phase 1 + Phase 2.

## Brand

- **New brand name:** `PGW44`
- **Outgoing brand (remove every trace of):** `MIRACLE55` (also lowercase `miracle55`)
- **Real URL (given by operator):** `https://pgw44-vvip.com/`
- **Brand type:** slot/casino (NOT a lottery brand — no `/ตรวจหวย`, no `/แนวทาง`)
- **Visual identity:** black dragon breathing fire, gold + lime-green on near-black.

## Palette — use these exact tokens

Measured from `src/assets/palette.json` (logo `vivid` = `#ecab03` gold, `#4a8d14` lime;
`dominant` = near-black) and confirmed by eye against logo/banner1/slides.

| role | hex | notes |
|---|---|---|
| gold light (headings, accent text) | `#ffd54a` | |
| **gold core (brand primary)** | `#ecab03` | borders, glows, gradients |
| gold deep (gradient end) | `#a9760a` | |
| lime bright (secondary accent) | `#8fd633` | the dragon-fire green in the logo |
| lime core | `#4a8d14` | |
| lime deep | `#2c5a0d` | |
| **body text (`BRAND_TEXT`)** | `#e8efd8` | warm off-white, slight green cast |
| muted body text | `#b9c4a6` | footer/secondary copy |
| page base near-black | `#0a0f06` | |
| card surface | `#111a0a` | |
| raised surface | `#1a2610` | |

Glow rgba: gold `rgba(236,171,3,0.xx)`, lime `rgba(143,214,51,0.xx)`.

**Old MIRACLE55 tokens that must not survive anywhere you touch:**
`#e8b43a`, `#f7d97a`, `#f4e3c8`, `#a9741c`, `#a55a22`, `#e0b98a`, `#1a1206`,
`#15110b`, `#241a10`, `#0a0806`, `rgba(232,180,58,…)`, `rgba(165,90,34,…)`.

Leave genuinely semantic colours alone: LINE green `#00B900`, live/success
indicators, real bank brand colours.

## Variant rotation (already decided — do NOT re-pick)

| family | from (MIRACLE55) | **to (PGW44)** |
|---|---|---|
| Navbar | `NavbarPremium` | **`NavbarStyle4`** |
| Footer | `FooterPremium` | **`FooterStyle3`** |
| Announcement | `AnnouncementPremium` | **`AnnouncementCyber`** |
| LatestWinners | `LatestWinnersCyber` | **`LatestWinnersPremium`** |
| Faq | `Faq2` | **`Faq4`** |
| ContentBox mix | Premium + Neumorphism + plain + Special + SevenThreePremium + SevenThreeNeumorphism | **CyberCut + FloatingBadge + plain + SevenThreeCyberCut + FeatureHighlights** |
| `BRAND_FONT` | `kanit` | **`google-sans`** |

Unused variants are **inventory for the next brand — never delete them.**

## Images

- `banner1.png` — hero, handled by `MainLayout` (orchestrator). Do not touch.
- `slide1.png` — **"PGW44 คืนยอดเสีย 15% เสียเท่าไหร่ เราคืนให้!"** cashback promo.
  This is the ONE `ContentBoxSevenThree*` image, paired with docx section #7 (โปรลุ้นรับรางวัลเยอะ).
- `slide2.png` — "PGW44 ฝากแรก 29 ลุ้นรับหม้อชาบู มูลค่า 1,290 บาท" — **unused on index**
  (SevenThree is capped; no other section fits). Still used by `promotion.astro`.
- `slide3.png` — "PGW44 แทงผิด 10 ครั้งติดต่อกัน ลุ้นรับ iPhone 17 Pro Max มูลค่า 46,900 บาท"
  — **unused on index.** Still used by `promotion.astro`.
- `slide4.png` — **STALE (2026-08-01, previous brand).** Not part of this drop.
  If `promotion.astro` imports it, replace that slot with slide1/2/3 content — do not
  describe slide4 as a PGW44 promo.
- `banner2.png` / `banner3.png` / `banner.png` — **STALE (2026-07-27, previous brands).**
  Do NOT use as article illustrations.
- No `banner1-mobile.*` exists — correct, it is optional.
- `og.png` — written by the uploader at 1200x630. `MainLayout` already prefers it.

## Docx heading checklist — every one must survive, in this order

The brief runs heading and body together on one line; the split below is authoritative.

1. **H1** — `PGW44 สล็อตเว็บใหญ่ ระบบออโต้ไม่มีขั้นต่ำ โปรลุ้นรับรางวัลเยอะ`
   > PGW44 สล็อตเว็บใหญ่ ที่ถูกสร้างขึ้นมาเพื่อรองรับผู้เล่นทุกระดับด้วยมาตรฐานความมั่นคงระดับสากล เราพร้อมมอบอิสระทางการเงินอย่างแท้จริงผ่านเทคโนโลยี ระบบออโต้ไม่มีขั้นต่ำ ที่ประมวลผลได้อย่างรวดเร็วและแม่นยำ ทุกการเชื่อมต่อของคุณจะเต็มไปด้วยความลื่นไหล ปลอดภัยขั้นสุด พร้อมยกระดับความคุ้มค่าด้วยแคมเปญและ โปรลุ้นรับรางวัลเยอะ ที่จัดเตรียมไว้ซัพพอร์ตสมาชิกเพื่อต่อยอดผลกำไรในทุกๆ วัน

2. **H2** — `PGW44 สล็อตเว็บใหญ่ ศูนย์รวมค่ายเกมระดับโลก ลื่นไหล`
   > อาณาจักรของ PGW44 ถูกออกแบบมาเพื่อเป็นศูนย์กลางของซอฟต์แวร์คุณภาพเยี่ยม โดยเราได้เชื่อมต่อกับผู้พัฒนาชั้นนำเพื่อนำเสนอประสบการณ์ที่สมบูรณ์แบบที่สุด ทุกเกมบนระบบผ่านการตรวจสอบเสถียรภาพ เพื่อให้กราฟิกแสดงผลได้คมชัดและมีอัตราการจ่ายที่ยุติธรรม ตอบโจทย์นักลงทุนที่ต้องการความมั่นใจในทุกการกดสปิน

3. **H3** — `PG Soft อาณาจักรแห่ง 3D แอนิเมชัน โบนัสแตกไว`
   > ส่งมอบความบันเทิงผ่านกราฟิกที่สวยงามสมจริง ผสานกับฟีเจอร์เกมที่ไหลลื่น ช่วยให้คุณเข้าถึงรอบโบนัสแจ็กพอตได้อย่างรวดเร็วและต่อเนื่อง

4. **H3** — `Pragmatic Play แจกรางวัลรัว ฟีเจอร์ทันสมัย ตอบสนองฉับไว`
   > ตอบสนองนักลงทุนที่ชอบความรวดเร็ว ด้วยกลไกการออกรางวัลที่โปร่งใสและจ่ายผลตอบแทนก้อนโตได้อย่างสะใจในทุกจังหวะ

5. **H3** — `Nolimit City ท้าทายทุกขีดจำกัด ตัวคูณมหาศาล`
   > ฉีกกฎเกณฑ์เดิมๆ ด้วยฟีเจอร์การเล่นที่ดุดันและเน้นการทวีคูณเงินรางวัลแบบก้าวกระโดด โหลดไว ไร้ปัญหาอาการค้าง

6. **H2** — `PGW44 ขับเคลื่อนด้วย ระบบออโต้ไม่มีขั้นต่ำ รวดเร็วที่สุด`
   > สัมผัสนวัตกรรมการเงินที่ล้ำหน้าไปอีกขั้นบนระบบของ PGW44 ด้วยสถาปัตยกรรมการประมวลผลที่ให้คุณจัดการงบประมาณได้อย่างอิสระเสรี การทำธุรกรรมทั้งหมดทำงานผ่าน AI อัจฉริยะที่ช่วยตัดความซับซ้อนออกไป มอบความคล่องตัวแบบไม่มีเงื่อนไขผูกมัด ไม่ว่าจะเป็นยอดฝากหรือถอนก็สามารถดำเนินการเสร็จสิ้นภายในไม่กี่วินาทีอย่างแม่นยำ

7. **H2** — `โปรลุ้นรับรางวัลเยอะ แจกหนักทุกวัน รับความคุ้มค่าเต็มพิกัด`
   > เพื่อเป็นการตอบแทนความไว้วางใจ ทางทีมงาน PGW44 ได้จัดเตรียมสิทธิพิเศษมากมายเพื่อเป็นทุนต่อยอดความสำเร็จให้กับสมาชิกทุกคน ไม่ว่าจะเป็นโบนัสต้อนรับหรือแคมเปญประจำวัน คุณสามารถกดรับสิทธิ์เพื่อเพิ่มโอกาสในการทำกำไรได้อย่างง่ายดาย กิจกรรมต่างๆ ถูกออกแบบมาให้เข้าร่วมง่ายและแจกจริง เพื่อให้คุณกวาดผลตอบแทนกลับไปได้มากที่สุด

8. **H2** — `PGW44 บริการพรีเมียม ปลอดภัย 100% ผ่าน Secure Popup`
   > ความปลอดภัยคือเสาหลักที่ PGW44 ให้ความสำคัญสูงสุด ฐานข้อมูลและการเชื่อมต่อทั้งหมดถูกเข้ารหัสด้วยเทคโนโลยีที่เทียบเท่าสถาบันการเงิน นอกจากนี้ การเข้าสู่แดชบอร์ดส่วนตัวจะแสดงผลผ่าน Secure Transition Popup Modal ที่ถูกออกแบบมาเพื่อป้องกันการรีเฟรชหน้าเว็บซ้ำซ้อน ทำให้การใช้งานลื่นไหลและปกป้องข้อมูลของคุณให้เป็นความลับในทุกมิติ

9. **H2** — FAQ section title (rendered by `Faq4`'s `title` prop).

## FAQ (verbatim from the docx — pass as the `faqs` prop)

1. Q: `การใช้งานผ่าน ระบบออโต้ไม่มีขั้นต่ำ มีข้อดีอย่างไร?`
   A: `ช่วยให้ผู้ใช้งานแพลตฟอร์ม PGW44 สามารถบริหารทุนของตนเองได้อย่างอิสระ ไร้ข้อผูกมัด และประมวลผลรวดเร็วทันใจ`
2. Q: `ทำไมจึงควรเลือกใช้งานแพลตฟอร์ม สล็อตเว็บใหญ่ ?`
   A: `เพราะมีความมั่นคงทางการเงินสูง การันตีการจ่ายผลตอบแทนที่ยุติธรรม และมีเสถียรภาพในการให้บริการที่ยอดเยี่ยม`
3. Q: `เงื่อนไขการรับ โปรลุ้นรับรางวัลเยอะ ยุ่งยากหรือไม่?`
   A: `ไม่ยุ่งยาก สมาชิกสามารถกดยอมรับสิทธิพิเศษและโบนัสต่างๆ ได้ด้วยตนเองผ่านหน้าแดชบอร์ดอัตโนมัติ`
4. Q: `ข้อมูลส่วนบุคคลจะได้รับการปกป้องอย่างไร?`
   A: `ระบบใช้การเข้ารหัสฐานข้อมูลขั้นสูง ทำให้ทุกการเชื่อมต่อมีความ ลื่นไหล ปลอดภัย ป้องกันการเข้าถึงจากบุคคลภายนอก 100%`

## Titles / meta descriptions supplied by the docx (use VERBATIM)

Home:
- Title: `PGW44 สล็อตเว็บใหญ่ ระบบออโต้ไม่มีขั้นต่ำ โปรลุ้นรับรางวัลเยอะ`
- Meta: `PGW44 สล็อตเว็บใหญ่ อาณาจักรความบันเทิงที่มั่นคงที่สุด มอบอิสระด้วย ระบบออโต้ไม่มีขั้นต่ำ ลื่นไหล ปลอดภัย พร้อมจัดเต็ม โปรลุ้นรับรางวัลเยอะ ทุกวัน`

`/contact-us`:
- Title: `PGW44 ติดต่อเรา บริการสุดพรีเมียม ทีมงานดูแลตลอด 24 ชม.`
- Meta: `ช่องทางการติดต่อ PGW44 ทีมงานผู้เชี่ยวชาญพร้อมให้คำปรึกษาและดูแลทุกความต้องการของคุณตลอด 24 ชั่วโมง แอด LINE เพื่อรับบริการที่รวดเร็วทันใจ`

`/promotion`:
- Title: `PGW44 โปรโมชั่น จัดเต็ม โปรลุ้นรับรางวัลเยอะ คุ้มค่าทุกวัน`
- Meta: `อัปเดตสิทธิพิเศษและโบนัสล่าสุดจาก PGW44 รับความคุ้มค่าแบบจัดเต็มด้วย โปรลุ้นรับรางวัลเยอะ สนับสนุนทุกการลงทุนของคุณให้เติบโตอย่างมั่นคง`

`/ทางเข้า`:
- Title: `PGW44 เข้าสู่ระบบ ปลอดภัยขั้นสุด ลื่นไหล ผ่าน Premium Popup`
- Meta: `หน้าเข้าสู่ระบบ PGW44 มอบความปลอดภัยสูงสุดผ่านเทคโนโลยี Secure Transition Popup โหลดไว ลื่นไหล ป้องกันข้อมูลของคุณอย่างรัดกุมในทุกการเชื่อมต่อ`

`/ทดลองเล่น`:
- Title: `PGW44 ทดลองเล่นฟรี สล็อตเว็บใหญ่ ลื่นไหล สัมผัสได้ก่อนใคร`
- Meta: `โหมดทดลองเล่นฟรีบนแพลตฟอร์ม PGW44 เปิดโอกาสให้คุณศึกษาระบบและฟีเจอร์เกมระดับโลกได้อย่างอิสระ ไร้ขีดจำกัด ทันทีโดยไม่ต้องเสียค่าใช้จ่าย`

`/about-us` — **the docx gives no title/meta for it.** Write your own,
**150–160 characters** for the description (count characters, not bytes).

> The docx also supplies a `บทความ` title/meta, but no `src/pages/บทความ.astro`
> exists and the operator did not toggle one on this round. **Do not create it.**

## Announcement message (pass explicitly — never leave a variant default)

```
PGW44 สล็อตเว็บใหญ่ ศูนย์รวมค่ายเกมระดับโลก PG Soft Pragmatic Play Nolimit City • ระบบออโต้ไม่มีขั้นต่ำ ฝาก-ถอนเสร็จในไม่กี่วินาที • โปรลุ้นรับรางวัลเยอะ แจกหนักทุกวัน คืนยอดเสีย 15% • ปลอดภัย 100% ผ่าน Secure Transition Popup • ตรวจเงื่อนไขทุกครั้งก่อนกดรับสิทธิ์
```

No leading emoji (it is read out once per marquee copy and cannot be aria-hidden
inside a text prop).

## Rules that bind every agent

1. **Never delete an unused component variant** — it is inventory for the next brand.
2. **Only article content may produce a heading.** Chrome (navbar, footer, ticker,
   winners feed, ranking board, login box, card labels, carousel captions) renders
   its label as `<p>`/`<span>` with the same classes, plus `aria-label` on the
   container if it named a region. Exactly one `<h1>` per page.
3. **Heading levels follow the docx**: H1 once, H2 for sections, H3 only for the
   three provider sub-points (via `FeatureHighlights`). Grep every component you
   render for `<h[1-6]` and normalise.
4. **No HTML comments (`<!-- … -->`)** in anything that renders — Astro ships them
   verbatim. Strip them while rethemeing. Frontmatter `//` comments are fine.
5. **Body copy house style:** the slot-carrying element gets
   `text-left text-base leading-relaxed <colour>`. No `text-sm`/`text-lg` for prose,
   no `mx-auto max-w-4xl` on page-level `<p>`.
6. **Do not re-add wrapper `<div>`s** inside ContentBox variants — they are
   deliberately flattened (`isolate` on the card + `-z-10` on decorative layers).
7. **Accessibility (build-enforced):** decorative emoji need `aria-hidden="true"` on
   their own element (sibling of the label, never concatenated into it); no
   `href="#"`, no `onclick=`; `alt` must describe the picture; FAQs stay
   `<details>`/`<summary>`.
8. **Behaviour stays in `src/lib/`** — `isActivePath` from `../lib/nav` in navbars,
   `winnersFeed.ts` for feeds, `liveCounter.ts` for counters. Never `define:vars`,
   never an empty server-rendered feed container.
9. **JSON-LD comes from `pageGraph()`** in `src/lib/schema.ts`. Never hand-write it,
   never type a domain, never build a URL with `+`. No `Review`, `AggregateRating`,
   `sameAs`, `address`/`PostalAddress`.
10. **Do NOT run `npm run build`.** The orchestrator runs the single build in Phase 5.
11. **Do not `git commit`, `git push`, or deploy.**
