// POST /api/book  { token, date, time, method, lang, website(honeypot), ret?: { token, date, time, wait } }
import {
  useEnv, verifyQuote, amsToEpoch, inServiceWindow, allBookings, isBlocking, windowFor, clashes,
  newId, newKey, saveBooking, createPayment, siteUrl, json, CFG, waitCostFor,
} from "../../lib/core.js";

const r2 = (n) => Math.round(n * 100) / 100;

export async function onRequestPost({ request, env }) {
  useEnv(env);
  let body; try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (body.website) return json({ error: "rejected" }, 400); // spamval
  const q = await verifyQuote(body.token);
  if (!q) return json({ error: "quote_expired" }, 400);
  const method = ["pin", "contant", "online"].includes(body.method) ? body.method : null;
  if (!method) return json({ error: "bad_method" }, 400);
  const pickup = amsToEpoch(String(body.date), String(body.time));
  if (Number.isNaN(pickup) || !inServiceWindow(pickup)) return json({ error: "outside_hours" }, 400);
  if (pickup < Date.now() + (q.approachMin + CFG.MIN_LEAD_MIN) * 60000) return json({ error: "too_soon" }, 409);
  const win = windowFor(pickup, q.approachMin, q.rideMin);
  const windows = [win];

  // ---- optionele terugrit ----
  let ret = null;
  if (body.ret) {
    const rq = await verifyQuote(body.ret.token);
    if (!rq) return json({ error: "quote_expired" }, 400);
    const rp = amsToEpoch(String(body.ret.date), String(body.ret.time));
    if (Number.isNaN(rp) || !inServiceWindow(rp)) return json({ error: "ret_outside_hours" }, 400);
    const arrival = pickup + q.rideMin * 60000;
    let waitMin = 0, waitCost = 0;
    if (body.ret.wait) {
      // chauffeur wacht op de bestemming van de heenrit: terugrit moet daar beginnen, geen aanrijden
      if (!rq.wait || rq.from !== q.to) return json({ error: "quote_expired" }, 400);
      if (rp < arrival) return json({ error: "ret_too_early" }, 400);
      waitMin = Math.round((rp - arrival) / 60000);
      waitCost = waitCostFor(waitMin);
      windows[0] = { blockFrom: win.blockFrom, blockTo: rp + (rq.rideMin + CFG.AFTER_MIN) * 60000 }; // aaneengesloten bezet
    } else {
      if (rq.wait) return json({ error: "quote_expired" }, 400);
      if (rp < arrival + CFG.RETURN_GAP_MIN * 60000) return json({ error: "ret_too_early" }, 400);
      windows.push(windowFor(rp, rq.approachMin, rq.rideMin));
    }
    ret = { date: String(body.ret.date), time: String(body.ret.time), pickup: rp, wait: !!body.ret.wait, waitMin, waitCost,
      approachMin: rq.approachMin, rideMin: rq.rideMin, price: rq.price, airport: rq.airport?.name || null };
  }

  const now = Date.now();
  const clash = (await allBookings()).some((b) => isBlocking(b, now) && clashes(windows, b));
  if (clash) return json({ error: "slot_taken" }, 409);

  const b = {
    id: newId(), key: newKey(), createdAt: now, holdFrom: now,
    date: String(body.date), time: String(body.time), pickup, ...win, windows,
    approachMin: q.approachMin, rideMin: q.rideMin, legPrice: q.price,
    price: r2(q.price + (ret ? ret.price + ret.waitCost : 0)), airport: q.airport?.name || null, ret,
    method, lang: body.lang === "en" ? "en" : "nl",
    status: method === "online" ? "awaiting_payment" : "requested",
  };
  await saveBooking(b);

  const resp = { id: b.id, key: b.key, price: b.price, legPrice: b.legPrice, retPrice: ret ? ret.price : null, waitMin: ret ? ret.waitMin : 0, waitCost: ret ? ret.waitCost : 0,
    windows: windows.map((w) => [w.blockFrom, w.blockTo]), status: b.status };
  if (method === "online") {
    try {
      const p = await createPayment(b, siteUrl(request));
      b.paymentId = p.paymentId;
      await saveBooking(b);
      return json({ ...resp, checkoutUrl: p.checkoutUrl });
    } catch (e) {
      b.status = "released"; await saveBooking(b);
      const reason = e.code || "unknown";
      const mollieMsg = e.detail?.detail || e.detail?.title || "";
      console.error("Mollie betaling mislukt:", reason, mollieMsg);
      return json({ error: "payment_unavailable", reason, mollie: mollieMsg }, 503);
    }
  }
  return json(resp);
}
