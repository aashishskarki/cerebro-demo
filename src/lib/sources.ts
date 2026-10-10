// Free, keyless sources for public brand mentions. Each one fails on its own without stopping the scan.

export type Mention = {
  id: string;
  source: "News" | "Reddit" | "YouTube";
  kind: "article" | "post" | "comment" | "video";
  venue: string;
  title: string;
  url: string;
  published: string; // ISO date-time, "" when the source gives none
  snippet: string;
  warning: string; // the warning word found in the text, "" when none
};

export type SourceHealth = { name: string; ok: boolean; found: number; problem?: string };

export type ScanResult = {
  brand: string;
  terms: string[];
  generatedAt: string;
  days: number;
  total: number;
  sources: SourceHealth[];
  daily: number[]; // mentions per day, oldest first, `days` entries
  mentions: Mention[];
};

export const WINDOW_DAYS = 30;
export const MAX_MENTIONS = 40;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const DAY = 86_400_000;

// Plain keyword check, not sentiment analysis: it only says the word appears.
const WARNING_WORDS =
  /\b(scam|scams|scammed|fraud|fraudulent|fake|refund|complaint|complaints|lawsuit|misleading|rip[- ]?off|worst|avoid|mlm|not worth|don'?t (?:join|buy))\b/i;

export function norm(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function decode(text: string): string {
  return (text || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function plain(html: string): string {
  // Feeds escape their HTML once, so decode first and strip tags second.
  return decode(decode(html).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}

function iso(value: string | number): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function get(url: string, ms = 9000, agent = UA): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": agent, "accept-language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(ms),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

type Raw = Omit<Mention, "warning">;

async function googleNews(query: string): Promise<Raw[]> {
  const q = encodeURIComponent(`"${query}" when:${WINDOW_DAYS}d`);
  const xml = await get(`https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const venue = plain(tag(item, "source"));
    let title = plain(tag(item, "title"));
    if (venue && title.endsWith(` - ${venue}`)) title = title.slice(0, -venue.length - 3);
    return {
      id: "nw_" + norm(title.replace(/['‘’`]/g, "")),
      source: "News",
      kind: "article",
      venue,
      title,
      url: plain(tag(item, "link")),
      published: iso(plain(tag(item, "pubDate"))),
      snippet: "",
    };
  });
}

async function bingNews(query: string): Promise<Raw[]> {
  const q = encodeURIComponent(`"${query}"`);
  const xml = await get(`https://www.bing.com/news/search?q=${q}&format=rss`);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const link = plain(tag(item, "link"));
    let url = link;
    try {
      url = new URL(link).searchParams.get("url") || link;
    } catch {}
    const title = plain(tag(item, "title"));
    return {
      id: "nw_" + norm(title.replace(/['‘’`]/g, "")),
      source: "News",
      kind: "article",
      venue: plain(tag(item, "News:Source")) || host(url),
      title,
      url,
      published: iso(plain(tag(item, "pubDate"))),
      snippet: plain(tag(item, "description")),
    };
  });
}

// Reddit blocks most cloud servers, so this reads a public archive instead. It runs about a week behind.
async function reddit(query: string, kind: "submission" | "comment"): Promise<Raw[]> {
  const after = Math.floor((Date.now() - WINDOW_DAYS * DAY) / 1000);
  const q = encodeURIComponent(`"${query}"`);
  const url = `https://api.pullpush.io/reddit/search/${kind}/?q=${q}&size=100&sort=desc&sort_type=created_utc&after=${after}`;
  let body: string;
  try {
    body = await get(url, 12000);
  } catch (first) {
    // EXPERIMENT: does the archive refuse the browser-like agent or the server's address?
    try {
      body = await get(url, 12000, "cerebro-demo/0.1 (+https://aashishkarki.com/projects/cerebro)");
    } catch (second) {
      let direct = "not tried";
      try {
        await get(`https://www.reddit.com/search.rss?q=${q}&sort=new&limit=25`, 8000);
        direct = "ok";
      } catch (third) {
        direct = String((third as Error).message);
      }
      throw new Error(`archive ${(first as Error).message} / plain agent ${(second as Error).message} / reddit.com ${direct}`);
    }
  }
  const rows: Record<string, unknown>[] = JSON.parse(body).data || [];
  return rows.map((r) => {
    const text = String(r.body ?? r.selftext ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const sub = String(r.subreddit ?? "");
    const isPost = kind === "submission";
    return {
      id: (isPost ? "rd_" : "rc_") + String(r.id),
      source: "Reddit",
      kind: isPost ? "post" : "comment",
      venue: "r/" + sub,
      // A comment has no title, so its opening words stand in for one.
      title: isPost ? String(r.title ?? "") : text.length > 90 ? text.slice(0, 90).trimEnd() + "…" : text,
      url: "https://www.reddit.com" + String(r.permalink ?? ""),
      published: iso(Number(r.created_utc ?? 0) * 1000),
      snippet: text === "[removed]" || text === "[deleted]" || (!isPost && text.length <= 90) ? "" : text,
    };
  });
}

const AGO = /(\d+)\s*(second|sec|minute|min|hour|hr|day|week|wk|month|mo|year|yr|s|h|d|w|y)s?\b\s*ago/i;
const AGO_DAYS: Record<string, number> = { s: 0, mi: 0, h: 0, d: 1, w: 7, mo: 30, y: 365 };

function agoToIso(label: string): string {
  const m = label.match(AGO);
  if (!m) return "";
  const unit = m[2].toLowerCase();
  const key = ["mo", "mi", "s", "h", "d", "w", "y"].find((k) => unit.startsWith(k)) || "d";
  return new Date(Date.now() - Number(m[1]) * AGO_DAYS[key] * DAY).toISOString();
}

function* walk(node: unknown, key: string): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const v of node) yield* walk(v, key);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) yield v as Record<string, unknown>;
      else yield* walk(v, key);
    }
  }
}

