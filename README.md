# Cerebro (public demo)

A small public version of Cerebro, a brand mention scanner. Type a brand name and it lists
mentions from the last 30 days on news sites, Reddit and YouTube.

- `src/lib/sources.ts` fetches Google News, Bing News and YouTube search on the server.
- `src/lib/reddit.ts` fetches Reddit in the visitor's browser. reddit.com and the pullpush.io archive
  both refuse cloud servers (403 / 429 from Vercel), but the archive allows browser requests.
- `src/lib/mentions.ts` holds the shared rules: what counts as a mention, the 40-item cut, warning words.
- `src/app/api/scan/route.ts` validates the name, rate-limits per IP and returns JSON.
- `src/components/Scanner.tsx` is the form and results page; it merges both halves.

No database, no API keys, no AI calls. Nothing a visitor types is stored.

## Run locally

    npm install
    npm run dev

## Deploy

Import the repository into Vercel with the default Next.js settings. One optional variable:

- `NEXT_PUBLIC_WHATSAPP_URL`: the click-to-chat link on the results page.

## Limits

- Reddit comes from the pullpush.io archive, which runs about a week behind. The visitor's browser
  calls it directly, so pullpush sees their IP address and the brand they typed.
- At most 40 mentions are shown per scan.
- The per-IP limit is per server instance; the CDN cache (one hour per brand) does most of the protection.
