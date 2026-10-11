# RT Elite Transfer – website (Cloudflare Workers)

Mappen en bestanden:
- `public/` – de website zelf (pagina's, icoon, beveiligingsregels in `_headers`)
- `functions/api/` – de server: prijs berekenen, agenda, boeken, Mollie, controlepagina
- `lib/core.js` – tarieven en planningsregels (starttarief, km-prijs, minuutprijs, wachttijd, 60 minuten na een rit, luchthavenprijzen)
- `worker.js` – startpunt: stuurt /api/... naar de server en de rest naar de website
- `wrangler.jsonc` – instellingen voor Cloudflare (naam van de Worker en het ID van de KV-opslag)
- `package.json`

Instellingen in Cloudflare (Worker → Settings → Variables and Secrets):
- `MOLLIE_API_KEY` als Secret (eerst `test_…`, daarna `live_…`)

Controle: open /api/check op de website.
