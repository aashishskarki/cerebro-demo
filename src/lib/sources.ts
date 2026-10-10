// Server-side sources: news and YouTube. Each one fails on its own without stopping the scan.
// Reddit is fetched by the browser instead; see reddit.ts for why.

import { DAY, WINDOW_DAYS, gather, norm, type Gathered, type Raw } from "@/lib/mentions";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

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

async function get(url: string, ms = 9000): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(ms),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Outlets re-run one press release with small punctuation changes; apostrophes are the usual difference.
const newsId = (title: string) => "nw_" + norm(title.replace(/['‘’`]/g, ""));

async function googleNews(query: string): Promise<Raw[]> {
  const q = encodeURIComponent(`"${query}" when:${WINDOW_DAYS}d`);
  const xml = await get(`https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const venue = plain(tag(item, "source"));
    let title = plain(tag(item, "title"));
    if (venue && title.endsWith(` - ${venue}`)) title = title.slice(0, -venue.length - 3);
    return {
      id: newsId(title),
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
      id: newsId(title),
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

export async function scan(brand: string, terms: string[]): Promise<Gathered[]> {
  const queries = [brand, ...terms];
  return Promise.all([
    gather("Google News", queries, googleNews),
    gather("Bing News", queries, bingNews),
    gather("YouTube", queries, youtube),
  ]);
}
