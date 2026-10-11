// Startpunt voor Cloudflare Workers: stuurt /api/... naar de serverfuncties, de rest naar de website-bestanden.
import * as quote from "./functions/api/quote.js";
import * as availability from "./functions/api/availability.js";
import * as book from "./functions/api/book.js";
import * as webhook from "./functions/api/mollie-webhook.js";
import * as status from "./functions/api/status.js";
import * as pay from "./functions/api/pay.js";
import * as release from "./functions/api/release.js";
import * as check from "./functions/api/check.js";

const routes = {
  "/api/quote": quote, "/api/availability": availability, "/api/book": book,
  "/api/mollie-webhook": webhook, "/api/status": status, "/api/pay": pay,
  "/api/release": release, "/api/check": check,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const mod = routes[url.pathname];
    if (mod) {
      const fn = request.method === "POST" ? mod.onRequestPost : request.method === "GET" ? mod.onRequestGet : null;
      if (!fn) return new Response("Method Not Allowed", { status: 405 });
      return fn({ request, env, ctx });
    }
    if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
