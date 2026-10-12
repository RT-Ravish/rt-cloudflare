// POST /api/release { id, key, unpaidOnly? }  ->  rit afwijzen en tijd vrijgeven
// Via de link in de boekingsmail, of door de klant zelf als de online betaling niet is afgerond (unpaidOnly).
import { useEnv, getBooking, saveBooking, safeEqual, syncPayment, json } from "../../lib/core.js";

export async function onRequestPost({ request, env }) {
  useEnv(env);
  let body; try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const b = await getBooking(String(body.id || ""));
  if (!b || !safeEqual(body.key || "", b.key)) return json({ error: "not_allowed" }, 403);
  if (body.unpaidOnly && (b.status === "paid" || b.method !== "online")) return json({ error: "not_allowed" }, 409);
  if (body.unpaidOnly && b.paymentId) {
    // eerst controleren of er toch net betaald is
    try { const s = await syncPayment(b); if (s.b.status === "paid") return json({ error: "already_paid" }, 409); } catch {}
  }
  b.status = "released"; b.releasedAt = Date.now();
  await saveBooking(b);
  return json({ ok: true, wasPaid: !!b.paidAt });
}
