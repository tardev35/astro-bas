// Local-only rebrand console.
// Run with: npm run rebrand:upload   (opens http://localhost:4000)
//
// Two jobs, in the order an operator does them:
//   1. STAGE (ส่วนที่ 1-5) — copy a new brand's files into src/assets and public
//      with the exact filenames + extensions the components import, so the
//      "extension drift" bug class (Phase 4 of the rebrand-site skill) can't
//      happen; plus the aff/LINE links and sub-page Title/Meta.
//   2. RUN (ส่วนที่ 6) — spawn `claude -p` headless on this repo to perform the
//      rebrand itself, and stream its progress back to the page over SSE.
//      It stops at build + verify: it never deploys and never pushes.
//
// Deps: Node built-ins + sharp (already in package.json). No new dependency.

import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readFile, unlink, writeFile, mkdir, stat } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const ASSETS = join(ROOT, "src", "assets");
const PUBLIC = join(ROOT, "public");
const PAGES = join(ROOT, "src", "pages");
const CONFIG = join(ROOT, "astro.config.mjs");
// Port/host are env-overridable but the localhost-only bind is load-bearing,
// not a nicety: there is NO auth on any endpoint, /upload rewrites source files,
// and /rebrand/start spawns a Claude session with --permission-mode
// bypassPermissions. Anyone who can reach this port can therefore run arbitrary
// code on this machine. HOST=0.0.0.0 is FORBIDDEN until real auth + HTTPS exist
// (see the rebrand web-UI plan); the default keeps a bare run safe.
const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || "127.0.0.1";

const IMAGE_EXTS = ["png", "webp", "jpg", "jpeg", "avif", "gif", "svg"];

// Cap the stored source width. 2560px covers a full-bleed hero on a 27" QHD
// monitor without upscaling smaller uploads — only genuinely oversized files
// (e.g. a 4000px export) get downscaled, so the repo can't bloat while big
// screens still stay crisp. Bump this if you serve 4K-native hero art.
const MAX_SOURCE_WIDTH = 2560;

// Promotion / carousel slides are never rendered wider than 600px
// (SmoothCarousel uses widths=[200,400,600]), so storing the full-size export
// is wasted bytes. Fit inside a 600x600 box: keeps aspect ratio, never crops,
// never upscales a smaller upload.
const SLIDE_BOX = 600;

// A solid colour / gradient background is NOT rendered as an image — that would
// ship a full-screen bitmap for something that is just a CSS declaration. The
// uploader instead writes src/assets/bg.json, which MainLayout reads to decide:
//   { "mode": "image" }                          → <Image> the bg.png (default)
//   { "mode": "color", "color": "#rrggbb" }       → CSS background-color, 0 bytes
//   { "mode": "gradient", "css": "linear-…" }     → CSS gradient, 0 bytes
// bg.png is kept on disk either way so image mode always has a source to import.
const BG_CONFIG = join(ASSETS, "bg.json");

// Normalize an upload before it is stored: downscale only when larger than the
// limit (never upscale). Returns a sharp pipeline the caller finishes + writes.
async function prep(buf, { maxWidth = MAX_SOURCE_WIDTH, box = null } = {}) {
  const meta = await sharp(buf).metadata();
  let img = sharp(buf);
  if (box) {
    img = img.resize({ width: box, height: box, fit: "inside", withoutEnlargement: true });
  } else if (meta.width && meta.width > maxWidth) {
    img = img.resize({ width: maxWidth });
  }
  return img;
}

// Remove same-base image files with a different extension so a hardcoded import
// or a glob (e.g. logo.*, banner*.{png,webp,...}) can't pick a stale leftover.
async function cleanupSiblings(dir, base, keepExt) {
  for (const ext of IMAGE_EXTS) {
    if (ext === keepExt) continue;
    try {
      await unlink(join(dir, `${base}.${ext}`));
    } catch {
      /* not present — fine */
    }
  }
}

// sharp cannot write .ico. Wrap a PNG payload in a minimal ICO container
// (ICO supports embedded PNG since Windows Vista; modern browsers read it).
function buildIco(pngBuffer, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // width  (0 => 256)
  entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8); // size of image data
  entry.writeUInt32LE(6 + 16, 12); // offset of image data
  return Buffer.concat([header, entry, pngBuffer]);
}

async function toPng(buf, dir, base, opts) {
  // Lossless PNG optimization: identical pixels, ~80% smaller than sharp's
  // default png() on photographic banners/slides. No banding, safe for hero art.
  const img = await prep(buf, opts);
  await img.png({ compressionLevel: 9, effort: 10 }).toFile(join(dir, `${base}.png`));
  await cleanupSiblings(dir, base, "png");
  return `${base}.png`;
}

async function toWebp(buf, dir, base, opts) {
  const img = await prep(buf, opts);
  await img.webp({ quality: 90, effort: 6 }).toFile(join(dir, `${base}.webp`));
  await cleanupSiblings(dir, base, "webp");
  return `${base}.webp`;
}

// sharp can't vectorize a bitmap. For a raster favicon, wrap a square PNG as a
// base64 data URI inside a minimal SVG so favicon.svg still refreshes with the
// new brand instead of keeping the previous one. (A real .svg upload is written
// through untouched — see the favicon slot.)
async function rasterToSvg(buf, size = 512) {
  const png = await sharp(buf)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const dataUri = `data:image/png;base64,${png.toString("base64")}`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
      `<image width="${size}" height="${size}" href="${dataUri}"/>` +
      `</svg>\n`,
    "utf8",
  );
}

// ── Background: image | solid colour | gradient ─────────────────────────────
// The three are mutually exclusive; handleBackground() below enforces that
// exactly one of them was supplied and rejects zero or two+.

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// Validate + expand to 6-digit lowercase. Every colour that reaches the CSS
// string / bg.json goes through here, so an operator can never inject arbitrary
// CSS (e.g. `red;url(...)`) into the value MainLayout drops into a style attr.
function hexColor(value, label) {
  const s = String(value ?? "").trim();
  if (!HEX_RE.test(s)) {
    throw new Error(`${label} ต้องเป็นรหัสสี hex เช่น #1a2b3c (ได้รับ: ${s || "ว่าง"})`);
  }
  const body = s.slice(1).toLowerCase();
  return "#" + (body.length === 3 ? [...body].map((c) => c + c).join("") : body);
}

function angleDeg(value) {
  const n = Number(String(value ?? "").trim() || 180);
  if (!Number.isFinite(n)) throw new Error(`มุมไล่สีต้องเป็นตัวเลข (ได้รับ: ${value})`);
  return ((n % 360) + 360) % 360;
}

// The CSS value MainLayout paints. Built from validated hex + a clamped angle,
// and it is exactly the string the browser preview shows — no image involved.
function gradientCss({ type, from, to, angle }) {
  return type === "radial"
    ? `radial-gradient(circle at 50% 50%, ${from}, ${to})`
    : `linear-gradient(${angle}deg, ${from}, ${to})`;
}

// Persist the chosen background mode for MainLayout. Colour/gradient ship as a
// CSS string (no bitmap); image mode resets the config so a previously stored
// colour/gradient can't keep overriding the freshly uploaded bg.png.
async function writeBgConfig(config) {
  await writeFile(BG_CONFIG, JSON.stringify(config, null, 2) + "\n");
  return "bg.json";
}

async function handleBackground(params, buf) {
  const color = (params.get("color") || "").trim();
  const from = (params.get("from") || "").trim();
  const to = (params.get("to") || "").trim();

  // The 3 conditions — exactly one must be present.
  const picked = [
    buf.length > 0 && "image",
    color !== "" && "color",
    (from !== "" || to !== "") && "gradient",
  ].filter(Boolean);

  if (picked.length === 0) {
    throw new Error("background: ต้องเลือก 1 อย่าง — อัพโหลดรูป / เลือกสีเดียว / ไล่สี (gradient)");
  }
  if (picked.length > 1) {
    throw new Error(`background: เลือกได้อย่างเดียวเท่านั้น แต่ส่งมา ${picked.length} อย่าง (${picked.join(" + ")})`);
  }

  switch (picked[0]) {
    case "image": {
      const png = await toPng(buf, ASSETS, "bg");
      const cfg = await writeBgConfig({ mode: "image" });
      return [png, cfg];
    }
    case "color":
      return [await writeBgConfig({ mode: "color", color: hexColor(color, "สีพื้นหลัง") })];
    case "gradient": {
      const type = params.get("type") === "radial" ? "radial" : "linear";
      const css = gradientCss({
        type,
        from: hexColor(from, "สีเริ่มต้นของ gradient"),
        to: hexColor(to, "สีปลายทางของ gradient"),
        angle: angleDeg(params.get("angle")),
      });
      return [await writeBgConfig({ mode: "gradient", css })];
    }
  }
}

// ── Text links: affiliate redirect + LINE redirect ──────────────────────────
// These are not files — they are string literals living inside source files:
//   • login.astro / register.astro:  const targetUrl = "<aff>";
//   • astro.config.mjs redirects:     "/line": "<line>",
// The uploader edits those literals in place so an operator can rebrand the
// links without touching code. Both values land inside a double-quoted string,
// so validateLink() rejects anything that isn't a clean http(s) URL — an
// operator can never inject a stray quote/newline and break the file.

const AFF_RE = /(const\s+targetUrl\s*=\s*)"[^"]*"/;
const LINE_RE = /("\/line"\s*:\s*)"[^"]*"/;

function validateLink(value, label) {
  const s = String(value ?? "").trim();
  if (!s) throw new Error(`${label}: ยังไม่ได้กรอกลิงก์`);
  if (/["'\n\r\\]/.test(s)) throw new Error(`${label}: ลิงก์มีอักขระต้องห้าม (\" ' \\ หรือขึ้นบรรทัดใหม่)`);
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error(`${label}: ต้องเป็น URL ที่ถูกต้อง เช่น https://example.com/abc (ได้รับ: ${s})`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`${label}: รองรับเฉพาะ http/https (ได้รับ: ${u.protocol})`);
  }
  return s;
}

// Replace `regex`'s captured literal in one file; error if the anchor is gone
// (e.g. someone renamed targetUrl) rather than silently writing nothing.
async function replaceInFile(file, regex, value, label) {
  const src = await readFile(file, "utf8");
  if (!regex.test(src)) throw new Error(`${label}: ไม่พบตำแหน่งลิงก์ในไฟล์ ${file}`);
  await writeFile(file, src.replace(regex, `$1"${value}"`));
}

async function handleAffLink(value) {
  const url = validateLink(value, "ลิงก์ aff");
  await replaceInFile(join(PAGES, "login.astro"), AFF_RE, url, "ลิงก์ aff (login)");
  await replaceInFile(join(PAGES, "register.astro"), AFF_RE, url, "ลิงก์ aff (register)");
  return ["src/pages/login.astro", "src/pages/register.astro"];
}

async function handleLineLink(value) {
  const url = validateLink(value, "ลิงก์ไลน์");
  await replaceInFile(CONFIG, LINE_RE, url, "ลิงก์ไลน์ (/line)");
  return ["astro.config.mjs"];
}

// Read the links currently in the source so the UI can pre-fill its inputs.
async function readCurrentLinks() {
  const out = { aff: "", line: "" };
  try {
    out.aff = (await readFile(join(PAGES, "login.astro"), "utf8")).match(AFF_RE)?.[0]?.match(/"([^"]*)"/)?.[1] || "";
  } catch { /* file missing — leave blank */ }
  try {
    out.line = (await readFile(CONFIG, "utf8")).match(LINE_RE)?.[0]?.match(/:\s*"([^"]*)"/)?.[1] || "";
  } catch { /* file missing — leave blank */ }
  return out;
}

// ── Sub-page SEO: Title + Meta description, sourced from content.docx ────────
// The four sub-pages set their <title>/<meta name="description"> via props on a
// single <MainLayout title="..." description="..."> tag (MainLayout renders them
// into the head + OG/Twitter). The brand's content.docx carries a
// "SUB-PAGES (Title & Meta Description)" section with a [heading] per page and a
// "Title:" / "Meta:" line under each. The uploader parses that section so an
// operator can pull the copy in, review it, and save it into the pages.
//
// Which page each entry maps to: keyed by the Thai heading used in the docx,
// matched loosely (with/without brackets, a few synonyms) so small wording
// differences still land on the right file.
const PAGE_META = {
  promotion: { file: "promotion.astro", label: "โปรโมชั่น", match: ["โปรโมชั่น", "promotion"] },
  contactus: { file: "contact-us.astro", label: "ติดต่อเรา", match: ["ติดต่อเรา", "ติดต่อ", "contact"] },
  demo: { file: "ทดลองเล่น.astro", label: "ทดลองเล่น", match: ["ทดลองเล่น", "ทดลอง", "demo"] },
  entrance: { file: "ทางเข้า.astro", label: "ทางเข้า", match: ["ทางเข้า", "entrance"] },
};

