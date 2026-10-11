// POST /api/quote  { from: "Straat 1, Plaats", to: "Straat 2, Plaats", wait?: true }
import { useEnv, computeQuote, signQuote, json } from "../../lib/core.js";

export async function onRequestPost({ request, env }) {
  useEnv(env);
  let body; try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const from = String(body.from || "").trim().slice(0, 200);
  const to = String(body.to || "").trim().slice(0, 200);
  if (from.length < 5 || to.length < 5) return json({ error: "address_missing" }, 400);
  try {
    const q = await computeQuote(from, to, { fromBase: !body.wait });
    if (q.error) return json(q, 422);
    return json({ ...q, token: await signQuote({ from, to, ...q }) });
  } catch (e) {
    return json({ error: "service_unavailable" }, 503);
  }
}
