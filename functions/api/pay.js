// POST /api/pay { id }  ->  nieuwe betaalpoging als de vorige niet gelukt is
import { useEnv, getBooking, saveBooking, syncPayment, allBookings, isBlocking, clashes, windowsOf, createPayment, siteUrl, json, CFG } from "../../lib/core.js";

export async function onRequestPost({ request, env }) {
  useEnv(env);
  let body; try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const b = await getBooking(String(body.id || ""));
  if (!b || b.method !== "online") return json({ error: "not_found" }, 404);
  // Staat de vorige betaling nog open bij Mollie? Dan gaat de klant daarmee verder (zo kan er nooit dubbel betaald worden).
  if (b.paymentId && b.status === "awaiting_payment" && isBlocking(b)) {
    try {
      const s = await syncPayment(b);
      if (s.b.status === "paid") return json({ error: "already_paid" }, 409);
      if (s.checkoutUrl) return json({ checkoutUrl: s.checkoutUrl, resumed: true });
    } catch {}
  }
  if (b.status === "paid") return json({ error: "already_paid" }, 409);
  if (b.status === "released") return json({ error: "released" }, 409);
  if (b.pickup < Date.now() + (b.approachMin + CFG.MIN_LEAD_MIN) * 60000) return json({ error: "too_soon" }, 409);
  const now = Date.now();
  if (!isBlocking(b, now)) {
    const clash = (await allBookings()).some((o) => o.id !== b.id && isBlocking(o, now) && clashes(windowsOf(b), o));
    if (clash) return json({ error: "slot_taken" }, 409);
  }
  try {
    const p = await createPayment(b, siteUrl(request));
    Object.assign(b, { paymentId: p.paymentId, status: "awaiting_payment", holdFrom: now });
    await saveBooking(b);
    return json({ checkoutUrl: p.checkoutUrl });
  } catch (e) {
    const mollieMsg = e.detail?.detail || e.detail?.title || "";
    console.error("Mollie betaling mislukt:", e.code, mollieMsg);
    return json({ error: "payment_unavailable", reason: e.code || "unknown", mollie: mollieMsg }, 503);
  }
}