// ── Optional extra pages the operator can toggle on ─────────────────────────
// Unlike PAGE_META (which edits pages that always exist), these files may not
// exist yet. Toggling one on SCAFFOLDS a new src/pages/*.astro — a blank shell
// that inherits the current brand's chrome (it clones the frontmatter of an
// existing sub-page so it picks up whatever Announcement/ContentBox variant the
// brand uses) and gets a nav link wired in — leaving a TODO body for Claude to
// fill from the docx during the rebrand. Toggling off does NOTHING (never
// deletes): off simply means "don't create". `route` is the Astro file-based
// route (Thai filename → Thai route); `navLabel` is the menu text; `boxTitle`
// is the placeholder ContentBox heading. Add a row here to offer another page.
const PRESET_PAGES = {
  article: { file: "บทความ.astro", route: "/บทความ", navLabel: "บทความ", boxTitle: "บทความ" },
  aboutus: { file: "about-us.astro", route: "/about-us", navLabel: "เกี่ยวกับเรา", boxTitle: "เกี่ยวกับเรา" },
};
// A generated page is cloned from this existing sub-page's frontmatter so it
// stays on the brand's current component variants without hardcoding names here.
const CANONICAL_PAGE = "ทางเข้า.astro";
// The layout imports exactly one active navbar; a new page's link must go into
// whichever file that is (it rotates each rebrand), so resolve it dynamically.
const NAV_IMPORT_RE = /import\s+Navbar\s+from\s+["']\.\.\/components\/([^"']+)["']/;

