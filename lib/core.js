// Gedeelde logica voor de serverfuncties van RT Elite Transfer (Cloudflare Pages).
// Pas hier de tarieven en planningsregels aan.

export const CFG = {
  // Vertrekpunt chauffeur (afgerond op ~100 m, wordt nooit getoond)
  BASE: [4.302, 52.053],
  START: 4.5,          // starttarief
  PER_KM: 3.15,        // per kilometer
  PER_MIN: 0.5,        // per minuut rijden
  AFTER_MIN: 60,       // na afloop van een rit dit aantal minuten niet beschikbaar
  MIN_LEAD_MIN: 15,    // extra marge bovenop de aanrijtijd voor boekingen op korte termijn
  PAY_HOLD_MIN: 30,    // zo lang blijft een tijd gereserveerd tijdens online betalen
  RETURN_GAP_MIN: 30,  // terugrit op zijn vroegst zoveel minuten na aankomst van de heenrit
  WAIT_BLOCK_MIN: 30,  // wachttijd per begonnen blok van 30 minuten
  WAIT_PRICE: 25,      // prijs per blok wachttijd
  KEEP_DAYS: 120,      // boekingsgegevens (alleen tijden/status) worden zoveel dagen na de rit automatisch verwijderd
  AIRPORTS: [
    { key: "ams", name: "Schiphol", min: 60, max: 80,
      match: ["schiphol"] },
    { key: "rtm", name: "Rotterdam The Hague Airport", min: 40, max: 50,
      match: ["rotterdam the hague airport", "rotterdam airport", "zestienhoven", "rotterdam-the hague"] },
  ],
  TZ: "Europe/Amsterdam",
  UA: "RT Elite Transfer website (rt-elitetransfer@outlook.com)",
};

// ---------- omgeving (Cloudflare geeft instellingen per verzoek mee) ----------
let ENV = {};
export const useEnv = (env) => { ENV = env || {}; };
export const env = (k) => (typeof ENV[k] === "string" ? ENV[k] : undefined);
export const siteUrl = (req) => env("SITE_URL") || new URL(req.url).origin;

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });

const kv = () => {
  if (!ENV.BOOKINGS) throw Object.assign(new Error("no_kv"), { code: "no_kv" });
  return ENV.BOOKINGS;
};

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- tijdzone ----------
function tzOffsetMin(epoch) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: CFG.TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(epoch)).map((x) => [x.type, x.value])
  );
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - epoch) / 60000;
}
export function amsToEpoch(dateStr, timeStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(timeStr)) return NaN;
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let e = guess - tzOffsetMin(guess) * 60000;
  e = guess - tzOffsetMin(e) * 60000;
  return e;
}
export function amsParts(epoch) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: CFG.TZ, hourCycle: "h23", weekday: "short", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(epoch)).map((x) => [x.type, x.value])
  );
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { dow, minutes: +p.hour * 60 + +p.minute };
}
// vrijdag 17:00 t/m zondag 23:00
export function inServiceWindow(epoch) {
  const { dow, minutes } = amsParts(epoch);
  if (dow === 5) return minutes >= 17 * 60;
  if (dow === 6) return true;
  if (dow === 0) return minutes <= 23 * 60;
  return false;
}

// ---------- route en prijs ----------
async function geocode(q) {
  const u = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=nl,be,de&accept-language=nl&q=" + encodeURIComponent(q);
  const r = await fetch(u, { headers: { "User-Agent": CFG.UA, Accept: "application/json" } });
  if (!r.ok) throw new Error("geocode_failed");
  const j = await r.json();
  if (!j.length) return null;
  return { lon: +j[0].lon, lat: +j[0].lat, name: j[0].display_name };
}
const shortName = (d) => d.split(",").slice(0, 3).join(",").trim();

function airportFor(text) {
  const t = (text || "").toLowerCase();
  return CFG.AIRPORTS.find((a) => a.match.some((m) => t.includes(m))) || null;
}

export async function computeQuote(fromQ, toQ, { fromBase = true } = {}) {
  const a = await geocode(fromQ);
  if (!a) return { error: "from_not_found" };
  await sleep(1100); // Nominatim: maximaal 1 verzoek per seconde
  const b = await geocode(toQ);
  if (!b) return { error: "to_not_found" };
  // fromBase=false: de chauffeur staat al op het ophaaladres (wachten bij retourrit), dus geen aanrijden
  const pts = fromBase ? [CFG.BASE, [a.lon, a.lat], [b.lon, b.lat]] : [[a.lon, a.lat], [b.lon, b.lat]];
  const coords = pts.map((c) => c[0] + "," + c[1]).join(";");
  const r = await fetch("https://router.project-osrm.org/route/v1/driving/" + coords + "?overview=false", { headers: { "User-Agent": CFG.UA } });
  if (!r.ok) throw new Error("route_failed");
  const j = await r.json();
  if (j.code !== "Ok" || !j.routes?.length) return { error: "no_route" };
  const legs = j.routes[0].legs;
  const [l0, l1] = fromBase ? legs : [{ distance: 0, duration: 0 }, legs[0]];
  const approachKm = r1(l0.distance / 1000), rideKm = r1(l1.distance / 1000);
  const approachMin = Math.ceil(l0.duration / 60), rideMin = Math.ceil(l1.duration / 60);
  const totalKm = r1(approachKm + rideKm), minutes = approachMin + rideMin;
  const kmCost = r2(totalKm * CFG.PER_KM), minCost = r2(minutes * CFG.PER_MIN);
  const tariff = r2(CFG.START + kmCost + minCost);
  const ap = airportFor(fromQ + " " + a.name) || airportFor(toQ + " " + b.name);
  const price = ap ? Math.min(ap.max, Math.max(ap.min, tariff)) : tariff;
  return {
    fromLabel: shortName(a.name), toLabel: shortName(b.name),
    approachKm, rideKm, totalKm, approachMin, rideMin, minutes,
    start: CFG.START, kmCost, minCost, tariff,
    airport: ap ? { name: ap.name, min: ap.min, max: ap.max } : null,
    price: r2(price), afterMin: CFG.AFTER_MIN, leadMin: CFG.MIN_LEAD_MIN,
    wait: !fromBase, waitBlockMin: CFG.WAIT_BLOCK_MIN, waitPrice: CFG.WAIT_PRICE,
  };
}

