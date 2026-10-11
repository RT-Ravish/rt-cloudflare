// POST /api/mollie-webhook  (Mollie stuurt id=tr_xxx)
import { useEnv, mollie, getBooking, saveBooking } from "../../lib/core.js";

export async function onRequestPost({ request, env }) {
  useEnv(env);
  try {
    const form = new URLSearchParams(await request.text());
    const id = form.get("id");
    if (!id) return new Response("", { status: 200 });
    const p = await mollie("/payments/" + encodeURIComponent(id)); // altijd zelf opvragen, nooit de melding vertrouwen
    const b = p.metadata?.bookingId ? await getBooking(p.metadata.bookingId) : null;
    if (b && b.paymentId === p.id) {
      if (p.status === "paid" && b.status !== "paid") { b.status = "paid"; b.paidAt = Date.now(); }
      else if (["failed", "canceled", "expired"].includes(p.status) && b.status === "awaiting_payment") b.status = "payment_failed";
      await saveBooking(b);
    }
  } catch (e) { /* Mollie probeert het later opnieuw */ }
  return new Response("", { status: 200 });
}