// Anchor on the <MainLayout ...> opening tag specifically. The Thai pages also
// pass a title= to <ContentBox>, so a bare /title=/ would hit the wrong tag —
// these two regexes only ever touch attributes inside the MainLayout tag.
const ML_TITLE_RE = /(<MainLayout\b[^>]*?\btitle=)"[^"]*"/;
// Also normalises the pre-existing `,description=` typo in contact-us.astro to a
// clean ` description=` on write.
const ML_DESC_RE = /(<MainLayout\b[^>]*?)[,\s]+description=("|')[^"']*\2/;

// Title/Meta land inside a double-quoted Astro attribute, so forbid anything
// that would break out of it (quote, angle brackets, backtick, newline). Thai
// text and the "|" separator used in the briefs are fine.
function validateText(value, label) {
  const s = String(value ?? "").trim();
  if (!s) throw new Error(`${label}: ยังไม่ได้กรอกข้อความ`);
  if (/["'<>`\n\r]/.test(s)) throw new Error(`${label}: ห้ามมีอักขระ \" ' < > \` หรือขึ้นบรรทัดใหม่`);
  return s;
}

// ── Minimal ZIP reader (a .docx is a ZIP; no zip dependency in this repo) ────
// Read via the central directory (reliable sizes/offsets even for streamed
// entries) and inflate the one member we need. Enough for Office-produced docx.
function extractZipEntry(buf, wantName) {
  // End Of Central Directory record: signature 0x06054b50, scan from the end.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ไฟล์ docx ไม่ถูกต้อง (ไม่พบ EOCD ของ ZIP)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // offset of central directory
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break; // central file header sig
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === wantName) {
      // Jump to the local header to find where the data actually starts.
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      return method === 0 ? data : inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`ไม่พบ ${wantName} ใน docx`);
}

function decodeXmlEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

// One text line per Word paragraph (concatenate its <w:t> runs).
function docxToLines(xml) {
  const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  const lines = [];
  for (const para of paras) {
    const runs = [...para.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
    const line = decodeXmlEntities(runs.join("")).trim();
    if (line) lines.push(line);
  }
  return lines;
}

// Given the docx lines, find the [heading] blocks and pull the Title/Meta line
// under each, mapping headings to page keys via PAGE_META. best-effort: pages
// not found in the docx are reported in `warnings`, never guessed.
function parseSubPages(lines) {
  const pages = {};
  const found = new Set();
  let current = null; // page key of the section we're inside
  const titleRe = /^\s*title\s*[:：]\s*(.+)$/i;
  const metaRe = /^\s*(?:meta|des|description)\s*[:：]\s*(.+)$/i;
  for (const raw of lines) {
    const line = raw.trim();
    // A heading line switches the current section. Strip brackets, then see
    // whether any page's match-terms appear in it.
    const bare = line.replace(/^\[|\]$/g, "").trim();
    const hit = Object.entries(PAGE_META).find(
      ([, cfg]) => cfg.match.some((m) => bare.includes(m)),
    );
    // Treat a line as a heading only when it's short and not a Title/Meta line —
    // avoids a long paragraph that merely mentions "โปรโมชั่น" flipping sections.
    if (hit && bare.length <= 40 && !titleRe.test(line) && !metaRe.test(line)) {
      current = hit[0];
      pages[current] ??= { title: "", meta: "" };
      continue;
    }
    if (!current) continue;
    const t = line.match(titleRe);
    if (t) { pages[current].title = t[1].trim(); found.add(current); continue; }
    const d = line.match(metaRe);
    if (d) { pages[current].meta = d[1].trim(); found.add(current); }
  }
  // Keep only pages that yielded at least a title or meta.
  const result = {};
  for (const key of found) result[key] = pages[key];
  const warnings = Object.keys(PAGE_META)
    .filter((k) => !result[k])
    .map((k) => `${PAGE_META[k].label}: ไม่พบใน docx`);
  return { pages: result, warnings };
}

// Parse a docx buffer straight into sub-page copy — used both for the staged
// file and for a file the operator has only browsed (not uploaded yet), so the
// preview reflects the source they actually picked.
function parseDocxBuffer(buf) {
  const xml = extractZipEntry(buf, "word/document.xml").toString("utf8");
  return parseSubPages(docxToLines(xml));
}

async function readDocxSubPages() {
  let buf;
  try {
    buf = await readFile(join(ASSETS, "content.docx"));
  } catch {
    return { pages: {}, warnings: ["ยังไม่มี content.docx — อัพโหลด Content brief ในส่วนที่ 1 ก่อน"] };
  }
  return parseDocxBuffer(buf);
}

// Read the title/description currently on each page's <MainLayout> tag so the UI
// can pre-fill (and so the operator sees what a blank docx result falls back to).
async function readCurrentPageMeta() {
  const out = {};
  for (const [key, cfg] of Object.entries(PAGE_META)) {
    const entry = { file: `src/pages/${cfg.file}`, label: cfg.label, title: "", meta: "" };
    try {
      const src = await readFile(join(PAGES, cfg.file), "utf8");
      entry.title = src.match(ML_TITLE_RE)?.[0]?.match(/"([^"]*)"$/)?.[1] || "";
      entry.meta = src.match(ML_DESC_RE)?.[0]?.match(/description=("|')([^"']*)\1/)?.[2] || "";
    } catch { /* file missing — leave blank */ }
    out[key] = entry;
  }
  return out;
}

// Write Title/Meta onto a file's <MainLayout> tag. Errors (rather than silently
// no-ops) if either prop anchor is missing. Shared by the existing sub-pages and
// the optional preset pages, which use the same <MainLayout title/desc> shape.
async function setMainLayoutMeta(file, title, desc, label) {
  const t = validateText(title, `Title ${label}`);
  const d = validateText(desc, `Meta ${label}`);
  const src = await readFile(file, "utf8");
  if (!ML_TITLE_RE.test(src)) throw new Error(`${label}: ไม่พบ title บนแท็ก <MainLayout>`);
  if (!ML_DESC_RE.test(src)) throw new Error(`${label}: ไม่พบ description บนแท็ก <MainLayout>`);
  const next = src
    .replace(ML_TITLE_RE, `$1"${t}"`)
    .replace(ML_DESC_RE, `$1 description="${d}"`);
  await writeFile(file, next);
}

async function writePageMeta(key, title, desc) {
  const cfg = PAGE_META[key];
  if (!cfg) throw new Error(`unknown page: ${key}`);
  const label = `${cfg.label} (${cfg.file})`;
  await setMainLayoutMeta(join(PAGES, cfg.file), title, desc, label);
  return [`src/pages/${cfg.file}`];
}

async function fileExists(p) {
  try { await readFile(p); return true; } catch { return false; }
}

// Scaffold (or refresh) an optional preset page. Title/Meta are OPTIONAL: blank
// is fine — the tool has no AI to "write" copy, so a blank new page gets safe
// default Title/Meta (just enough to build with non-empty SEO) and a ContentBox
// body holding a 1-paragraph placeholder. Claude writes the real Title/Meta AND
// the real ~1-paragraph article at rebrand time (SKILL.md Phase 4.5). If the
// file already exists we NEVER overwrite the body, and only refresh Title/Meta
// when BOTH were supplied (blank = leave the existing page untouched).
async function createPage(key, title, desc) {
  const cfg = PRESET_PAGES[key];
  if (!cfg) throw new Error(`ไม่รู้จักหน้า preset: ${key}`);
  const label = `${cfg.navLabel} (${cfg.file})`;
  const file = join(PAGES, cfg.file);
  const hasTitle = !!(title && title.trim());
  const hasDesc = !!(desc && desc.trim());
  if (await fileExists(file)) {
    if (hasTitle && hasDesc) await setMainLayoutMeta(file, title, desc, label);
    return { written: [`src/pages/${cfg.file}`], created: false };
  }
  // new page: blank Title/Meta fall back to safe defaults (Claude rewrites both
  // + the article body when the rebrand runs).
  const t = hasTitle ? validateText(title, `Title ${label}`) : cfg.boxTitle;
  const d = hasDesc ? validateText(desc, `Meta ${label}`) : `หน้า${cfg.navLabel} (อยู่ระหว่างจัดทำเนื้อหา)`;
  const canonical = await readFile(join(PAGES, CANONICAL_PAGE), "utf8");
  const fm = canonical.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) throw new Error(`ไม่พบ frontmatter ใน ${CANONICAL_PAGE} (ต้นแบบหน้าย่อย)`);
  const page =
    `---\n${fm[1]}\n---\n\n` +
    `<MainLayout title="${t}" description="${d}">\n` +
    `  <Announcement />\n\n` +
    `  <ContentBox title="${cfg.boxTitle}">\n` +
    `    <!-- TODO(rebrand): เขียนบทความจริงของ "${cfg.navLabel}" ~1 ย่อหน้าใน <ContentBox> นี้ + ตั้ง title/description บน <MainLayout> จาก content.docx ตอนรีแบรนด์ -->\n` +
    `    <p class="py-6 text-center text-white/70">อยู่ระหว่างปรับปรุงเนื้อหา</p>\n` +
    `  </ContentBox>\n\n` +
    `  <Navfoot />\n` +
    `</MainLayout>\n`;
  await writeFile(file, page);
  return { written: [`src/pages/${cfg.file}`], created: true };
}

// Best-effort: add a { name, path } entry to the ACTIVE navbar's link arrays
// (resolved from MainLayout's import, since the active file rotates each
// rebrand). Inserts into every inline `[ {…path…} ].map(` array (desktop +
// mobile). Idempotent — skips if the route is already linked. If the navbar
// variant doesn't use that array shape, it writes nothing and returns a warning
// telling the operator/Claude to wire the link by hand.
async function addNavLink(route, label) {
  const ml = await readFile(join(ROOT, "src", "layouts", "MainLayout.astro"), "utf8");
  const m = ml.match(NAV_IMPORT_RE);
  if (!m) return { warning: `หา import Navbar ใน MainLayout.astro ไม่เจอ — เพิ่มลิงก์ ${route} (${label}) ในเมนูเองตอนรีแบรนด์` };
  const navName = m[1];
  const navFile = join(ROOT, "src", "components", navName);
  let src;
  try { src = await readFile(navFile, "utf8"); }
  catch { return { navFile: navName, warning: `เปิด navbar ${navName} ไม่ได้ — เพิ่มลิงก์ ${route} (${label}) ในเมนูเองตอนรีแบรนด์` }; }
  if (src.includes(`path: "${route}"`) || src.includes(`path: '${route}'`)) {
    return { navFile: navName, already: true };
  }
  // Match the LAST object before `].map(` in each nav array; `[^{}]*` keeps the
  // match to a single object. Rebuild it (normalising its trailing comma) and
  // append the new sibling right after it, at the same indentation.
  const re = /(\n([ \t]*))(\{[^{}]*\bpath:\s*["'][^"']*["'][^{}]*\}),?(\s*\]\.map\()/g;
  const item = `{ name: "${label}", path: "${route}" }`;
  let count = 0;
  const next = src.replace(re, (_full, lead, _indent, lastObj, tail) => {
    count++;
    return `${lead}${lastObj},${lead}${item},${tail}`;
  });
  if (count === 0) {
    return { navFile: navName, warning: `navbar ${navName} ไม่ตรงรูปแบบ array ที่รองรับ — เพิ่มลิงก์ ${route} (${label}) ในเมนูเองตอนรีแบรนด์` };
  }
  await writeFile(navFile, next);
  return { navFile: navName, inserted: count };
}

// Read the current state of each preset page so the UI can set its toggle
// (exists → on + prefilled) or badge it as "will be created".
async function readCurrentNewPages() {
  const out = {};
  for (const [key, cfg] of Object.entries(PRESET_PAGES)) {
    const entry = { file: `src/pages/${cfg.file}`, route: cfg.route, label: cfg.navLabel, exists: false, title: "", meta: "" };
    try {
      const src = await readFile(join(PAGES, cfg.file), "utf8");
      entry.exists = true;
      entry.title = src.match(ML_TITLE_RE)?.[0]?.match(/"([^"]*)"$/)?.[1] || "";
      entry.meta = src.match(ML_DESC_RE)?.[0]?.match(/description=("|')([^"']*)\1/)?.[2] || "";
    } catch { /* not created yet — leave blank */ }
    out[key] = entry;
  }
  return out;
}

async function handleUpload(slot, index, ext, buf) {
  const n = Number(index);
  switch (slot) {
    case "logo":
      // One upload, both destinations: src/assets/logo.webp for the component
      // imports and public/logo.webp for the absolute og/schema logo URL. They
      // must stay identical, so there is no separate "public logo" field.
      return [
        "src/assets/" + (await toWebp(buf, ASSETS, "logo")),
        "public/" + (await toWebp(buf, PUBLIC, "logo")),
      ];
    case "docx":
      await writeFile(join(ASSETS, "content.docx"), buf);
      return ["content.docx"];
    case "banner":
      if (!(n >= 1 && n <= 4)) throw new Error("banner index must be 1-4");
      return [await toPng(buf, ASSETS, `banner${n}`)];
    case "slide":
      if (!(n >= 1 && n <= 4)) throw new Error("slide index must be 1-4");
      return [await toPng(buf, ASSETS, `slide${n}`, { box: SLIDE_BOX })];
    case "favicon": {
      const written = [];
      const rasters = [
        ["favicon-96x96.png", 96],
        ["apple-touch-icon.png", 180],
        ["web-app-manifest-192x192.png", 192],
        ["web-app-manifest-512x512.png", 512],
      ];
      for (const [name, size] of rasters) {
        await sharp(buf).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(join(PUBLIC, name));
        written.push(name);
      }
      const icoPng = await sharp(buf).resize(48, 48, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      await writeFile(join(PUBLIC, "favicon.ico"), buildIco(icoPng, 48));
      written.push("favicon.ico");
      if (ext === "svg") {
        await writeFile(join(PUBLIC, "favicon.svg"), buf);
      } else {
        // raster upload: still refresh favicon.svg by embedding the PNG in it
        await writeFile(join(PUBLIC, "favicon.svg"), await rasterToSvg(buf));
      }
      written.push("favicon.svg");
      return written;
    }
    default:
      throw new Error(`unknown slot: ${slot}`);
  }
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolvePromise(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Every other endpoint passes its parameters in the query string and uses the
// body for raw file bytes, so JSON parsing lives here rather than in readBody().
async function readJson(req, cap = 64 * 1024) {
  const buf = await readBody(req);
  // Localhost-only + tiny payloads, so this checks the size after buffering
  // rather than aborting mid-stream.
  if (buf.length > cap) throw new Error("ข้อมูลที่ส่งมาใหญ่เกินไป");
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw new Error("body ไม่ใช่ JSON ที่ถูกต้อง");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ส่วนที่ 6 — run the rebrand itself (spawn `claude -p`, stream back over SSE)
// ════════════════════════════════════════════════════════════════════════════
// The operator stages files with ส่วนที่ 1-5, then fires this. It runs headless,
// so nobody is there to answer a permission prompt — hence bypassPermissions,
// which is also why the prompt is assembled HERE from validated fields instead
// of accepting a free-form prompt from the browser.
//
// One run at a time; its whole event log is kept in memory so a page refresh
// (or a browser that slept) can replay from any index and pick the live stream
// back up. Closing the uploader's console window kills the run — closing the
// browser tab does not.

// `claude` resolves off PATH (it is a real .exe on Windows, not a .cmd shim, so
// spawn() finds it without a shell — which is what lets a long Thai prompt be
// passed as one argv entry with no quoting/escaping at all).
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const RUN_TIMEOUT_MS = Number(process.env.REBRAND_TIMEOUT_MS) || 90 * 60 * 1000;
// Ring-buffer the log: a long rebrand emits thousands of events and this process
// also serves uploads, so the oldest lines are dropped rather than grown forever.
const MAX_EVENTS = 4000;
// Guard against a single pathological NDJSON line (a huge tool_result) growing
// the split buffer without bound.
const MAX_LINE_BUF = 8 * 1024 * 1024;

// Brand names go into the prompt as an argv entry, so the only real hazard is a
// value that argv-parses as a flag; the character class also keeps a typo'd
// paste from silently becoming the brand. Thai + latin + digits + . _ - space.
const BRAND_RE = /^[A-Za-z0-9฀-๿][A-Za-z0-9฀-๿ ._-]{0,39}$/;

// The exact prompt shape SKILL.md:108-119 decodes:
//   rebrand and retheme to "<BRAND>"[ then real url is "<URL>"] ทำแบบ 2-agent ขนานตาม playbook[ — <notes>]
// The URL clause is dropped when blank — that absence is what tells the skill to
// leave the domain alone. The trailing stop-clause is added only for a fired run
// (unattended): a human pasting this into Claude Code is there to say "no".
function buildRebrandPrompt({ brand, url, notes }, { unattended = true } = {}) {
  const b = String(brand ?? "").trim();
  if (!b) throw new Error("ชื่อแบรนด์: ยังไม่ได้กรอก");
  if (!BRAND_RE.test(b)) throw new Error("ชื่อแบรนด์: ใช้ได้เฉพาะ A-Z 0-9 ไทย เว้นวรรค และ . _ - (ไม่เกิน 40 ตัว)");
  let p = 'rebrand and retheme to "' + b + '"';
  const u = String(url ?? "").trim();
  if (u) p += ' then real url is "' + validateLink(u, "URL production") + '"';
  p += " ทำแบบ 2-agent ขนานตาม playbook";
  const n = String(notes ?? "").replace(/[\r\n]+/g, " ").trim();
  if (n) p += " — " + validateText(n, "หมายเหตุ");
  if (unattended) p += " — หยุดที่ build + verify เท่านั้น ห้าม deploy และห้าม git push";
  return p;
}

// Cheap end-to-end test of spawn → NDJSON → SSE → UI without burning 40 minutes.
const DRY_PROMPT = 'ตอบกลับสั้นๆ ว่า "ท่อ uploader ทำงานปกติ" แล้วจบเลย ห้ามใช้ tool ใดๆ ห้ามแก้ไฟล์';

const runState = {
  id: null,
  status: "idle", // idle | running | stopping | done | error | stopped
  dry: false,
  child: null,
  prompt: "",
  startedAt: 0,
  endedAt: 0,
  exitCode: null,
  stopReason: null,
  sessionId: null,
  model: null,
  numTurns: 0,
  costUsd: null,
  toolCount: 0,
  files: new Set(),
  events: [],
  nextSeq: 0,
  clients: new Set(),
  timer: null,
};

const isActive = () => runState.status === "running" || runState.status === "stopping";

// Absolute sequence numbers (not array indices) survive the ring buffer, so a
// reconnecting client asks for "?from=<last seen + 1>" and gets exactly what it
// missed — or the oldest surviving event if it was away too long.
function pushEvent(type, payload = {}) {
  const ev = { i: runState.nextSeq++, t: Date.now(), type, ...payload };
  runState.events.push(ev);
  if (runState.events.length > MAX_EVENTS) runState.events.shift();
  const frame = "data: " + JSON.stringify(ev) + "\n\n";
  for (const client of runState.clients) {
    try { client.write(frame); } catch { /* dead socket; the close handler removes it */ }
  }
  return ev;
}

function relFromRoot(p) {
  const s = String(p || "").replace(/\\/g, "/");
  const root = ROOT.replace(/\\/g, "/");
  return s.toLowerCase().startsWith(root.toLowerCase() + "/") ? s.slice(root.length + 1) : s;
}

// One short line describing what a tool call is doing, from whichever field
// carries the meaning for that tool.
function summarizeToolInput(input) {
  if (!input || typeof input !== "object") return "";
  const pick =
    input.file_path ?? input.path ?? input.command ?? input.description ??
    input.pattern ?? input.url ?? input.skill ?? input.prompt ?? "";
  const s = String(pick).replace(/\s+/g, " ").trim();
  return s.length > 180 ? s.slice(0, 177) + "…" : s;
}

function flattenToolResult(content) {
  if (typeof content === "string") return content.slice(0, 400);
  if (Array.isArray(content)) {
    return content.map((b) => (typeof b === "string" ? b : b?.text || "")).join(" ").slice(0, 400);
  }
  return "";
}

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

// Translate one stream-json message from the CLI into the compact events the UI
// renders. Unknown message types are ignored on purpose — the CLI adds new ones
// over time and a rebrand must not fall over because of a message we don't know.
function handleCliMessage(msg) {
  switch (msg?.type) {
    case "system":
      if (msg.subtype === "init") {
        runState.sessionId = msg.session_id || null;
        runState.model = msg.model || null;
        pushEvent("init", { text: "session " + (runState.sessionId || "?") + " · model " + (runState.model || "?") });
      }
      break;

    case "assistant": {
      // parent_tool_use_id is set for text forwarded from a subagent
      // (--forward-subagent-text): the 2-agent parallel playbook would otherwise
      // look frozen for many minutes at a stretch.
      const sub = msg.parent_tool_use_id ? 1 : 0;
      for (const b of msg.message?.content || []) {
        if (b.type === "text" && b.text && b.text.trim()) {
          pushEvent("text", { text: b.text.trim(), sub });
        } else if (b.type === "tool_use") {
          runState.toolCount++;
          const ev = { name: b.name, text: summarizeToolInput(b.input), sub };
          if (EDIT_TOOLS.has(b.name) && b.input?.file_path) {
            ev.file = relFromRoot(b.input.file_path);
            runState.files.add(ev.file);
          }
          pushEvent("tool", ev);
        }
      }
      break;
    }

    case "user":
      for (const b of msg.message?.content || []) {
        if (b.type === "tool_result" && b.is_error) {
          pushEvent("tool_error", { text: flattenToolResult(b.content) });
        }
      }
      break;

    case "result":
      runState.numTurns = msg.num_turns ?? runState.numTurns;
      runState.costUsd = typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : null;
      pushEvent("result", {
        subtype: msg.subtype || "",
        text: typeof msg.result === "string" ? msg.result.trim() : "",
        durationMs: msg.duration_ms ?? null,
        numTurns: runState.numTurns,
        costUsd: runState.costUsd,
      });
      break;
  }
}

function finishRun(code, signal) {
  clearTimeout(runState.timer);
  runState.timer = null;
  runState.exitCode = code;
  runState.endedAt = Date.now();
  if (runState.stopReason === "timeout") runState.status = "error";
  else if (runState.stopReason === "manual") runState.status = "stopped";
  else runState.status = code === 0 ? "done" : "error";
  runState.child = null;
  pushEvent("end", {
    status: runState.status,
    exitCode: code,
    signal: signal || null,
    elapsedMs: runState.endedAt - runState.startedAt,
    files: [...runState.files],
    toolCount: runState.toolCount,
    numTurns: runState.numTurns,
    costUsd: runState.costUsd,
  });
  for (const client of runState.clients) {
    try { client.end(); } catch { /* already gone */ }
  }
  runState.clients.clear();
}

function startRun({ brand, url, notes, dry }) {
  if (isActive()) throw new Error("มีงาน rebrand กำลังรันอยู่แล้ว — รอให้จบหรือกดหยุดก่อน");
  const prompt = dry ? DRY_PROMPT : buildRebrandPrompt({ brand, url, notes });

  const args = [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",                 // required by stream-json
    "--forward-subagent-text",   // surface both parallel agents in the log
    "--permission-mode", "bypassPermissions",
  ];

  Object.assign(runState, {
    id: randomUUID(),
    status: "running",
    dry: !!dry,
    prompt,
    startedAt: Date.now(),
    endedAt: 0,
    exitCode: null,
    stopReason: null,
    sessionId: null,
    model: null,
    numTurns: 0,
    costUsd: null,
    toolCount: 0,
    files: new Set(),
    events: [],
    nextSeq: 0,
  });

  let child;
  try {
    child = spawn(CLAUDE_BIN, args, {
      cwd: ROOT,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    runState.status = "error";
    throw new Error("รัน " + CLAUDE_BIN + " ไม่ได้: " + err.message);
  }
  runState.child = child;

  pushEvent("start", {
    text: (dry ? "[ทดสอบท่อ] " : "") + prompt,
    dry: !!dry,
    id: runState.id,
    startedAt: runState.startedAt,
  });

  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    if (buf.length > MAX_LINE_BUF) {
      pushEvent("stderr", { text: "บรรทัด output ยาวผิดปกติ — ตัดทิ้ง 1 ก้อน" });
      buf = "";
      return;
    }
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        handleCliMessage(JSON.parse(line));
      } catch {
        // Not JSON: a CLI notice/warning printed on stdout. Show it verbatim —
        // this is usually the only clue when a flag is wrong.
        pushEvent("raw", { text: line.slice(0, 500) });
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) pushEvent("stderr", { text: text.slice(0, 2000) });
  });

  child.on("error", (err) => {
    const hint = err.code === "ENOENT"
      ? "ไม่พบคำสั่ง " + CLAUDE_BIN + " — ติดตั้ง Claude Code หรือกำหนด CLAUDE_BIN=<เต็มพาธของ claude.exe> ก่อนรัน uploader"
      : err.message;
    pushEvent("stderr", { text: hint });
    if (isActive()) finishRun(null, null);
  });

  child.on("close", (code, signal) => {
    if (!isActive()) return;
    finishRun(code, signal);
  });

  runState.timer = setTimeout(() => {
    if (!isActive()) return;
    pushEvent("stderr", { text: "เกินเวลา " + Math.round(RUN_TIMEOUT_MS / 60000) + " นาที — กำลังหยุด" });
    stopRun("timeout");
  }, RUN_TIMEOUT_MS);

  return runSnapshot();
}

// child.kill() alone leaves the node/npm processes that Claude spawned running,
// so on Windows kill the whole tree.
function stopRun(reason = "manual") {
  if (!isActive() || !runState.child) throw new Error("ไม่มีงานที่กำลังรันอยู่");
  runState.status = "stopping";
  runState.stopReason = reason;
  pushEvent("stopping", { text: reason === "timeout" ? "หยุดเพราะเกินเวลา" : "ผู้ใช้กดหยุด" });
  const pid = runState.child.pid;
  if (process.platform === "win32" && pid) {
    try {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      try { runState.child.kill(); } catch { /* already dead */ }
    }
  } else {
    try { runState.child.kill("SIGTERM"); } catch { /* already dead */ }
  }
}

function runSnapshot() {
  return {
    id: runState.id,
    status: runState.status,
    dry: runState.dry,
    prompt: runState.prompt,
    startedAt: runState.startedAt || null,
    endedAt: runState.endedAt || null,
    elapsedMs: runState.startedAt ? (runState.endedAt || Date.now()) - runState.startedAt : 0,
    sessionId: runState.sessionId,
    model: runState.model,
    exitCode: runState.exitCode,
    numTurns: runState.numTurns,
    costUsd: runState.costUsd,
    toolCount: runState.toolCount,
    files: [...runState.files],
    nextSeq: runState.nextSeq,
    oldestSeq: runState.events[0]?.i ?? runState.nextSeq,
  };
}

// Shown in the confirm dialog so an operator sees whether today's brief is
// actually staged before firing a 40-minute run.
async function stagedDocxInfo() {
  try {
    const s = await stat(join(ASSETS, "content.docx"));
    return { exists: true, mtime: s.mtimeMs, size: s.size };
  } catch {
    return { exists: false, mtime: null, size: 0 };
  }
}

const PAGE = /* html */ `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Rebrand Asset Uploader</title>
<link rel="icon" href="data:," />
<style>
  :root {
    color-scheme: dark;
    --bg: #0b1120;
    --panel: #0f172a;
    --card-a: #1c2740;
    --card-b: #141d33;
    --line: #26324c;
    --line-soft: #1e293b;
    --ink: #e6edf7;
    --muted: #93a3bd;
    --faint: #64748b;
    --accent: #38bdf8;
    --accent-2: #6366f1;
    --grad: linear-gradient(135deg, #38bdf8 0%, #6366f1 100%);
    --grad-line: linear-gradient(90deg, #38bdf8, #6366f1);
    --ok: #4ade80;
    --err: #f87171;
    --radius: 16px;
  }
  * { box-sizing: border-box; }
  html, body { overflow-x: hidden; }
  body {
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    margin: 0; color: var(--ink); min-height: 100vh;
    background:
      radial-gradient(900px 500px at 82% -8%, rgba(99,102,241,0.18), transparent 60%),
      radial-gradient(760px 460px at 6% 2%, rgba(56,189,248,0.14), transparent 55%),
      var(--bg);
    background-attachment: fixed;
  }

  /* ── header ─────────────────────────────────────────── */
  header {
    position: sticky; top: 0; z-index: 20;
    padding: 18px 30px;
    background: rgba(11,17,32,0.72);
    backdrop-filter: blur(14px);
    border-bottom: 1px solid var(--line-soft);
  }
  .head-inner { margin: 0; }
  header h1 {
    margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em;
    display: flex; align-items: center; gap: 12px;
  }
  header h1 .mark {
    width: 34px; height: 34px; border-radius: 10px; flex: none;
    background: var(--grad); display: grid; place-items: center;
    font-size: 18px; box-shadow: 0 8px 20px -6px rgba(56,189,248,0.55);
  }
  header h1 .grad-text {
    background: var(--grad); -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  header p { margin: 8px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.6; max-width: 900px; }
  header code { background: rgba(148,163,184,0.14); padding: 1px 6px; border-radius: 5px; font-size: 11.5px; color: #cbd5e1; }
  header strong { color: #cbd5e1; }

  /* ── layout: full-width grid, cards flow 1→5 left→right, wrap on overflow ─ */
  /* auto-fill (not auto-fit) keeps column tracks fixed, so a lone card on the
     last row stays one column wide instead of stretching across the full width. */
  main {
    counter-reset: card;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    align-items: start;
    gap: 22px; padding: 26px 30px 120px; margin: 0;
  }
  @media (max-width: 640px) {
    main { grid-template-columns: 1fr; padding: 20px 16px 120px; }
    header { padding: 16px; }
  }

  /* ── card ───────────────────────────────────────────── */
  .card {
    counter-increment: card;
    position: relative; isolation: isolate;
    background: linear-gradient(180deg, var(--card-a), var(--card-b));
    border: 1px solid var(--line); border-radius: var(--radius);
    padding: 22px 22px 20px;
    box-shadow: 0 14px 36px -22px rgba(0,0,0,0.85);
    transition: border-color .18s ease, box-shadow .18s ease;
  }
  .card::before {
    content: ""; position: absolute; inset: 0 0 auto 0; height: 3px;
    background: var(--grad-line); border-radius: var(--radius) var(--radius) 0 0;
    opacity: .9;
  }
  .card:hover { border-color: #34456a; box-shadow: 0 22px 46px -24px rgba(0,0,0,0.95); }
  .card h2 {
    margin: 0 0 6px; font-size: 16px; font-weight: 700; letter-spacing: -0.01em;
    display: flex; align-items: center; gap: 11px;
  }
  .card h2::before {
    content: counter(card); flex: none;
    width: 27px; height: 27px; border-radius: 9px;
    display: grid; place-items: center;
    background: var(--grad); color: #05101f; font-weight: 800; font-size: 13px;
    box-shadow: 0 5px 14px -4px rgba(56,189,248,0.5);
  }
  .card > .sub { margin: 0 0 14px; padding-left: 38px; font-size: 12px; color: var(--muted); line-height: 1.55; }

  /* ── fields ─────────────────────────────────────────── */
  .field { display: flex; flex-direction: column; gap: 7px; padding: 13px 0; border-top: 1px solid var(--line-soft); }
  .field:first-of-type { border-top: 0; padding-top: 4px; }
  .field .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .field label { font-size: 13.5px; font-weight: 600; color: #dbe4f0; }
  .field .target {
    font-size: 10.5px; color: var(--accent); font-family: ui-monospace, monospace;
    background: rgba(56,189,248,0.08); border: 1px solid rgba(56,189,248,0.2);
    padding: 2px 8px; border-radius: 6px;
  }
  .field .opt {
    font-size: 10px; color: var(--faint); font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
    background: rgba(148,163,184,0.1); padding: 2px 7px; border-radius: 999px;
  }

  /* inputs — unified look */
  .field input[type=file] { font-size: 12px; color: var(--muted); max-width: 100%; }
  input[type=file]::file-selector-button {
    font: inherit; font-weight: 600; font-size: 12px; cursor: pointer; margin-right: 10px;
    color: var(--accent); background: var(--panel);
    border: 1px solid var(--line); border-radius: 8px; padding: 7px 13px;
    transition: background .15s, border-color .15s;
  }
  input[type=file]::file-selector-button:hover { background: #0b2b40; border-color: var(--accent); }
  .field input.linkinput, .field .metatitle, .field .metadesc {
    width: 100%; font-size: 13px; color: var(--ink);
    background: var(--panel); border: 1px solid var(--line); border-radius: 9px; padding: 10px 12px;
    transition: border-color .15s, box-shadow .15s;
  }
  .field input.linkinput { font-family: ui-monospace, monospace; }
  .field .metadesc { resize: vertical; font-family: "Segoe UI", system-ui, sans-serif; line-height: 1.5; }
  .field input.linkinput:focus, .field .metatitle:focus, .field .metadesc:focus,
  .panel input:focus, .panel select:focus {
    outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(56,189,248,0.16);
  }
  .field .status { font-size: 11.5px; min-height: 15px; color: var(--muted); }

  /* toggle switch + status badge (ส่วนที่ 5 — optional pages) */
  .switch { position: relative; display: inline-flex; width: 42px; height: 24px; flex: none; cursor: pointer; }
  .switch input { position: absolute; opacity: 0; width: 0; height: 0; }
  .switch .slider { position: absolute; inset: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 999px; transition: .18s; }
  .switch .slider::before { content: ""; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: var(--muted); border-radius: 50%; transition: .18s; }
  .switch input:checked + .slider { background: #0b2b40; border-color: var(--accent); }
  .switch input:checked + .slider::before { transform: translateX(18px); background: var(--accent); }
  .switch input:focus-visible + .slider { box-shadow: 0 0 0 3px rgba(56,189,248,0.16); }
  .badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
  .badge.new { color: var(--ok); background: rgba(74,222,128,0.12); border: 1px solid rgba(74,222,128,0.3); }
  .badge.exists { color: var(--faint); background: rgba(148,163,184,0.1); border: 1px solid var(--line); }
  .np-body { display: flex; flex-direction: column; gap: 7px; margin-top: 8px; }
  .np-body[hidden] { display: none; }

  .thumb { width: 46px; height: 46px; object-fit: contain; border-radius: 9px; background: var(--panel); border: 1px solid var(--line); display: none; }
  .thumb.show { display: block; }

  /* background mode chips + panels */
  .modes { flex-wrap: wrap; gap: 7px; }
  .modes label {
    display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; cursor: pointer;
    padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--panel);
    transition: all .15s;
  }
  .modes label:has(input:checked) { border-color: var(--accent); color: var(--accent); background: #0b2b40; box-shadow: 0 0 0 3px rgba(56,189,248,0.12); }
  .modes input { accent-color: var(--accent); margin: 0; }
  .panel[hidden] { display: none; }
  .panel { flex-wrap: wrap; gap: 8px; }
  .panel input[type=color] { width: 40px; height: 32px; padding: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); cursor: pointer; }
  .panel input[type=text] { width: 92px; font-family: ui-monospace, monospace; font-size: 12px; text-transform: lowercase; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; }
  .panel select { font-size: 12px; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; }
  .panel .hint { font-size: 11px; color: var(--faint); align-self: center; }
  #bgPreview { width: 100%; height: 56px; border-radius: 9px; border: 1px solid var(--line); }

  /* ghost button (pull-from-docx) */
  button.ghost {
    background: var(--panel); color: var(--accent); border: 1px solid var(--line);
    padding: 9px 16px; font-size: 13px; font-weight: 700; border-radius: 9px;
    display: inline-flex; align-items: center; gap: 7px; transition: all .15s;
  }
  button.ghost:hover { background: #0b2b40; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(56,189,248,0.12); }
  .pull-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 2px 0 12px; padding-bottom: 14px; border-bottom: 1px solid var(--line-soft); }
  .pull-hint { flex: 1 1 200px; min-width: 0; font-size: 11px; color: var(--faint); line-height: 1.5; }

  /* ── ส่วนที่ 6: fire the rebrand + live run log ──────── */
  button.fire {
    background: var(--grad); color: #05101f; border: 0;
    padding: 10px 20px; font-size: 14px; font-weight: 800; border-radius: 10px; cursor: pointer;
    box-shadow: 0 8px 20px -8px rgba(56,189,248,0.55); transition: transform .12s, filter .15s;
  }
  button.fire:hover:not(:disabled) { filter: brightness(1.06); transform: translateY(-1px); }
  button.fire:disabled, button.ghost:disabled { opacity: .45; cursor: not-allowed; filter: none; transform: none; box-shadow: none; }
  button.danger { color: var(--err); }
  button.danger:hover:not(:disabled) { background: rgba(248,113,113,0.1); border-color: var(--err); box-shadow: 0 0 0 3px rgba(248,113,113,0.12); }
  .pill {
    font-size: 10.5px; font-weight: 700; padding: 3px 10px; border-radius: 999px;
    border: 1px solid var(--line); background: var(--panel); color: var(--muted);
  }
  .pill.run { color: var(--accent); border-color: rgba(56,189,248,0.4); background: #0b2b40; animation: pulse 1.6s ease-in-out infinite; }
  .pill.done { color: var(--ok); border-color: rgba(74,222,128,0.35); background: rgba(74,222,128,0.1); }
  .pill.bad { color: var(--err); border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.1); }
  @keyframes pulse { 50% { opacity: .55; } }
  .rb-timer { font-family: ui-monospace, monospace; font-size: 12px; color: var(--muted); }
  .rb-stat { font-size: 11px; color: var(--faint); }
  .rb-stat b { color: var(--ink); font-family: ui-monospace, monospace; font-size: 12px; }
  #rbLog {
    margin: 0; max-height: 320px; overflow: auto; white-space: pre-wrap; word-break: break-word;
    font-family: ui-monospace, monospace; font-size: 11.5px; line-height: 1.65;
    background: #070d1a; border: 1px solid var(--line); border-radius: 9px; padding: 10px 12px;
  }
  #rbLog::-webkit-scrollbar { width: 8px; }
  #rbLog::-webkit-scrollbar-thumb { background: var(--line); border-radius: 8px; }
  #rbLog .l { display: block; }
  #rbLog .l.tool { color: var(--accent); }
  #rbLog .l.sub { border-left: 2px solid var(--accent-2); padding-left: 8px; margin-left: 2px; }
  #rbLog .l.meta { color: var(--faint); }
  #rbLog .l.bad { color: var(--err); }
  #rbLog .l.good { color: var(--ok); }
  #rbLog .l .who { color: var(--accent-2); font-weight: 700; }
  #rbFileBox { font-size: 11.5px; color: var(--muted); }
  #rbFileBox summary { cursor: pointer; color: var(--accent); }
  #rbFileList { font-family: ui-monospace, monospace; font-size: 11px; line-height: 1.7; padding: 6px 0 0 14px; max-height: 150px; overflow: auto; white-space: pre-wrap; word-break: break-all; }

  /* ── sticky action bar ──────────────────────────────── */
  .bar {
    position: sticky; bottom: 0; z-index: 15;
    background: rgba(11,17,32,0.82); backdrop-filter: blur(14px);
    border-top: 1px solid var(--line-soft);
    box-shadow: 0 -10px 30px -14px rgba(0,0,0,0.7);
    padding: 15px 30px; display: flex; align-items: center; gap: 18px;
  }
  #uploadAll {
    background: var(--grad); color: #05101f; border: 0;
    padding: 12px 26px; font-size: 15px; font-weight: 800; border-radius: 11px; cursor: pointer;
    box-shadow: 0 10px 24px -8px rgba(56,189,248,0.55); transition: transform .12s, filter .15s, box-shadow .15s;
    flex: none; letter-spacing: .01em;
  }
  #uploadAll:hover { filter: brightness(1.06); transform: translateY(-1px); box-shadow: 0 14px 30px -8px rgba(56,189,248,0.6); }
  #uploadAll:active { transform: translateY(0); }
  #log { flex: 1; font-size: 11.5px; font-family: ui-monospace, monospace; max-height: 92px; overflow: auto; line-height: 1.7; }
  #log div.ok { color: var(--ok); }
  #log div.err { color: var(--err); }
  #log::-webkit-scrollbar { width: 8px; }
  #log::-webkit-scrollbar-thumb { background: var(--line); border-radius: 8px; }
</style>
</head>
<body>
<header>
  <div class="head-inner">
    <h1><span class="mark">📦</span> <span class="grad-text">Rebrand Asset Uploader</span></h1>
    <p>เลือกไฟล์แล้วกด "อัพโหลดทั้งหมด" — ระบบจะเซฟลง <code>src/assets</code> และ <code>public</code> ด้วยชื่อ/นามสกุลที่ถูกต้องอัตโนมัติ พร้อม<strong>บีบอัดรูปแบบ lossless</strong> (คมเท่าเดิม ไฟล์เล็กลง) ย่อรูปที่กว้างเกิน ${MAX_SOURCE_WIDTH}px ให้พอดี และย่อรูป <strong>Promotion/Carousel เหลือ ${SLIDE_BOX}×${SLIDE_BOX}</strong> (ขนาดที่หน้าเว็บใช้จริง) — จากนั้นกด <strong>"เริ่ม Rebrand"</strong> ใน<strong>ส่วนที่ 6</strong> เพื่อให้ Claude ลงมือรีแบรนด์ให้เลย (หยุดที่ verify ไม่ deploy ให้)</p>
  </div>
</header>
<main>
  <section class="card" id="card1">
    <h2>ไฟล์แบรนด์ · src/assets</h2>
    <p class="sub">โลโก้ / เนื้อหา (docx) / พื้นหลัง (รูป หรือ สี/ไล่สี) / แบนเนอร์ / รูป promotion + carousel</p>
    <div class="field" data-img>
      <div class="row"><label>Logo</label><span class="target">src/assets/logo.webp + public/logo.webp</span></div>
      <div class="row"><input type="file" accept="image/*" data-slot="logo" /><img class="thumb" /></div>
      <span class="status">อัพครั้งเดียว เซฟลงทั้ง src/assets และ public ให้อัตโนมัติ</span>
    </div>
    <div class="field">
      <div class="row"><label>Content brief</label><span class="target">content.docx</span></div>
      <div class="row"><input type="file" accept=".docx" data-slot="docx" /></div>
      <span class="status"></span>
    </div>
    <div class="field" id="bgField" data-img>
      <div class="row"><label>Background</label><span class="target">bg.png</span><span class="opt">เลือกอย่างใดอย่างหนึ่ง</span></div>
      <div class="row modes">
        <label><input type="radio" name="bgmode" value="image" checked /> รูปภาพ</label>
        <label><input type="radio" name="bgmode" value="color" /> สีเดียว</label>
        <label><input type="radio" name="bgmode" value="gradient" /> ไล่สี (gradient)</label>
      </div>
      <div class="row panel" data-mode="image">
        <input type="file" accept="image/*" data-slot="bg" id="bgFile" /><img class="thumb" />
      </div>
      <div class="row panel" data-mode="color" hidden>
        <input type="color" id="bgColor" value="#0f172a" />
        <input type="text" id="bgColorHex" value="#0f172a" spellcheck="false" />
        <span class="hint">ใช้เป็น CSS สีเดียว — ไม่โหลดรูป</span>
      </div>
      <div class="row panel" data-mode="gradient" hidden>
        <input type="color" id="bgFrom" value="#0f172a" />
        <input type="text" id="bgFromHex" value="#0f172a" spellcheck="false" />
        <input type="color" id="bgTo" value="#1e3a8a" />
        <input type="text" id="bgToHex" value="#1e3a8a" spellcheck="false" />
        <select id="bgType">
          <option value="linear">เส้นตรง</option>
          <option value="radial">รัศมี (radial)</option>
        </select>
        <select id="bgAngle">
          <option value="180" selected>บน → ล่าง</option>
          <option value="0">ล่าง → บน</option>
          <option value="90">ซ้าย → ขวา</option>
          <option value="270">ขวา → ซ้าย</option>
          <option value="135">ทแยง ↘</option>
          <option value="225">ทแยง ↙</option>
          <option value="45">ทแยง ↗</option>
          <option value="315">ทแยง ↖</option>
        </select>
      </div>
      <div class="row"><div id="bgPreview" hidden></div></div>
      <span class="status"></span>
    </div>
    <div class="field" data-img>
      <div class="row"><label>Banner 1</label><span class="target">banner1.png</span></div>
      <div class="row"><input type="file" accept="image/*" data-slot="banner" data-index="1" /><img class="thumb" /></div>
      <span class="status"></span>
    </div>
    <div class="field" data-img>
      <div class="row"><label>Banner 2</label><span class="opt">optional</span><span class="target">banner2.png</span></div>
      <div class="row"><input type="file" accept="image/*" data-slot="banner" data-index="2" /><img class="thumb" /></div>
      <span class="status"></span>
    </div>
    <div class="field" data-img>
      <div class="row"><label>Banner 3</label><span class="opt">optional</span><span class="target">banner3.png</span></div>
      <div class="row"><input type="file" accept="image/*" data-slot="banner" data-index="3" /><img class="thumb" /></div>
      <span class="status"></span>
    </div>
    <div class="field" data-img>
      <div class="row"><label>Banner 4</label><span class="opt">optional</span><span class="target">banner4.png</span></div>
      <div class="row"><input type="file" accept="image/*" data-slot="banner" data-index="4" /><img class="thumb" /></div>
      <span class="status"></span>
    </div>
    <div class="field" data-img>
      <div class="row"><label>Promotion + Carousel 1</label><span class="target">slide1.png</span></div>
      <div class="row"><input type="file" accept="image/*" data-slot="slide" data-index="1" /><img class="thumb" /></div>
      <span class="status"></span>
    </div>
    <div class="field" data-img>
      <div class="row"><label>Promotion + Carousel 2</label><span class="target">slide2.png</span></div>
      <div class="row"><input type="file" accept="image/*" data-slot="slide" data-index="2" /><img class="thumb" /></div>
      <span class="status"></span>
    </div>
    <div class="field" data-img>
      <div class="row"><label>Promotion + Carousel 3</label><span class="target">slide3.png</span></div>
      <div class="row"><input type="file" accept="image/*" data-slot="slide" data-index="3" /><img class="thumb" /></div>
      <span class="status"></span>
    </div>
    <div class="field" data-img>
      <div class="row"><label>Promotion + Carousel 4</label><span class="opt">optional</span><span class="target">slide4.png</span></div>
      <div class="row"><input type="file" accept="image/*" data-slot="slide" data-index="4" /><img class="thumb" /></div>
      <span class="status"></span>
    </div>
  </section>

  <section class="card" id="card2">
    <h2>ไอคอนเว็บ · public</h2>
    <p class="sub">favicon (สร้างชุดไอคอนให้อัตโนมัติ) — โลโก้ public ดึงจาก Logo ในส่วนที่ 1 ให้เอง</p>
    <div class="field" data-img>
      <div class="row"><label>Favicon</label><span class="target">favicon.ico + .png set + .svg</span></div>
      <div class="row"><input type="file" accept="image/*,.svg" data-slot="favicon" /><img class="thumb" /></div>
      <span class="status"></span>
    </div>
  </section>

  <section class="card" id="card3">
    <h2>ลิงก์ · aff / ไลน์</h2>
    <div class="field" id="affField">
      <div class="row"><label>ลิงก์ aff</label><span class="target">src/pages/login.astro + register.astro</span></div>
      <div class="row"><input type="url" class="linkinput" id="affInput" placeholder="https://..." spellcheck="false" /></div>
      <span class="status">แก้ค่า <code>targetUrl</code> ในทั้งหน้า login และ register พร้อมกัน</span>
    </div>
    <div class="field" id="lineField">
      <div class="row"><label>ลิงก์ไลน์</label><span class="target">astro.config.mjs → redirects "/line"</span></div>
      <div class="row"><input type="url" class="linkinput" id="lineInput" placeholder="https://..." spellcheck="false" /></div>
      <span class="status">แก้ปลายทางของ redirect <code>/line</code></span>
    </div>
  </section>

  <section class="card" id="card4">
    <h2>SEO · Title / Meta หน้าย่อย</h2>
    <div class="pull-row">
      <button type="button" id="pullDocx" class="ghost">📄 ดึงจาก content.docx</button>
      <span class="pull-hint">อัพ Content brief (docx) ในส่วนที่ 1 ก่อน แล้วค่อยกดปุ่มนี้</span>
    </div>
    <div class="field" data-page="promotion">
      <div class="row"><label>โปรโมชั่น</label><span class="target">src/pages/promotion.astro</span></div>
      <input type="text" class="metatitle" data-k="title" placeholder="Title" spellcheck="false" />
      <textarea class="metadesc" data-k="desc" rows="2" placeholder="Meta description" spellcheck="false"></textarea>
      <span class="status"></span>
    </div>
    <div class="field" data-page="contactus">
      <div class="row"><label>ติดต่อเรา</label><span class="target">src/pages/contact-us.astro</span></div>
      <input type="text" class="metatitle" data-k="title" placeholder="Title" spellcheck="false" />
      <textarea class="metadesc" data-k="desc" rows="2" placeholder="Meta description" spellcheck="false"></textarea>
      <span class="status"></span>
    </div>
    <div class="field" data-page="demo">
      <div class="row"><label>ทดลองเล่น</label><span class="target">src/pages/ทดลองเล่น.astro</span></div>
      <input type="text" class="metatitle" data-k="title" placeholder="Title" spellcheck="false" />
      <textarea class="metadesc" data-k="desc" rows="2" placeholder="Meta description" spellcheck="false"></textarea>
      <span class="status"></span>
    </div>
    <div class="field" data-page="entrance">
      <div class="row"><label>ทางเข้า</label><span class="target">src/pages/ทางเข้า.astro</span></div>
      <input type="text" class="metatitle" data-k="title" placeholder="Title" spellcheck="false" />
      <textarea class="metadesc" data-k="desc" rows="2" placeholder="Meta description" spellcheck="false"></textarea>
      <span class="status"></span>
    </div>
  </section>

  <section class="card" id="card5">
    <h2>สร้างหน้าเพิ่ม</h2>
    <div class="field newpage" data-newpage="article">
      <div class="row">
        <label class="switch"><input type="checkbox" class="np-toggle" /><span class="slider"></span></label>
        <label>บทความ</label>
        <span class="target">src/pages/บทความ.astro</span>
        <span class="badge np-badge"></span>
      </div>
      <div class="np-body" hidden>
        <input type="text" class="metatitle" data-k="title" placeholder="Title (เว้นว่างได้ — Claude เขียนให้)" spellcheck="false" />
        <textarea class="metadesc" data-k="desc" rows="2" placeholder="Meta description (เว้นว่างได้ — Claude เขียนให้)" spellcheck="false"></textarea>
      </div>
      <span class="status"></span>
    </div>
    <div class="field newpage" data-newpage="aboutus">
      <div class="row">
        <label class="switch"><input type="checkbox" class="np-toggle" /><span class="slider"></span></label>
        <label>เกี่ยวกับเรา</label>
        <span class="target">src/pages/about-us.astro</span>
        <span class="badge np-badge"></span>
      </div>
      <div class="np-body" hidden>
        <input type="text" class="metatitle" data-k="title" placeholder="Title (เว้นว่างได้ — Claude เขียนให้)" spellcheck="false" />
        <textarea class="metadesc" data-k="desc" rows="2" placeholder="Meta description (เว้นว่างได้ — Claude เขียนให้)" spellcheck="false"></textarea>
      </div>
      <span class="status"></span>
    </div>
  </section>

  <section class="card" id="card6">
    <h2>สร้างคำสั่ง Rebrand (สำหรับ Claude Code)</h2>
    <div class="field">
      <div class="row"><label>ชื่อแบรนด์</label></div>
      <input type="text" class="linkinput" id="rbBrand" placeholder="เช่น PABLO666" spellcheck="false" />
    </div>
    <div class="field">
      <div class="row"><label>URL production จริง</label><span class="opt">optional</span></div>
      <input type="url" class="linkinput" id="rbUrl" placeholder="เช่น https://www.pablo666-brand.com" spellcheck="false" />
      <span class="status">ใส่เมื่อรู้โดเมนจริง — เว้นว่างได้ คำสั่งจะสั่งห้ามเปลี่ยนโดเมนเดิม</span>
    </div>
    <div class="field">
      <div class="row"><label>หมายเหตุ / variant hints</label><span class="opt">optional</span></div>
      <textarea class="metadesc" id="rbNotes" rows="2" placeholder="เช่น โทนทอง-ดำ, ใช้ NavbarPremium, เน้นหน้าโปรโมชั่น" spellcheck="false"></textarea>
    </div>
    <div class="field">
      <div class="row"><label>คำสั่งที่จะรัน</label><button type="button" id="rbCopy" class="ghost">📋 Copy คำสั่ง</button></div>
      <textarea class="metadesc" id="rbPrompt" rows="3" readonly spellcheck="false"></textarea>
      <span class="status" id="rbHint">Copy ไว้วางเองใน Claude Code ก็ได้ หรือกด "เริ่ม Rebrand" ให้ระบบยิงให้เลย</span>
    </div>
    <div class="field">
      <div class="row">
        <button type="button" id="rbFire" class="fire">▶ เริ่ม Rebrand</button>
        <button type="button" id="rbStop" class="ghost danger" disabled>■ หยุด</button>
        <button type="button" id="rbDry" class="ghost" title="ยิง prompt สั้นๆ เพื่อเช็กว่าต่อ Claude ได้จริง ใช้เวลาไม่กี่วินาที ไม่แตะไฟล์">🧪 ทดสอบท่อ</button>
        <span class="pill" id="rbPill">พร้อม</span>
        <span class="rb-timer" id="rbTimer"></span>
      </div>
      <span class="status" id="rbFireHint">ต้องกด "อัพโหลดทั้งหมด" ให้เสร็จก่อน — ปุ่มนี้ไม่อัพโหลดไฟล์ให้ · งานจริงกินเวลาหลายสิบนาที · <strong>ห้ามปิดหน้าต่างดำ (cmd)</strong> ระหว่างรัน (ปิดแท็บเบราว์เซอร์ได้ ไม่กระทบ)</span>
    </div>
    <div class="field" id="rbRunBox" hidden>
      <div class="row">
        <span class="rb-stat">tools <b id="rbTools">0</b></span>
        <span class="rb-stat">ไฟล์ที่แก้ <b id="rbFiles">0</b></span>
        <span class="rb-stat" id="rbMeta"></span>
      </div>
      <pre id="rbLog"></pre>
      <details id="rbFileBox" hidden>
        <summary>ไฟล์ที่ถูกแก้</summary>
        <div id="rbFileList"></div>
      </details>
      <span class="status" id="rbDone"></span>
    </div>
  </section>
</main>
<div class="bar">
  <button id="uploadAll">อัพโหลดทั้งหมด</button>
  <div id="log"></div>
</div>
<script>
  // live thumbnails
  document.querySelectorAll('.field[data-img] input[type=file]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const thumb = inp.parentElement.querySelector('.thumb');
      if (!thumb) return;
      if (inp.files[0]) { thumb.src = URL.createObjectURL(inp.files[0]); thumb.classList.add('show'); }
      else thumb.classList.remove('show');
    });
  });

  const log = document.getElementById('log');
  function addLog(msg, ok) { const d = document.createElement('div'); d.className = ok ? 'ok' : 'err'; d.textContent = (ok ? '✓ ' : '✗ ') + msg; log.prepend(d); }
  // Never let a missing/renamed .status span abort an upload run: this is a
  // cosmetic sink, so a markup slip must not throw out of the click handler
  // and skip the actual fetch (that shipped once — the favicon field had no
  // .status, so picking a favicon silently uploaded nothing).
  function setStatus(inp, txt) {
    const s = inp?.closest('.field')?.querySelector('.status');
    if (s) s.textContent = txt;
    else console.warn('[uploader] missing .status for slot:', inp?.dataset?.slot ?? inp);
  }

  // ── Background: image / solid colour / gradient — pick exactly one ─────────
  const bgField = document.getElementById('bgField');
  const bgFile = document.getElementById('bgFile');
  const bgPreview = document.getElementById('bgPreview');
  const $ = (id) => document.getElementById(id);
  const bgMode = () => bgField.querySelector('input[name=bgmode]:checked').value;

  // keep each <input type=color> and its hex textbox in sync, both directions
  [['bgColor','bgColorHex'], ['bgFrom','bgFromHex'], ['bgTo','bgToHex']].forEach(([pick, text]) => {
    $(pick).addEventListener('input', () => { $(text).value = $(pick).value; drawPreview(); });
    $(text).addEventListener('input', () => {
      const v = $(text).value.trim();
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { $(pick).value = v.length === 4 ? '#' + [...v.slice(1)].map(c => c + c).join('') : v; }
      drawPreview();
    });
  });
  ['bgType','bgAngle'].forEach((id) => $(id).addEventListener('change', drawPreview));

  // The CSS here mirrors the server's SVG geometry, so this swatch is a true
  // preview of the bg.png that will be written.
  function drawPreview() {
    const mode = bgMode();
    if (mode === 'color') {
      bgPreview.hidden = false;
      bgPreview.style.background = $('bgColorHex').value.trim();
    } else if (mode === 'gradient') {
      bgPreview.hidden = false;
      const from = $('bgFromHex').value.trim(), to = $('bgToHex').value.trim();
      bgPreview.style.background = $('bgType').value === 'radial'
        ? 'radial-gradient(circle at 50% 50%, ' + from + ', ' + to + ')'
        : 'linear-gradient(' + $('bgAngle').value + 'deg, ' + from + ', ' + to + ')';
    } else {
      bgPreview.hidden = true;
    }
    $('bgAngle').hidden = $('bgType').value === 'radial';
  }

  bgField.querySelectorAll('input[name=bgmode]').forEach((r) => {
    r.addEventListener('change', () => {
      bgField.querySelectorAll('.panel').forEach((p) => { p.hidden = p.dataset.mode !== bgMode(); });
      drawPreview();
    });
  });
  drawPreview();

  // Builds the /upload call for whichever bg mode is active. Returns null when
  // the image mode is selected but no file was chosen (bg stays untouched).
  function bgRequest() {
    const mode = bgMode();
    if (mode === 'image') {
      if (!bgFile.files.length) return null;
      return { q: new URLSearchParams({ slot: 'bg' }), body: bgFile.files[0], label: 'bg (รูปภาพ)' };
    }
    if (mode === 'color') {
      return { q: new URLSearchParams({ slot: 'bg', color: $('bgColorHex').value.trim() }), body: null, label: 'bg (สีเดียว)' };
    }
    const q = new URLSearchParams({
      slot: 'bg',
      from: $('bgFromHex').value.trim(),
      to: $('bgToHex').value.trim(),
      type: $('bgType').value,
      angle: $('bgAngle').value,
    });
    return { q, body: null, label: 'bg (ไล่สี)' };
  }

  // ── Text links: pre-fill with the values currently in the source ──────────
  const affInput = document.getElementById('affInput');
  const lineInput = document.getElementById('lineInput');
  function setLinkStatus(field, txt) { document.getElementById(field).querySelector('.status').textContent = txt; }
  fetch('/current').then((r) => r.json()).then((j) => {
    if (j.aff) affInput.placeholder = j.aff;
    if (j.line) lineInput.placeholder = j.line;
  }).catch(() => {});

  // POST one text link if its box was filled in; blank = leave the code as-is.
  async function sendLink(slot, input, fieldId, label) {
    const value = input.value.trim();
    if (!value) return false;
    const q = new URLSearchParams({ slot, value });
    setLinkStatus(fieldId, '⏳ กำลังบันทึก...');
    try {
      const res = await fetch('/upload?' + q.toString(), { method: 'POST' });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || ('HTTP ' + res.status));
      setLinkStatus(fieldId, '✅ ' + j.written.join(', '));
      addLog(label + ' → ' + j.written.join(', '), true);
      input.placeholder = value;
      input.value = '';
    } catch (e) {
      setLinkStatus(fieldId, '❌ ' + e.message);
      addLog(label + ': ' + e.message, false);
    }
    return true;
  }

  // ── Sub-page Title/Meta: pre-fill from source, pull from docx, save ────────
  const metaFields = [...document.querySelectorAll('.field[data-page]')];
  const metaEls = (f) => ({
    title: f.querySelector('[data-k=title]'),
    desc: f.querySelector('[data-k=desc]'),
    status: f.querySelector('.status'),
  });
  // remember what's currently saved so "อัพโหลดทั้งหมด" only writes changed pages
  function markSaved(f, title, desc) { f.dataset.origTitle = title; f.dataset.origDesc = desc; }

  fetch('/current-pages').then((r) => r.json()).then((cur) => {
    for (const f of metaFields) {
      const c = cur[f.dataset.page];
      if (!c) continue;
      const { title, desc } = metaEls(f);
      title.value = c.title || '';
      desc.value = c.meta || '';
      markSaved(f, title.value, desc.value);
    }
  }).catch(() => {});

  document.getElementById('pullDocx').addEventListener('click', async () => {
    try {
      // Prefer the file the operator just browsed (not yet uploaded) so the
      // preview reads the original source; fall back to the staged content.docx.
      const docxInput = document.querySelector('input[data-slot="docx"]');
      const picked = docxInput && docxInput.files && docxInput.files[0];
      const res = picked
        ? await fetch('/parse-docx', { method: 'POST', body: picked })
        : await fetch('/parse-docx');
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || ('HTTP ' + res.status));
      let filled = 0;
      for (const f of metaFields) {
        const p = j.pages[f.dataset.page];
        const { title, desc, status } = metaEls(f);
        if (p) {
          if (p.title) title.value = p.title;
          if (p.meta) desc.value = p.meta;
          status.textContent = '📄 ดึงจาก docx แล้ว — ตรวจ/แก้ก่อนกดอัพโหลด';
          filled++;
        } else {
          status.textContent = 'ไม่พบใน docx — คงค่าเดิม';
        }
      }
      (j.warnings || []).forEach((w) => addLog('docx: ' + w, false));
      const src = picked ? ('ไฟล์ที่เลือก (' + picked.name + ')') : 'content.docx ในโปรเจค';
      addLog('ดึงจาก ' + src + ': เติมได้ ' + filled + ' หน้า', filled > 0);
    } catch (e) {
      addLog('ดึงจาก docx: ' + e.message, false);
    }
  });

  // POST one page's Title/Meta if it changed since last save. Blank = skip.
  async function sendPageMeta(f) {
    const { title, desc, status } = metaEls(f);
    const t = title.value.trim(), d = desc.value.trim();
    if (t === (f.dataset.origTitle || '') && d === (f.dataset.origDesc || '')) return false;
    if (!t || !d) { status.textContent = '⚠️ ต้องกรอกทั้ง Title และ Meta'; return false; }
    const q = new URLSearchParams({ slot: 'pagemeta', page: f.dataset.page, title: t, desc: d });
    status.textContent = '⏳ กำลังบันทึก...';
    try {
      const res = await fetch('/upload?' + q.toString(), { method: 'POST' });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || ('HTTP ' + res.status));
      status.textContent = '✅ ' + j.written.join(', ');
      addLog(f.dataset.page + ' → ' + j.written.join(', '), true);
      markSaved(f, t, d);
    } catch (e) {
      status.textContent = '❌ ' + e.message;
      addLog(f.dataset.page + ': ' + e.message, false);
    }
    return true;
  }

  // ── Optional preset pages (ส่วนที่ 5): toggle → scaffold file + nav link ────
  const newpageFields = [...document.querySelectorAll('.field[data-newpage]')];
  const npEls = (f) => ({
    toggle: f.querySelector('.np-toggle'),
    body: f.querySelector('.np-body'),
    title: f.querySelector('[data-k=title]'),
    desc: f.querySelector('[data-k=desc]'),
    status: f.querySelector('.status'),
    badge: f.querySelector('.np-badge'),
  });
  for (const f of newpageFields) {
    const { toggle, body } = npEls(f);
    toggle.addEventListener('change', () => { body.hidden = !toggle.checked; });
  }
  fetch('/current-newpages').then((r) => r.json()).then((cur) => {
    for (const f of newpageFields) {
      const c = cur[f.dataset.newpage];
      if (!c) continue;
      const { toggle, body, title, desc, badge } = npEls(f);
      if (c.exists) {
        toggle.checked = true; body.hidden = false;
        title.value = c.title || ''; desc.value = c.meta || '';
        badge.textContent = 'มีอยู่แล้ว'; badge.className = 'badge np-badge exists';
      } else {
        badge.textContent = 'จะสร้างใหม่'; badge.className = 'badge np-badge new';
      }
    }
  }).catch(() => {});

  // POST one preset page if its toggle is on. Off = do nothing (never deletes).
  // Title/Meta are optional — blank is fine, the page is scaffolded with default
  // meta + a placeholder article for Claude to write at rebrand time.
  async function sendNewPage(f) {
    const { toggle, title, desc, status } = npEls(f);
    if (!toggle.checked) return false;
    const t = title.value.trim(), d = desc.value.trim();
    const q = new URLSearchParams({ slot: 'newpage', page: f.dataset.newpage, title: t, desc: d });
    status.textContent = (!t && !d) ? '⏳ กำลังสร้าง (Claude เขียนเนื้อหาให้ตอนรีแบรนด์)...' : '⏳ กำลังสร้าง...';
    try {
      const res = await fetch('/upload?' + q.toString(), { method: 'POST' });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || ('HTTP ' + res.status));
      status.textContent = '✅ ' + j.written.join(', ');
      addLog(f.dataset.newpage + ' → ' + j.written.join(', '), true);
      if (j.navAlready) addLog(f.dataset.newpage + ': ลิงก์เมนูมีอยู่แล้ว (ข้าม)', true);
      if (j.navWarning) addLog('navbar: ' + j.navWarning, false);
    } catch (e) {
      status.textContent = '❌ ' + e.message;
      addLog(f.dataset.newpage + ': ' + e.message, false);
    }
    return true;
  }

  // ── Rebrand run (ส่วนที่ 6) ────────────────────────────────────────────────
  // The prompt is NOT assembled here: /rebrand/preview returns the exact string
  // /rebrand/start will fire, so the textarea can never show something different
  // from what runs. Copy still works for pasting into Claude Code by hand.
  const rbBrand = document.getElementById('rbBrand');
  const rbUrl = document.getElementById('rbUrl');
  const rbNotes = document.getElementById('rbNotes');
  const rbPrompt = document.getElementById('rbPrompt');
  const rbCopy = document.getElementById('rbCopy');
  const rbFire = document.getElementById('rbFire');
  const rbStop = document.getElementById('rbStop');
  const rbPill = document.getElementById('rbPill');
  const rbTimer = document.getElementById('rbTimer');
  const rbHint = document.getElementById('rbHint');
  const rbRunBox = document.getElementById('rbRunBox');
  const rbLog = document.getElementById('rbLog');
  const rbTools = document.getElementById('rbTools');
  const rbFilesN = document.getElementById('rbFiles');
  const rbMeta = document.getElementById('rbMeta');
  const rbFileBox = document.getElementById('rbFileBox');
  const rbFileList = document.getElementById('rbFileList');
  const rbDone = document.getElementById('rbDone');
  const uploadAllBtn = document.getElementById('uploadAll');

  let promptOk = false;
  let promptTimer = null;
  let rbSource = null;        // EventSource
  let rbLastIdx = -1;         // last event seq rendered, for gap-free reconnect
  let rbClosed = false;       // run ended: stop reconnecting
  let rbTicker = null;
  let rbStartedAt = 0;
  let rbFileSet = new Set();
  let rbToolCount = 0;

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function refreshPrompt() {
    clearTimeout(promptTimer);
    promptTimer = setTimeout(async () => {
      const q = new URLSearchParams({ brand: rbBrand.value, url: rbUrl.value, notes: rbNotes.value });
      try {
        const res = await fetch('/rebrand/preview?' + q.toString());
        const j = await res.json();
        if (j.ok) {
          rbPrompt.value = j.prompt;
          promptOk = true;
          rbHint.textContent = 'Copy ไว้วางเองใน Claude Code ก็ได้ หรือกด "เริ่ม Rebrand" ให้ระบบยิงให้เลย';
        } else {
          rbPrompt.value = '⚠ ' + j.error;
          promptOk = false;
          rbHint.textContent = j.error;
        }
      } catch (e) {
        rbPrompt.value = '⚠ ต่อ server ไม่ได้: ' + e.message;
        promptOk = false;
      }
      syncButtons();
    }, 250);
  }
  [rbBrand, rbUrl, rbNotes].forEach((el) => el.addEventListener('input', refreshPrompt));

  function running() { return rbPill.dataset.status === 'running' || rbPill.dataset.status === 'stopping'; }

  function syncButtons() {
    const busy = running();
    rbFire.disabled = busy || !promptOk;
    rbStop.disabled = !busy;
    document.getElementById('rbDry').disabled = busy;
    // While an agent is reading src/assets, re-staging files underneath it would
    // hand it a half-swapped brand — so uploads are locked for the duration.
    uploadAllBtn.disabled = busy;
    uploadAllBtn.style.opacity = busy ? '.45' : '';
    uploadAllBtn.style.cursor = busy ? 'not-allowed' : '';
  }

  const PILL = {
    idle:     ['พร้อม', ''],
    running:  ['กำลังทำงาน', 'run'],
    stopping: ['กำลังหยุด...', 'run'],
    done:     ['เสร็จแล้ว', 'done'],
    stopped:  ['หยุดแล้ว', 'bad'],
    error:    ['ล้มเหลว', 'bad'],
  };
  function setPill(status) {
    const [label, cls] = PILL[status] || PILL.idle;
    rbPill.dataset.status = status;
    rbPill.textContent = label;
    rbPill.className = 'pill' + (cls ? ' ' + cls : '');
    syncButtons();
  }

  function fmtElapsed(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function startTicker() {
    clearInterval(rbTicker);
    rbTicker = setInterval(() => { rbTimer.textContent = fmtElapsed(Date.now() - rbStartedAt); }, 1000);
  }

  function rbLine(cls, html) {
    // keep following the tail only if the operator hasn't scrolled up to read
    const atBottom = rbLog.scrollHeight - rbLog.scrollTop - rbLog.clientHeight < 40;
    const d = document.createElement('span');
    d.className = 'l ' + cls;
    d.innerHTML = html;
    rbLog.appendChild(d);
    if (atBottom) rbLog.scrollTop = rbLog.scrollHeight;
  }

  function rbReset() {
    rbLog.textContent = '';
    rbFileSet = new Set();
    rbToolCount = 0;
    rbLastIdx = -1;
    rbClosed = false;
    rbTools.textContent = '0';
    rbFilesN.textContent = '0';
    rbMeta.textContent = '';
    rbDone.textContent = '';
    rbFileBox.hidden = true;
    rbFileList.textContent = '';
    rbRunBox.hidden = false;
  }

  function renderEvent(ev) {
    if (ev.i <= rbLastIdx) return; // replay overlap after a reconnect
    rbLastIdx = ev.i;
    const sub = ev.sub ? ' sub' : '';
    const who = ev.sub ? '<span class="who">agent</span> ' : '';
    switch (ev.type) {
      case 'start':
        rbStartedAt = ev.startedAt || ev.t;
        startTicker();
        rbLine('meta', '▶ ' + esc(ev.text));
        break;
      case 'init':
        rbLine('meta', esc(ev.text));
        break;
      case 'text':
        rbLine('' + sub, who + esc(ev.text));
        break;
      case 'tool':
        rbToolCount++;
        rbTools.textContent = rbToolCount;
        if (ev.file) {
          rbFileSet.add(ev.file);
          rbFilesN.textContent = rbFileSet.size;
          rbFileBox.hidden = false;
          rbFileList.textContent = [...rbFileSet].join('\\n');
        }
        rbLine('tool' + sub, who + '● ' + esc(ev.name) + (ev.text ? ' — ' + esc(ev.text) : ''));
        break;
      case 'tool_error':
        rbLine('bad', '⚠ tool error: ' + esc(ev.text));
        break;
      case 'stderr':
      case 'raw':
        rbLine('bad', esc(ev.text));
        break;
      case 'stopping':
        setPill('stopping');
        rbLine('bad', '■ ' + esc(ev.text));
        break;
      case 'result': {
        const bits = [];
        if (ev.numTurns) bits.push(ev.numTurns + ' turns');
        if (ev.durationMs) bits.push(fmtElapsed(ev.durationMs));
        if (typeof ev.costUsd === 'number') bits.push('$' + ev.costUsd.toFixed(2));
        rbMeta.textContent = bits.join(' · ');
        if (ev.text) rbLine('good', esc(ev.text));
        break;
      }
      case 'end': {
        clearInterval(rbTicker);
        rbClosed = true;
        rbTimer.textContent = fmtElapsed(ev.elapsedMs || 0);
        setPill(ev.status);
        const okRun = ev.status === 'done';
        rbLine(okRun ? 'good' : 'bad', (okRun ? '✓ จบงาน' : '✗ จบแบบ ' + ev.status) + ' (exit ' + ev.exitCode + ')');
        rbDone.innerHTML = okRun
          ? 'ต่อไป: รัน <code>npm run preview</code> ตรวจด้วยตา แล้วค่อย deploy แยกด้วย deploy.ps1'
          : 'งานไม่จบสมบูรณ์ — repo อาจถูกแก้ค้างไว้ ตรวจด้วย <code>git status</code> / ย้อนด้วย <code>git checkout .</code> ก่อนยิงใหม่';
        addLog('rebrand: ' + ev.status, okRun);
        break;
      }
    }
  }

  function attach(from) {
    if (rbSource) { rbSource.close(); rbSource = null; }
    rbSource = new EventSource('/rebrand/stream?from=' + from);
    rbSource.onmessage = (e) => { try { renderEvent(JSON.parse(e.data)); } catch { /* ignore */ } };
    rbSource.onerror = () => {
      // EventSource retries on its own, but it would replay from the same
      // ?from= — so reconnect explicitly at the next unseen event instead.
      rbSource.close();
      rbSource = null;
      if (rbClosed) return;
      setTimeout(() => { if (!rbClosed) attach(rbLastIdx + 1); }, 2000);
    };
  }

  rbCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(rbPrompt.value);
      addLog('คัดลอกคำสั่ง rebrand แล้ว — วางใน Claude Code ได้เลย', true);
    } catch {
      rbPrompt.select();
      addLog('คัดลอกอัตโนมัติไม่ได้ (เลือกข้อความให้แล้ว กด Ctrl+C)', false);
    }
  });

  async function fireRun(dry) {
    if (!dry) {
      let docxNote = 'ไม่พบ content.docx ใน src/assets — ยังไม่ได้อัพ brief!';
      try {
        const st = await (await fetch('/rebrand/status')).json();
        if (st.docx?.exists) docxNote = 'content.docx ที่ staged ไว้: ' + new Date(st.docx.mtime).toLocaleString('th-TH');
      } catch { /* keep the warning */ }
      const ok = confirm(
        'เริ่ม rebrand จริงหรือไม่?\\n\\n' +
        '• จะแก้ไฟล์จริงใน src/ ของโปรเจกต์นี้\\n' +
        '• กินเวลาหลายสิบนาที ห้ามปิดหน้าต่าง cmd ระหว่างรัน\\n' +
        '• ต้องกด "อัพโหลดทั้งหมด" ให้เสร็จก่อนแล้ว (ปุ่มนี้ไม่อัพให้)\\n' +
        '• ' + docxNote + '\\n\\n' +
        'คำสั่ง: ' + rbPrompt.value
      );
      if (!ok) return;
    }
    rbReset();
    setPill('running');
    rbStartedAt = Date.now();
    startTicker();
    try {
      const res = await fetch('/rebrand/start' + (dry ? '?dry=1' : ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: rbBrand.value, url: rbUrl.value, notes: rbNotes.value }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || ('HTTP ' + res.status));
      addLog(dry ? 'เริ่มทดสอบท่อ' : 'เริ่ม rebrand แล้ว', true);
      attach(0);
    } catch (e) {
      clearInterval(rbTicker);
      setPill('error');
      rbClosed = true;
      rbLine('bad', 'เริ่มไม่สำเร็จ: ' + esc(e.message));
      addLog('เริ่ม rebrand ไม่สำเร็จ: ' + e.message, false);
    }
  }

  rbFire.addEventListener('click', () => fireRun(false));
  rbStop.addEventListener('click', async () => {
    if (!confirm('หยุดงาน rebrand ตอนนี้?\\n\\nไฟล์ที่แก้ไปแล้วจะค้างครึ่งทาง ต้องไปตรวจ git status เอง')) return;
    rbStop.disabled = true;
    try {
      const j = await (await fetch('/rebrand/stop', { method: 'POST' })).json();
      if (!j.ok) throw new Error(j.error);
    } catch (e) {
      addLog('หยุดไม่สำเร็จ: ' + e.message, false);
      syncButtons();
    }
  });

  // Pipe smoke-test: same spawn → NDJSON → SSE path, seconds instead of an hour.
  document.getElementById('rbDry').addEventListener('click', () => fireRun(true));

  // Reattach to a run already in flight (page refresh / reopened tab).
  (async () => {
    try {
      const st = await (await fetch('/rebrand/status')).json();
      const run = st.run;
      if (run && (run.status === 'running' || run.status === 'stopping')) {
        rbReset();
        setPill(run.status);
        rbStartedAt = run.startedAt || Date.now();
        startTicker();
        attach(0);
        addLog('มีงาน rebrand ค้างอยู่ — ต่อ log กลับมาแล้ว', true);
      }
    } catch { /* server just started; nothing to reattach */ }
  })();

  refreshPrompt();
  syncButtons();

  document.getElementById('uploadAll').addEventListener('click', async () => {
    if (running()) { addLog('มี rebrand กำลังรันอยู่ — อัพโหลดตอนนี้ไม่ได้', false); return; }
    const inputs = [...document.querySelectorAll('input[type=file]')].filter((i) => i !== bgFile);
    let any = false;

    if (await sendLink('aff', affInput, 'affField', 'ลิงก์ aff')) any = true;
    if (await sendLink('line', lineInput, 'lineField', 'ลิงก์ไลน์')) any = true;
    for (const f of metaFields) { if (await sendPageMeta(f)) any = true; }
    for (const f of newpageFields) { if (await sendNewPage(f)) any = true; }

    const bgReq = bgRequest();
    if (bgReq) {
      any = true;
      setStatus(bgFile, '⏳ กำลังอัพโหลด...');
      try {
        const res = await fetch('/upload?' + bgReq.q.toString(), { method: 'POST', body: bgReq.body });
        const j = await res.json();
        if (!res.ok || !j.ok) throw new Error(j.error || ('HTTP ' + res.status));
        setStatus(bgFile, '✅ ' + j.written.join(', '));
        addLog(bgReq.label + ' → ' + j.written.join(', '), true);
      } catch (e) {
        setStatus(bgFile, '❌ ' + e.message);
        addLog(bgReq.label + ': ' + e.message, false);
      }
    }

    for (const inp of inputs) {
      if (!inp.files.length) continue;
      any = true;
      const file = inp.files[0];
      const slot = inp.dataset.slot;
      const index = inp.dataset.index || '';
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const q = new URLSearchParams({ slot, index, ext });
      setStatus(inp, '⏳ กำลังอัพโหลด...');
      try {
        const res = await fetch('/upload?' + q.toString(), { method: 'POST', body: file });
        const j = await res.json();
        if (!res.ok || !j.ok) throw new Error(j.error || ('HTTP ' + res.status));
        setStatus(inp, '✅ ' + j.written.join(', '));
        addLog(slot + (index ? index : '') + ' → ' + j.written.join(', '), true);
      } catch (e) {
        setStatus(inp, '❌ ' + e.message);
        addLog(slot + (index ? index : '') + ': ' + e.message, false);
      }
    }
    if (!any) addLog('ยังไม่ได้เลือกไฟล์ใดๆ', false);
  });
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return;
  }
  if (req.method === "GET" && url.pathname === "/current") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(await readCurrentLinks()));
    return;
  }
  if (req.method === "GET" && url.pathname === "/current-pages") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(await readCurrentPageMeta()));
    return;
  }
  if (req.method === "GET" && url.pathname === "/current-newpages") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(await readCurrentNewPages()));
    return;
  }
  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/parse-docx") {
    try {
      // POST body = the docx the operator just browsed (preview before upload);
      // GET = fall back to the staged src/assets/content.docx.
      let result;
      if (req.method === "POST") {
        const buf = await readBody(req);
        if (!buf.length) throw new Error("ไม่พบไฟล์ docx ที่ส่งมา");
        result = parseDocxBuffer(buf);
      } else {
        result = await readDocxSubPages();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/upload") {
    try {
      const slot = url.searchParams.get("slot") || "";
      const index = url.searchParams.get("index") || "";
      const ext = (url.searchParams.get("ext") || "").toLowerCase();
      const buf = await readBody(req);
      let written;
      let extra = {};
      if (slot === "bg") {
        // the one slot that may arrive with no body (colour / gradient mode)
        written = await handleBackground(url.searchParams, buf);
      } else if (slot === "aff") {
        // text-only slots: the new link comes in ?value=, never as a body
        written = await handleAffLink(url.searchParams.get("value"));
      } else if (slot === "line") {
        written = await handleLineLink(url.searchParams.get("value"));
      } else if (slot === "pagemeta") {
        // sub-page SEO: page key + title + desc arrive in the query, no body
        written = await writePageMeta(
          url.searchParams.get("page") || "",
          url.searchParams.get("title"),
          url.searchParams.get("desc"),
        );
      } else if (slot === "newpage") {
        // optional preset page: scaffold the file + wire its nav link, no body
        const key = url.searchParams.get("page") || "";
        const cfg = PRESET_PAGES[key];
        if (!cfg) throw new Error(`ไม่รู้จักหน้า preset: ${key}`);
        const pageRes = await createPage(key, url.searchParams.get("title"), url.searchParams.get("desc"));
        const navRes = await addNavLink(cfg.route, cfg.navLabel);
        written = [...pageRes.written];
        if (navRes.inserted) written.push(`navbar ${navRes.navFile} (+${navRes.inserted})`);
        extra = { created: pageRes.created, navWarning: navRes.warning || null, navAlready: !!navRes.already };
      } else {
        if (!buf.length) throw new Error("empty upload");
        written = await handleUpload(slot, index, ext, buf);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, written, ...extra }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }
  // ── ส่วนที่ 6: build / fire / watch / stop the rebrand run ────────────────
  if (req.method === "GET" && url.pathname === "/rebrand/preview") {
    // The UI never assembles the prompt itself — it renders whatever this
    // returns, so what's shown and what's fired can't drift apart.
    try {
      const prompt = buildRebrandPrompt({
        brand: url.searchParams.get("brand"),
        url: url.searchParams.get("url"),
        notes: url.searchParams.get("notes"),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, prompt }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/rebrand/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, run: runSnapshot(), docx: await stagedDocxInfo() }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/rebrand/start") {
    try {
      const body = await readJson(req);
      const run = startRun({
        brand: body.brand,
        url: body.url,
        notes: body.notes,
        dry: url.searchParams.get("dry") === "1",
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, run }));
    } catch (err) {
      res.writeHead(isActive() ? 409 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/rebrand/stop") {
    try {
      stopRun("manual");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, run: runSnapshot() }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/rebrand/stream") {
    const from = Number(url.searchParams.get("from")) || 0;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.write("retry: 3000\n\n");
    // Replay first, then subscribe. Node is single-threaded and nothing awaits
    // between the two, so no event can slip through the gap.
    for (const ev of runState.events) {
      if (ev.i >= from) res.write("data: " + JSON.stringify(ev) + "\n\n");
    }
    if (isActive()) {
      runState.clients.add(res);
      const heartbeat = setInterval(() => {
        try { res.write(":ping\n\n"); } catch { /* closing */ }
      }, 15000);
      req.on("close", () => {
        clearInterval(heartbeat);
        runState.clients.delete(res);
      });
    } else {
      res.end();
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

// ensure target dirs exist (they normally do in this repo)
await mkdir(ASSETS, { recursive: true });
await mkdir(PUBLIC, { recursive: true });

server.listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`\n  Rebrand asset uploader running:\n  → http://${shown}:${PORT}   (bind ${HOST})\n`);
  console.log(`  Writes into:\n  - ${ASSETS}\n  - ${PUBLIC}\n`);
  console.log(`  Rebrand runner: ${CLAUDE_BIN} (override with CLAUDE_BIN=<path to claude.exe>)`);
  console.log("  Ctrl+C to stop — that also kills a rebrand run in progress.\n");
});
