// POST /api/release { id, key }  ->  rit afwijzen en tijd vrijgeven (alleen via de link in uw boekingsmail)
import { useEnv, getBooking, saveBooking, safeEqual, json } from "../../lib/core.js";

export async function onRequestPost({ request, env }) {
  useEnv(env);
  let body; try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const b = await getBooking(String(body.id || ""));
  if (!b || !safeEqual(body.key || "", b.key)) return json({ error: "not_allowed" }, 403);
  b.status = "released"; b.releasedAt = Date.now();
  await saveBooking(b);
  return json({ ok: true, wasPaid: !!b.paidAt });
}
