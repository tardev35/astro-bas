/**
 * The rolling "latest transactions" feed.
 *
 * ── WHY THIS IS NOT INLINE IN THE COMPONENT ─────────────────────────────────
 * LatestWinnersCyber used `<script define:vars={{ bankPool }}>`. define:vars
 * forces `is:inline`, which strips type/async/defer — so the result was a
 * parser-blocking <script> sitting about 80% of the way down the document, and
 * it ran five innerHTML builds plus five prepends synchronously before the
 * parser could continue.
 *
 * It also rendered the feed container EMPTY in the HTML and filled it from JS,
 * which means the rows are invisible to a crawler, invisible with JS disabled,
 * and guaranteed to shift the layout when they appear. And the setInterval had
 * no stop condition: it ran every four seconds forever, in background tabs
 * included.
 *
 * The rows are server-rendered now and this module only takes over the
 * updating, gated on the feed actually being on screen and the tab being
 * visible. With no JS the page keeps the rows it shipped with.
 *
 * ── HOW THE COMPONENT PASSES DATA ───────────────────────────────────────────
 * A `<script type="application/json">` tag, not define:vars. It is inert data
 * the parser skips, so it costs nothing and does not force an inline script.
 */

export interface BankEntry {
  name: string;
  /** Utility class for the badge behind the logo. */
  color: string;
  /** Resolved image path. */
  icon: string;
}

export interface WinnersFeedOptions {
  feedSelector?: string;
  /** Element holding the JSON bank list. */
  dataSelector?: string;
  /** Element whose markup is cloned for each new row. */
  rowSelector?: string;
  intervalMs?: number;
  maxRows?: number;
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

const randomFrom = (chars: string, length: number) =>
  Array.from({ length })
    .map(() => chars.charAt(Math.floor(Math.random() * chars.length)))
    .join("");

/** The same shapes the server rendered, so a JS row is indistinguishable. */
export function randomUser(): string {
  return `${randomFrom(LETTERS, 2)}***${randomFrom(DIGITS, 4)}`;
}

export function randomAmount(): string {
  return (Math.floor(Math.random() * (95000 - 15000 + 1)) + 15000).toLocaleString("en-US");
}

export function startWinnersFeed(options: WinnersFeedOptions = {}): () => void {
  const { feedSelector = "[data-winners-feed]", dataSelector = "[data-winners-banks]", rowSelector = "[data-winner-row]", intervalMs = 4000, maxRows = 5 } = options;

  const feed = document.querySelector<HTMLElement>(feedSelector);
  const dataEl = document.querySelector<HTMLScriptElement>(dataSelector);
  if (!feed || !dataEl) return () => {};

  let banks: BankEntry[] = [];
  try {
    banks = JSON.parse(dataEl.textContent || "[]");
  } catch {
    return () => {};
  }
  if (banks.length === 0) return () => {};

  const template = feed.querySelector<HTMLElement>(rowSelector);
  if (!template) return () => {};

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  let timer: number | undefined;
  let onScreen = false;

  const buildRow = (): HTMLElement => {
    // Clone a row the server already rendered rather than assembling HTML from
    // a string. The markup and its classes then live in exactly one place —
    // the component — so a rebrand restyling the row does not have to find and
    // update a matching template hidden in a script.
    const row = template.cloneNode(true) as HTMLElement;
    const bank = banks[Math.floor(Math.random() * banks.length)];
    const pending = Math.random() > 0.6;

    const badge = row.querySelector<HTMLElement>("[data-winner-bank]");
    if (badge) {
      for (const cls of [...badge.classList]) {
        if (cls.startsWith("bg-[")) badge.classList.remove(cls);
      }
      badge.classList.add(bank.color);
    }

    const icon = row.querySelector<HTMLImageElement>("[data-winner-icon]");
    if (icon) {
      icon.src = bank.icon;
      icon.alt = "";
    }

    const user = row.querySelector<HTMLElement>("[data-winner-user]");
    if (user) user.textContent = randomUser();

    const amount = row.querySelector<HTMLElement>("[data-winner-amount]");
    if (amount) amount.textContent = randomAmount();

    const status = row.querySelector<HTMLElement>("[data-winner-status]");
    if (status) {
      status.textContent = pending ? "[PROCESSING]" : "[VERIFIED]";
      status.classList.toggle("is-pending", pending);
      status.classList.toggle("is-verified", !pending);
    }

    return row;
  };

  const push = () => {
    const row = buildRow();
    if (!reduceMotion?.matches) row.classList.add("is-entering");
    feed.prepend(row);
    if (!reduceMotion?.matches) {
      requestAnimationFrame(() => requestAnimationFrame(() => row.classList.remove("is-entering")));
    }
    while (feed.children.length > maxRows) feed.lastElementChild?.remove();
  };

  const start = () => {
    if (timer !== undefined || !onScreen || document.hidden) return;
    timer = window.setInterval(push, intervalMs);
  };
  const stop = () => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };

  const observer = new IntersectionObserver(
    (entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      if (onScreen) start();
      else stop();
    },
    { rootMargin: "200px" },
  );
  observer.observe(feed);

  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    stop();
    observer.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
