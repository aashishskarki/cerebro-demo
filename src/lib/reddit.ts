// Reddit search, run in the visitor's browser.
//
// reddit.com and the pullpush.io archive both refuse requests from cloud servers (403 / 429 from
// Vercel), but the archive allows any website to call it from a browser. So this is the one source
// the page fetches itself. The archive runs about a week behind Reddit.

import { DAY, WINDOW_DAYS, gather, type Gathered, type Raw } from "@/lib/mentions";

async function search(query: string, kind: "submission" | "comment"): Promise<Raw[]> {
  const after = Math.floor((Date.now() - WINDOW_DAYS * DAY) / 1000);
  const q = encodeURIComponent(`"${query}"`);
  const res = await fetch(
    `https://api.pullpush.io/reddit/search/${kind}/?q=${q}&size=100&sort=desc&sort_type=created_utc&after=${after}`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows: Record<string, unknown>[] = (await res.json()).data || [];
  return rows.map((r) => {
    const text = String(r.body ?? r.selftext ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const sub = String(r.subreddit ?? "");
    const isPost = kind === "submission";
    const created = new Date(Number(r.created_utc ?? 0) * 1000);
    return {
      id: (isPost ? "rd_" : "rc_") + String(r.id),
      source: "Reddit",
      kind: isPost ? "post" : "comment",
      venue: "r/" + sub,
      // A comment has no title, so its opening words stand in for one.
      title: isPost ? String(r.title ?? "") : text.length > 90 ? text.slice(0, 90).trimEnd() + "…" : text,
      url: "https://www.reddit.com" + String(r.permalink ?? ""),
      published: Number.isNaN(created.getTime()) ? "" : created.toISOString(),
      snippet: text === "[removed]" || text === "[deleted]" || (!isPost && text.length <= 90) ? "" : text,
    };
  });
}

export async function redditFromBrowser(queries: string[]): Promise<Gathered[]> {
  return Promise.all([
    gather("Reddit posts", queries, (q) => search(q, "submission")),
    gather("Reddit comments", queries, (q) => search(q, "comment")),
  ]);
}
