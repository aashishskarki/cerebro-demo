# Cerebro (public demo)

A small public version of Cerebro, a brand mention scanner. Type a brand name and it lists
mentions from the last 30 days on news sites, Reddit and YouTube.

- `src/lib/sources.ts` fetches Google News, Bing News, a public Reddit archive and YouTube search.
- `src/app/api/scan/route.ts` validates the name, rate-limits per IP and returns JSON.
- `src/components/Scanner.tsx` is the form and results page.

No database, no API keys, no AI calls. Nothing a visitor types is stored.

## Run locally

    npm install
    npm run dev

## Deploy

Import the repository into Vercel with the default Next.js settings. One optional variable:

- `NEXT_PUBLIC_WHATSAPP_URL`: the click-to-chat link on the results page.

## Limits

- Reddit comes from the pullpush.io archive, which runs about a week behind.
- At most 40 mentions are shown per scan.
- The per-IP limit is per server instance; the CDN cache (one hour per brand) does most of the protection.
