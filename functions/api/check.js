// GET /api/check  ->  controleert de Mollie-koppeling en de agenda-opslag (toont de sleutel nooit)
import { useEnv, env as getEnv, json } from "../../lib/core.js";

export async function onRequestGet({ env }) {
  useEnv(env);
  const out = { agendaOpslagGekoppeld: !!env.BOOKINGS };
  const raw = getEnv("MOLLIE_API_KEY");
  out.sleutelGevonden = !!raw;
  if (!raw) return json({ ...out, advies: "Geen MOLLIE_API_KEY gevonden. Vul hem in bij Cloudflare en publiceer opnieuw." });
  const key = raw.trim();
  out.spatieOfEnterInSleutel = key !== raw;
  out.soort = key.startsWith("test_") ? "test" : key.startsWith("live_") ? "live" : key.startsWith("access_") ? "access token (verkeerd type)" : "onbekend";
  try {
    const r = await fetch("https://api.mollie.com/v2/methods", { headers: { Authorization: "Bearer " + key } });
    const j = await r.json().catch(() => ({}));
    out.mollieStatus = r.status;
    if (r.ok) {
      out.betaalmethodenAan = (j._embedded?.methods || []).map((m) => m.id);
      out.advies = !out.agendaOpslagGekoppeld ? "Mollie werkt, maar de agenda-opslag (KV, naam BOOKINGS) is nog niet gekoppeld."
        : out.betaalmethodenAan.length ? "Koppeling werkt." : "Sleutel werkt, maar er staat geen betaalmethode aan. Zet iDEAL aan in Mollie.";
    } else {
      out.mollieMelding = j.detail || j.title || "";
      out.advies = r.status === 401 ? "Mollie herkent de sleutel niet. Kopieer hem opnieuw (zonder spaties) en publiceer opnieuw." : "Mollie geeft een foutmelding, zie mollieMelding.";
    }
  } catch (e) {
    out.advies = "Mollie is niet bereikbaar vanaf de server.";
  }
  return json(out);
}
