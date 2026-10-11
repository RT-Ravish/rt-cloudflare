// GET /api/availability?date=YYYY-MM-DD  ->  bezette tijdvakken (zonder persoonsgegevens)
import { useEnv, allBookings, isBlocking, amsToEpoch, windowsOf, json } from "../../lib/core.js";

export async function onRequestGet({ request, env }) {
  useEnv(env);
  const date = new URL(request.url).searchParams.get("date") || "";
  const dayStart = amsToEpoch(date, "00:00");
  if (Number.isNaN(dayStart)) return json({ error: "bad_date" }, 400);
  const from = dayStart - 12 * 3600e3, to = dayStart + 36 * 3600e3;
  const now = Date.now();
  const busy = (await allBookings())
    .filter((b) => isBlocking(b, now))
    .flatMap((b) => windowsOf(b))
    .filter((w) => w.blockFrom < to && w.blockTo > from)
    .map((w) => [w.blockFrom, w.blockTo]);
  return json({ busy });
}
