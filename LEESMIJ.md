# RT Elite Transfer – website (Cloudflare Pages)

Mappen:
- `public/` – de website zelf (pagina's, icoon, beveiligingsregels in `_headers`)
- `functions/api/` – de server: prijs berekenen, agenda, boeken, Mollie, controlepagina
- `lib/core.js` – tarieven en planningsregels (starttarief, km-prijs, minuutprijs, wachttijd, 60 minuten na een rit, luchthavenprijzen)
- `package.json` – instelling voor Cloudflare

Instellingen in Cloudflare (Pages-project → Settings):
- Variables and Secrets: `MOLLIE_API_KEY` (eerst `test_…`, daarna `live_…`), type Secret
- Bindings: KV namespace met variabelenaam `BOOKINGS`

Build-instellingen: Framework preset "None", Build command leeg, Build output directory `public`.

Controle: open /api/check op de website.