function runs(node: unknown): string {
  const n = node as { simpleText?: string; runs?: { text?: string }[] } | undefined;
  if (!n) return "";
  return n.simpleText || (n.runs || []).map((r) => r.text || "").join("");
}

async function youtube(query: string): Promise<Raw[]> {
  const q = encodeURIComponent(`"${query}"`);
  // sp=CAI%3D sorts by upload date
  const page = await get(`https://www.youtube.com/results?search_query=${q}&sp=CAI%253D&hl=en`);
  const m = page.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) throw new Error("YouTube layout changed");
  const out: Raw[] = [];
  for (const v of walk(JSON.parse(m[1]), "videoRenderer")) {
    const snippets = (v.detailedMetadataSnippets as { snippetText?: unknown }[] | undefined) || [];
    const views = runs(v.viewCountText);
    out.push({
      id: "yt_" + String(v.videoId),
      source: "YouTube",
      kind: "video",
      venue: runs(v.ownerText),
      title: runs(v.title),
      url: "https://www.youtube.com/watch?v=" + String(v.videoId),
      published: agoToIso(runs(v.publishedTimeText)),
      snippet: [snippets.map((s) => runs(s.snippetText)).join(" "), views].filter(Boolean).join(" · "),
    });
  }
  return out;
}

// Reddit usually outnumbers everything else, so the newest-N cut would hide news and video entirely.
// Take turns across sources instead, then put the picks back in date order.
function pick(all: Raw[]): Raw[] {
  const queues = (["News", "YouTube", "Reddit"] as const).map((s) => all.filter((c) => c.source === s));
  const picked: Raw[] = [];
  while (picked.length < MAX_MENTIONS && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next && picked.length < MAX_MENTIONS) picked.push(next);
    }
  }
  return picked.sort((a, b) => (a.published < b.published ? 1 : -1));
}

export async function scan(brand: string, terms: string[]): Promise<ScanResult> {
  const queries = [brand, ...terms];
  const needles = queries.map(norm).filter(Boolean);
  const brandKey = norm(brand).replace(/ /g, "");
  const since = Date.now() - WINDOW_DAYS * DAY;

  const jobs: { name: string; run: (q: string) => Promise<Raw[]> }[] = [
    { name: "Google News", run: googleNews },
    { name: "Bing News", run: bingNews },
    { name: "Reddit posts", run: (q) => reddit(q, "submission") },
    { name: "Reddit comments", run: (q) => reddit(q, "comment") },
    { name: "YouTube", run: youtube },
  ];

  const found = new Map<string, Raw>();
  const sources = await Promise.all(
    jobs.map(async (job) => {
      const settled = await Promise.allSettled(queries.map((q) => job.run(q)));
      let kept = 0;
      for (const result of settled) {
        if (result.status !== "fulfilled") continue;
        for (const c of result.value) {
          // Search engines match loosely, so the name has to actually appear in what we can read.
          const hay = ` ${norm(`${c.title} ${c.snippet}`)} `;
          if (!needles.some((n) => hay.includes(` ${n} `))) continue;
          // A channel named after the brand is the brand talking about itself.
          if (c.source === "YouTube" && norm(c.venue).replace(/ /g, "").includes(brandKey)) continue;
          if (c.published && new Date(c.published).getTime() < since) continue;
          if (!c.url || found.has(c.id)) continue;
          found.set(c.id, c);
          kept += 1;
        }
      }
      const failed = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
      return {
        name: job.name,
        ok: settled.some((s) => s.status === "fulfilled"),
        found: kept,
        ...(failed ? { problem: String(failed.reason?.message || failed.reason).slice(0, 80) } : {}),
      };
    }),
  );

  const all = [...found.values()].sort((a, b) => (a.published < b.published ? 1 : -1));
  const daily = new Array<number>(WINDOW_DAYS).fill(0);
  for (const c of all) {
    if (!c.published) continue;
    const age = Math.floor((Date.now() - new Date(c.published).getTime()) / DAY);
    if (age >= 0 && age < WINDOW_DAYS) daily[WINDOW_DAYS - 1 - age] += 1;
  }

  return {
    brand,
    terms,
    generatedAt: new Date().toISOString(),
    days: WINDOW_DAYS,
    total: all.length,
    sources,
    daily,
    mentions: pick(all).map((c) => ({
      ...c,
      title: c.title.slice(0, 200),
      snippet: c.snippet.slice(0, 320),
      warning: (`${c.title} ${c.snippet}`.match(WARNING_WORDS) || [""])[0].toLowerCase(),
    })),
  };
}
