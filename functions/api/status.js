// GET /api/status?id=...  ->  betaalstatus van een boeking (zonder persoonsgegevens)
import { useEnv, getBooking, syncPayment, json, CFG } from "../../lib/core.js";

export async function onRequestGet({ request, env }) {
  useEnv(env);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-z0-9]{8,40}$/.test(id)) return json({ error: "bad_id" }, 400);
  let b = await getBooking(id);
  if (!b) return json({ error: "not_found" }, 404);
  let pay = null, checkoutUrl = null;
  if (b.status === "awaiting_payment") { try { ({ b, pay, checkoutUrl } = await syncPayment(b)); } catch {} }
  // Hoe lang de gekozen tijd nog wordt vastgehouden tijdens het betalen (minuten)
  const holdLeft = b.status === "awaiting_payment" ? Math.max(0, Math.ceil(((b.holdFrom || b.createdAt) + CFG.PAY_HOLD_MIN * 60000 - Date.now()) / 60000)) : 0;
  return json({ status: b.status, pay, checkoutUrl, holdLeft, method: b.method, price: b.price, date: b.date, time: b.time, lang: b.lang,
    ret: b.ret ? { date: b.ret.date, time: b.ret.time, wait: !!b.ret.wait, waitMin: b.ret.waitMin || 0 } : null });
}
