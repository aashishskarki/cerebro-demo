"use client";

import { useEffect, useState } from "react";
import { NAME, summarize, type Gathered, type Mention, type ScanResult } from "@/lib/mentions";
import { redditFromBrowser } from "@/lib/reddit";

const WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_URL || "https://wa.me/917505511899";

const ERRORS: Record<string, string> = {
  bad_brand: "Enter a brand name of 2 to 40 characters, using letters and numbers.",
  bad_terms: "Add at most 2 product names, separated by commas, 2 to 40 characters each.",
  rate_limited: "That's a lot of scans in one hour. Try again a little later.",
  sources_down: "None of the sources answered just now. Try again in a minute.",
  scan_failed: "The scan didn't finish. Try again in a minute.",
};

type Filter = "all" | Mention["source"] | "warning";

function when(isoDate: string): string {
  if (!isoDate) return "undated";
  return new Date(isoDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function sourceTotals(result: ScanResult) {
  const group = (prefix: string) => result.sources.filter((s) => s.name.startsWith(prefix));
  return [
    { label: "News", parts: [...group("Google"), ...group("Bing")] },
    { label: "Reddit", parts: group("Reddit") },
    { label: "YouTube", parts: group("YouTube") },
  ].map(({ label, parts }) => ({
    label: label as Mention["source"],
    reached: parts.some((p) => p.ok),
    partial: parts.some((p) => !p.ok),
  }));
}

export default function Scanner() {
  const [brand, setBrand] = useState("");
  const [terms, setTerms] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  async function run(brandValue: string, termsValue: string) {
    const b = brandValue.trim().replace(/\s+/g, " ");
    const list = termsValue
      .split(",")
      .map((t) => t.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    if (!NAME.test(b)) return setError(ERRORS.bad_brand);
    if (list.length > 2 || list.some((t) => !NAME.test(t))) return setError(ERRORS.bad_terms);
    setBusy(true);
    setError(null);
    setResult(null);
    setFilter("all");
    const query = new URLSearchParams({ brand: b });
    if (list.length) query.set("terms", list.join(","));
    window.history.replaceState(null, "", `?${query}`);
    // News and YouTube come from the server; Reddit only answers browsers, so the page asks it directly.
    const [server, reddit] = await Promise.allSettled([
      fetch(`/api/scan?${query}`).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "scan_failed");
        return data.parts as Gathered[];
      }),
      redditFromBrowser([b, ...list]),
    ]);
    const parts = [
      ...(server.status === "fulfilled" ? server.value : []),
      ...(reddit.status === "fulfilled" ? reddit.value : []),
    ];
    if (server.status === "rejected" && !parts.some((p) => p.sources.some((s) => s.ok))) {
      const code = (server.reason as Error)?.message;
      setError(ERRORS[code] || "Network error. Check your connection and try again.");
    } else {
      if (server.status === "rejected") {
        parts.unshift({ sources: [{ name: "Google News", ok: false, found: 0 }, { name: "YouTube", ok: false, found: 0 }], candidates: [] });
      }
      setResult(summarize(b, list, parts));
    }
    setBusy(false);
  }

  // A shared link like ?brand=Acme runs straight away.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const b = query.get("brand");
    if (!b) return;
    const t = query.get("terms") || "";
    setBrand(b);
    setTerms(t);
    run(b, t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mentions = result?.mentions || [];
  const warned = mentions.filter((m) => m.warning);
  const shown = mentions.filter((m) =>
    filter === "all" ? true : filter === "warning" ? Boolean(m.warning) : m.source === filter,
  );
  const peak = Math.max(1, ...(result?.daily || []));

  return (
    <>
      <form
        className="mt-8 rounded-xl border border-slate-200 bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          run(brand, terms);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block text-sm font-medium text-slate-800" htmlFor="brand">
            Brand name
            <input
              id="brand"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              placeholder="Your brand or company"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              maxLength={40}
              disabled={busy}
            />
          </label>
          <label className="block text-sm font-medium text-slate-800" htmlFor="terms">
            Product names <span className="font-normal text-slate-400">(optional, up to 2)</span>
            <input
              id="terms"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              placeholder="A product, a course"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              maxLength={85}
              disabled={busy}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
          >
            {busy ? "Scanning…" : "Scan 30 days"}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Works best with distinctive names. A common word like &ldquo;Apple&rdquo; will pull in unrelated results.
        </p>
        {error && (
          <p className="mt-3 text-sm text-rose-600" role="alert">
            {error}
          </p>
        )}
      </form>

      {busy && (
        <p className="mt-6 text-sm text-slate-600" role="status">
          Checking news sites, Reddit and YouTube. This takes up to 20 seconds.
        </p>
      )}

      {result && (
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <section className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              <span className="tnum">{result.total}</span> mention{result.total === 1 ? "" : "s"} of{" "}
              {[result.brand, ...result.terms].join(", ")} in the last {result.days} days
            </h2>
            {result.total > mentions.length && (
              <p className="mt-1 text-sm text-slate-500">Showing {mentions.length} of them: the newest from each source.</p>
            )}

            {result.total > 0 && (
              <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium text-slate-500">Mentions per day</p>
                <div className="mt-3 flex h-16 items-end gap-[3px]" aria-hidden="true">
                  {result.daily.map((n, i) => (
                    <div
                      key={i}
                      className={`flex-1 rounded-sm ${n ? "bg-indigo-500" : "bg-slate-100"}`}
                      style={{ height: n ? `${Math.max(12, (100 * n) / peak)}%` : "3px" }}
                      title={`${n} mention${n === 1 ? "" : "s"}`}
                    />
                  ))}
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
                  <span>{result.days} days ago</span>
                  <span className="tnum">busiest day: {peak}</span>
                  <span>today</span>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  The last few days look quieter than they are: Reddit results arrive about a week late.
                </p>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {(
                [
                  ["all", `All ${mentions.length}`],
                  ...sourceTotals(result).map((s) => [
                    s.label,
                    `${s.label} ${mentions.filter((m) => m.source === s.label).length}`,
                  ]),
                  ...(warned.length ? [["warning", `Warning words ${warned.length}`]] : []),
                ] as [Filter, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={`tnum rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    filter === value
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {sourceTotals(result)
              .filter((s) => !s.reached || s.partial)
              .map((s) => (
                <p key={s.label} className="mt-3 text-xs text-amber-700">
                  {s.reached
                    ? `${s.label} only partly answered, so some ${s.label} mentions may be missing.`
                    : `${s.label} could not be reached just now, so its mentions are missing.`}
                </p>
              ))}

            {result.total === 0 ? (
              <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
                Nothing found for this name in the last {result.days} days. Check the spelling, try the name
                people actually use, or add a product name.
              </div>
            ) : (
              <ul className="mt-5 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                {shown.map((m) => (
                  <li key={m.id} className="p-4">
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[15px] font-medium break-words text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
                    >
                      {m.title || "Untitled"}
                    </a>
                    <p className="mt-1 text-xs text-slate-500">
                      {m.source} {m.kind} · {m.venue || "unknown"} · {when(m.published)}
                    </p>
                    {m.snippet && (
                      <p className="mt-2 line-clamp-3 text-sm leading-relaxed break-words text-slate-600">
                        {m.snippet}
                      </p>
                    )}
                    {m.warning && (
                      <p className="mt-2 inline-block rounded bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                        Contains &ldquo;{m.warning}&rdquo;
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-4 text-xs leading-relaxed text-slate-500">
              Results are raw matches, not checked by a person or by AI. Reddit comes from a public archive
              (pullpush.io) that your browser asks directly; it runs about a week behind. &ldquo;Warning
              words&rdquo; only means the word appears in the text. Quora, LinkedIn, X and Instagram are not
              covered.
            </p>
          </section>

          <aside className="h-fit rounded-xl border border-slate-200 bg-slate-900 p-5 text-white lg:sticky lg:top-6">
            <p className="text-sm font-semibold">This is the small version</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">The full Cerebro setup for a brand adds:</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-300">
              <li>A daily run instead of a one-off scan</li>
              <li>AI reading of each mention: tone, topic and a one-line summary</li>
              <li>Tracking of replies inside threads about you</li>
              <li>A dashboard with trends and a daily email of what needs a reply</li>
            </ul>
            <a
              href={WHATSAPP}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 block rounded-lg bg-emerald-500 px-3 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-emerald-400"
            >
              Chat on WhatsApp
            </a>
            <a
              href="https://www.linkedin.com/in/aashish-karki/"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block rounded-lg bg-white px-3 py-2 text-center text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100"
            >
              Message on LinkedIn
            </a>
          </aside>
        </div>
      )}
    </>
  );
}