// ---------- ondertekende prijsopgave (zodat de prijs niet te vervalsen is) ----------
const enc = new TextEncoder(), dec = new TextDecoder();
const secret = () => env("SIGNING_SECRET") || (env("MOLLIE_API_KEY") || "").trim() || "dev-only-secret";
function b64u(bytes) {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/"); while (str.length % 4) str += "=";
  const bin = atob(str); return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const hmacKey = () => crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
export async function signQuote(obj) {
  const body = b64u(enc.encode(JSON.stringify({ ...obj, iat: Date.now() })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body)));
  return body + "." + b64u(sig);
}
export async function verifyQuote(token) {
  try {
    if (typeof token !== "string" || !token.includes(".")) return null;
    const [body, sig] = token.split(".");
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(), b64uDecode(sig), enc.encode(body));
    if (!ok) return null;
    const obj = JSON.parse(dec.decode(b64uDecode(body)));
    if (Date.now() - obj.iat > 3 * 3600 * 1000) return null; // 3 uur geldig
    return obj;
  } catch { return null; }
}
export function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---------- boekingen (Cloudflare KV) ----------
export const waitCostFor = (min) => (min > 0 ? Math.ceil(min / CFG.WAIT_BLOCK_MIN) * CFG.WAIT_PRICE : 0);
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
export const newId = () => Date.now().toString(36) + [...rand(4)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const newKey = () => b64u(rand(16));

export function isBlocking(b, now = Date.now()) {
  if (b.status === "requested" || b.status === "paid") return true;
  if (b.status === "awaiting_payment") return now - (b.holdFrom || b.createdAt) < CFG.PAY_HOLD_MIN * 60000;
  return false;
}
export const windowFor = (pickup, approachMin, rideMin) => ({
  blockFrom: pickup - approachMin * 60000,
  blockTo: pickup + (rideMin + CFG.AFTER_MIN) * 60000,
});
export const overlaps = (a, b) => a.blockFrom < b.blockTo && b.blockFrom < a.blockTo;
// Alle bezette tijdvakken van een boeking (heenrit en eventueel terugrit)
export const windowsOf = (b) => (Array.isArray(b.windows) && b.windows.length ? b.windows : [{ blockFrom: b.blockFrom, blockTo: b.blockTo }]);
export const clashes = (wins, b) => wins.some((w) => windowsOf(b).some((x) => overlaps(w, x)));

// Snelle lijst van alle boekingen: alleen tijdvakken en status, uit de KV-metadata
export async function allBookings() {
  const out = []; let cursor;
  do {
    const r = await kv().list({ prefix: "b/", cursor });
    for (const k of r.keys) {
      const m = k.metadata || {};
      out.push({ id: k.name.slice(2), windows: m.w || [], status: m.s, holdFrom: m.h, createdAt: m.c });
    }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}
export const getBooking = (id) => kv().get("b/" + id, "json");
export async function saveBooking(b) {
  const lastEnd = Math.max(...windowsOf(b).map((w) => w.blockTo));
  const expiration = Math.floor(lastEnd / 1000) + CFG.KEEP_DAYS * 86400;
  await kv().put("b/" + b.id, JSON.stringify(b), {
    expiration,
    metadata: { w: windowsOf(b), s: b.status, h: b.holdFrom, c: b.createdAt },
  });
}

// ---------- Mollie ----------
export async function mollie(path, opts = {}) {
  const key = (env("MOLLIE_API_KEY") || "").trim();
  if (!key) throw Object.assign(new Error("no_mollie_key"), { code: "no_mollie_key" });
  const r = await fetch("https://api.mollie.com/v2" + path, {
    ...opts,
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error("mollie_error"), { code: "mollie_error", detail: j });
  return j;
}
export async function createPayment(b, site) {
  const p = await mollie("/payments", {
    method: "POST",
    body: JSON.stringify({
      amount: { currency: "EUR", value: b.price.toFixed(2) },
      description: `Taxirit ${b.date} ${b.time}${b.ret ? " + retour " + b.ret.date + " " + b.ret.time : ""} – RT Elite Transfer`,
      redirectUrl: `${site}/bedankt.html?id=${b.id}`,
      webhookUrl: `${site}/api/mollie-webhook`,
      locale: b.lang === "en" ? "en_GB" : "nl_NL",
      metadata: { bookingId: b.id },
    }),
  });
  return { paymentId: p.id, checkoutUrl: p._links?.checkout?.href };
}
// Haal de betaalstatus op bij Mollie en werk de boeking bij.
// Geeft ook de Mollie-status terug, en de betaallink zolang de betaling nog open staat.
export async function syncPayment(b) {
  if (!b.paymentId) return { b, pay: null, checkoutUrl: null };
  const p = await mollie("/payments/" + b.paymentId);
  if (p.status === "paid" && b.status !== "paid") { b.status = "paid"; b.paidAt = Date.now(); await saveBooking(b); }
  else if (["failed", "canceled", "expired"].includes(p.status) && b.status === "awaiting_payment") { b.status = "payment_failed"; await saveBooking(b); }
  const checkoutUrl = p.status === "open" ? p._links?.checkout?.href || null : null;
  return { b, pay: p.status, checkoutUrl };
}
