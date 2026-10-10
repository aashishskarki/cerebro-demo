// Shared by the server (news, YouTube) and the browser (Reddit): the mention shape and the rules
// for what counts as a mention. No Node or DOM APIs in here.

export type Raw = {
  id: string;
  source: "News" | "Reddit" | "YouTube";
  kind: "article" | "post" | "comment" | "video";
  venue: string;
  title: string;
  url: string;
  published: string; // ISO date-time, "" when the source gives none
  snippet: string;
};

export type Mention = Raw & { warning: string }; // the warning word found in the text, "" when none

export type SourceHealth = { name: string; ok: boolean; found: number; problem?: string };

export type Gathered = { sources: SourceHealth[]; candidates: Raw[] };

export type ScanResult = {
  brand: string;
  terms: string[];
  days: number;
  total: number;
  sources: SourceHealth[];
  daily: number[]; // mentions per day, oldest first, `days` entries
  mentions: Mention[];
};

// Letters, digits and the punctuation real brand names use. Keeps URLs and search operators out.
export const NAME = /^[\p{L}\p{N}][\p{L}\p{N} &.'+-]{1,39}$/u;

export const WINDOW_DAYS = 30;
export const MAX_MENTIONS = 40;
export const DAY = 86_400_000;

// Plain keyword check, not sentiment analysis: it only says the word appears.
const WARNING_WORDS =
  /\b(scam|scams|scammed|fraud|fraudulent|fake|refund|complaint|complaints|lawsuit|misleading|rip[- ]?off|worst|avoid|mlm|not worth|don'?t (?:join|buy))\b/i;

export function norm(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Runs every query against one source and keeps what really is a mention.
export async function gather(
  name: string,
  queries: string[],
  run: (query: string) => Promise<Raw[]>,
): Promise<Gathered> {
  const needles = queries.map(norm).filter(Boolean);
  const brandKey = norm(queries[0]).replace(/ /g, "");
  const since = Date.now() - WINDOW_DAYS * DAY;
  const settled = await Promise.allSettled(queries.map((q) => run(q)));
  const kept = new Map<string, Raw>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const c of result.value) {
      // Search engines match loosely, so the name has to actually appear in what we can read.
      const hay = ` ${norm(`${c.title} ${c.snippet}`)} `;
      if (!needles.some((n) => hay.includes(` ${n} `))) continue;
      // A channel named after the brand is the brand talking about itself.
      if (c.source === "YouTube" && norm(c.venue).replace(/ /g, "").includes(brandKey)) continue;
      if (c.published && new Date(c.published).getTime() < since) continue;
      if (!c.url || kept.has(c.id)) continue;
      kept.set(c.id, { ...c, title: c.title.slice(0, 200), snippet: c.snippet.slice(0, 320) });
    }
  }
  const failed = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
  return {
    sources: [
      {
        name,
        ok: settled.some((s) => s.status === "fulfilled"),
        found: kept.size,
        ...(failed ? { problem: String(failed.reason?.message || failed.reason).slice(0, 80) } : {}),
      },
    ],
    candidates: [...kept.values()],
  };
}

// Reddit usually outnumbers everything else, so a newest-N cut would hide news and video entirely.
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

export function summarize(brand: string, terms: string[], parts: Gathered[]): ScanResult {
  const unique = new Map<string, Raw>();
  for (const part of parts) for (const c of part.candidates) if (!unique.has(c.id)) unique.set(c.id, c);
  const all = [...unique.values()].sort((a, b) => (a.published < b.published ? 1 : -1));

  const daily = new Array<number>(WINDOW_DAYS).fill(0);
  for (const c of all) {
    if (!c.published) continue;
    const age = Math.floor((Date.now() - new Date(c.published).getTime()) / DAY);
    if (age >= 0 && age < WINDOW_DAYS) daily[WINDOW_DAYS - 1 - age] += 1;
  }

  return {
    brand,
    terms,
    days: WINDOW_DAYS,
    total: all.length,
    sources: parts.flatMap((p) => p.sources),
    daily,
    mentions: pick(all).map((c) => ({
      ...c,
      warning: (`${c.title} ${c.snippet}`.match(WARNING_WORDS) || [""])[0].toLowerCase(),
    })),
  };
}
