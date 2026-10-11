// GET /api/status?id=...  ->  betaalstatus van een boeking (zonder persoonsgegevens)
import { useEnv, getBooking, syncPayment, json } from "../../lib/core.js";

export async function onRequestGet({ request, env }) {
  useEnv(env);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-z0-9]{8,40}$/.test(id)) return json({ error: "bad_id" }, 400);
  let b = await getBooking(id);
  if (!b) return json({ error: "not_found" }, 404);
  if (b.status === "awaiting_payment") { try { b = await syncPayment(b); } catch {} }
  return json({ status: b.status, method: b.method, price: b.price, date: b.date, time: b.time, lang: b.lang,
    ret: b.ret ? { date: b.ret.date, time: b.ret.time, wait: !!b.ret.wait, waitMin: b.ret.waitMin || 0 } : null });
}
