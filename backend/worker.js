const ipRateMap = new Map();

function checkRateLimit(ip, bucket, maxHits, windowMs) {
  const key = bucket + ":" + ip;
  const now = Date.now();
  let entry = ipRateMap.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  entry.count += 1;
  ipRateMap.set(key, entry);
  if (ipRateMap.size > 5000) {
    for (const [k, v] of ipRateMap.entries()) {
      if (now > v.resetAt) ipRateMap.delete(k);
    }
  }
  return entry.count <= maxHits;
}

function sanitizeText(val, maxLen = 500) {
  return String(val == null ? "" : val)
    .replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[ch]))
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLen);
}

function safeEqual(a, b) {
  const sa = String(a || "");
  const sb = String(b || "");
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) {
    diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  }
  return diff === 0;
}

async function signSessionToken(secret, username, role) {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = username + ":" + role + ":" + exp;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("cn_hmac_v2:" + (secret || "fallback_secret")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const sigHex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return btoa(payload) + "." + sigHex;
}

async function verifySessionToken(secret, token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 2) return null;
    const payload = atob(parts[0]);
    const [username, role, expStr] = payload.split(":");
    if (!username || !role || Number(expStr) < Date.now()) return null;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("cn_hmac_v2:" + (secret || "fallback_secret")),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    const expectedHex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (!safeEqual(parts[1], expectedHex)) return null;
    return { username, role };
  } catch (_) {
    return null;
  }
}

export default {
  async fetch(request, env, ctx) {
    const allowedOrigins = [
      "https://clubsnight.my.id",
      "https://www.clubsnight.my.id",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "http://127.0.0.1:5173"
    ];
    const origin = request.headers.get("Origin") || "";
    const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const isPagesPreview = /^https:\/\/[a-z0-9-]+\.clubsnight-id\.pages\.dev$/.test(origin);
    const isAllowedOrigin = allowedOrigins.includes(origin) || isLocalhost || isPagesPreview;
    const corsOrigin = isAllowedOrigin ? origin : allowedOrigins[0];

    const securityHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Session-Token",
      "Access-Control-Max-Age": "86400",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Cache-Control": "no-store",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: securityHeaders });
    }

    const url = new URL(request.url);
    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";

    const isAuthorized = () => {
      const authHeader = request.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      const validSecret = env.ADMIN_SECRET_TOKEN;
      if (!validSecret || !token) return false;
      return safeEqual(token, validSecret);
    };

    // Blokir POST langsung dari luar domain resmi (anti-curl / anti-CSRF) kecuali admin ber-token sah
    if (request.method === "POST" && !isAllowedOrigin && !isAuthorized()) {
      return new Response(JSON.stringify({ success: false, error: "Forbidden: Origin tidak diizinkan." }), {
        status: 403,
        headers: { ...securityHeaders, "Content-Type": "application/json" }
      });
    }

    // Batasi ukuran payload POST maksimal 512 KB (kecuali /upload media R2)
    if (request.method === "POST" && url.pathname !== "/upload") {
      const contentLen = Number(request.headers.get("Content-Length") || 0);
      if (contentLen > 524288) {
        return new Response(JSON.stringify({ success: false, error: "Payload terlalu besar." }), {
          status: 413,
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }
    }

    try {
      const ensureTableExists = async () => {
        if (env.DB) {
          await env.DB.prepare(
            "CREATE TABLE IF NOT EXISTS catalog_store (id INTEGER PRIMARY KEY, data TEXT, updated_at TEXT)"
          ).run();
          await env.DB.prepare(
            "CREATE TABLE IF NOT EXISTS talent_accounts (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, name TEXT NOT NULL, agency TEXT, status TEXT, moods TEXT, avatar TEXT, updated_at TEXT)"
          ).run();
          await env.DB.prepare(
            "CREATE TABLE IF NOT EXISTS lounge_store (id INTEGER PRIMARY KEY, posts TEXT, stories TEXT, updated_at TEXT)"
          ).run();
          await env.DB.prepare(
            "CREATE TABLE IF NOT EXISTS orders_store (id TEXT PRIMARY KEY, customer_username TEXT, customer_name TEXT, service TEXT, amount INTEGER, voucher TEXT, note TEXT, status TEXT, created_at TEXT)"
          ).run();
        }
      };

      const hashPassword = async (plain) => {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("cn_salt_v1:" + String(plain)));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
      };

      // 1. Verifikasi Login Admin / PIN Menu Developer (Rate Limited: 5x / 10 menit)
      if (url.pathname === "/api/verify-auth" && request.method === "POST") {
        if (!checkRateLimit(clientIp, "admin_auth", 5, 600000)) {
          return new Response(JSON.stringify({ success: false, error: "Terlalu banyak percobaan. Coba lagi 10 menit." }), {
            status: 429,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!isAuthorized()) {
          await new Promise((r) => setTimeout(r, 1500));
          return new Response(JSON.stringify({ success: false, error: "PIN atau Token tidak valid!" }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        const adminSessionToken = await signSessionToken(env.ADMIN_SECRET_TOKEN, "superadmin", "superadmin");
        return new Response(JSON.stringify({ success: true, sessionToken: adminSessionToken }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 2. Ambil Data Katalog dari D1 (Publik Read-Only, Rate Limited)
      if (url.pathname === "/api/get" && request.method === "GET") {
        if (!checkRateLimit(clientIp, "catalog_get", 60, 60000)) {
          return new Response(JSON.stringify({ success: false, error: "Rate limit terlampaui." }), {
            status: 429,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const row = await env.DB.prepare("SELECT data FROM catalog_store WHERE id = 1").first();
        let storeData = { talents: [], banners: [], vouchers: [], favorites: [] };
        if (row && row.data) {
          try { storeData = JSON.parse(row.data); } catch (_) {}
        }
        return new Response(JSON.stringify({ success: true, data: storeData }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 3. Simpan Data Katalog ke D1 (Wajib Token Admin)
      if (url.pathname === "/api/save" && request.method === "POST") {
        if (!isAuthorized()) {
          return new Response(JSON.stringify({ success: false, error: "Akses ditolak: Token tidak sah" }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const body = await request.json();
        if (!body || typeof body !== "object" || !Array.isArray(body.talents)) {
          return new Response(JSON.stringify({ success: false, error: "Payload tidak valid" }), {
            status: 400,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        await env.DB.prepare(
          "INSERT INTO catalog_store (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
        ).bind(JSON.stringify(body), new Date().toISOString()).run();

        return new Response(JSON.stringify({ success: true, message: "Tersimpan aman di D1!" }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 4. Upload Foto & Video ke R2 (Wajib Token Admin)
      if (url.pathname === "/upload" && request.method === "POST") {
        if (!isAuthorized()) {
          return new Response(JSON.stringify({ success: false, message: "Akses upload ditolak: Token tidak sah" }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.BUCKET) throw new Error("Binding R2 (BUCKET) belum terpasang");
        const formData = await request.formData();
        const file = formData.get("file");
        const mediaType = formData.get("type") || "image";
        if (!file || typeof file === "string") {
          return new Response(JSON.stringify({ success: false, message: "File tidak ditemukan" }), {
            status: 400,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        const allowedMimes = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"];
        if (file.type && !allowedMimes.includes(file.type)) {
          return new Response(JSON.stringify({ success: false, message: "Format file dilarang demi keamanan!" }), {
            status: 415,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        const folder = mediaType === "video" ? "assets-video" : "assets-pict";
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const objectKey = folder + "/" + Date.now() + "_" + safeName;
        await env.BUCKET.put(objectKey, file.stream(), {
          httpMetadata: { contentType: file.type || (mediaType === "video" ? "video/mp4" : "image/jpeg") }
        });
        const publicDomain = (env.R2_PUBLIC_URL || "https://media-cn.my.id").replace(/\/$/, "");
        return new Response(JSON.stringify({ success: true, url: publicDomain + "/" + objectKey }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 5. Seed Akun Talent (Wajib Token Admin)
      if (url.pathname === "/api/talent/seed" && request.method === "POST") {
        if (!isAuthorized()) {
          return new Response(JSON.stringify({ success: false, error: "Akses ditolak: Token tidak sah" }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const body = await request.json();
        const list = Array.isArray(body && body.talents) ? body.talents : [];
        let count = 0;
        for (const item of list) {
          if (!item.username || !item.password || !item.name) continue;
          const uname = String(item.username).trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_]/g, "");
          if (!uname) continue;
          const pHash = await hashPassword(String(item.password).trim());
          await env.DB.prepare(
            "INSERT INTO talent_accounts (username, password_hash, name, agency, status, moods, avatar, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name, agency = excluded.agency, status = excluded.status, moods = excluded.moods, avatar = excluded.avatar, updated_at = excluded.updated_at"
          ).bind(
            uname,
            pHash,
            sanitizeText(item.name, 60),
            sanitizeText(item.agency || "Clubs'Night", 40),
            sanitizeText(item.status || "READY", 16),
            JSON.stringify(Array.isArray(item.moods) ? item.moods.slice(0, 6) : ["GFE"]),
            String(item.avatar || "").slice(0, 400),
            new Date().toISOString()
          ).run();
          count++;
        }
        return new Response(JSON.stringify({ success: true, seeded: count }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 6. Login Resmi Talent (Rate Limited: 6x / 10 menit + Mengembalikan HMAC Session Token)
      if (url.pathname === "/api/talent/login" && request.method === "POST") {
        if (!checkRateLimit(clientIp, "talent_login", 6, 600000)) {
          return new Response(JSON.stringify({ success: false, error: "Terlalu banyak percobaan login. Tunggu 10 menit." }), {
            status: 429,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const uname = String(body.username || "").trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_]/g, "");
        const pass = String(body.password || "").trim();
        if (!uname || !pass || pass.length > 64) {
          return new Response(JSON.stringify({ success: false, error: "Username dan password wajib diisi." }), {
            status: 400,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        const row = await env.DB.prepare(
          "SELECT username, password_hash, name, agency, status, moods, avatar FROM talent_accounts WHERE username = ?"
        ).bind(uname).first();

        if (!row) {
          return new Response(JSON.stringify({ success: false, notFound: true, error: "Akun tidak ditemukan." }), {
            status: 404,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const inputHash = await hashPassword(pass);
        if (!safeEqual(inputHash, row.password_hash)) {
          await new Promise((r) => setTimeout(r, 900));
          return new Response(JSON.stringify({ success: false, error: "Password talent salah." }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        let parsedMoods = ["GFE"];
        try { parsedMoods = JSON.parse(row.moods || "[]"); } catch (_) {}
        const sessionToken = await signSessionToken(env.ADMIN_SECRET_TOKEN, row.username, "talent");

        return new Response(JSON.stringify({
          success: true,
          sessionToken,
          user: {
            username: row.username,
            name: row.name,
            role: "talent",
            approved: true,
            agency: row.agency || "Clubs'Night",
            status: row.status || "READY",
            moods: parsedMoods,
            avatar: row.avatar || "",
            sessionToken
          }
        }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 7. Update Profil & Password Talent (Rate Limited + Verifikasi Password Lama)
      if (url.pathname === "/api/talent/update-profile" && request.method === "POST") {
        if (!checkRateLimit(clientIp, "talent_update", 8, 600000)) {
          return new Response(JSON.stringify({ success: false, error: "Terlalu banyak permintaan update." }), {
            status: 429,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const uname = String(body.username || "").trim().toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_]/g, "");
        const currentPass = String(body.currentPassword || "").trim();
        const newPass = String(body.newPassword || "").trim();
        const nextStatus = String(body.status || "").trim().toUpperCase();
        const nextMoods = Array.isArray(body.moods) ? body.moods.map((m) => sanitizeText(m, 24)).filter(Boolean).slice(0, 6) : null;

        if (!uname || !currentPass) {
          return new Response(JSON.stringify({ success: false, error: "Username dan password saat ini wajib diisi." }), {
            status: 400,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const row = await env.DB.prepare(
          "SELECT username, password_hash, name, agency, status, moods, avatar FROM talent_accounts WHERE username = ?"
        ).bind(uname).first();
        if (!row) {
          return new Response(JSON.stringify({ success: false, error: "Akun talent tidak ditemukan." }), {
            status: 404,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const curHash = await hashPassword(currentPass);
        if (!safeEqual(curHash, row.password_hash)) {
          await new Promise((r) => setTimeout(r, 900));
          return new Response(JSON.stringify({ success: false, error: "Password saat ini salah." }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        if (newPass && (newPass.length < 6 || newPass.length > 64)) {
          return new Response(JSON.stringify({ success: false, error: "Password baru harus 6-64 karakter." }), {
            status: 400,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const validStatuses = ["READY", "BUSY", "OFFLINE"];
        const finalStatus = validStatuses.includes(nextStatus) ? nextStatus : (row.status || "READY");
        const finalHash = newPass ? await hashPassword(newPass) : row.password_hash;

        let parsedMoods = ["GFE"];
        try { parsedMoods = JSON.parse(row.moods || "[]"); } catch (_) {}
        const finalMoods = (nextMoods && nextMoods.length) ? nextMoods : parsedMoods;

        await env.DB.prepare(
          "UPDATE talent_accounts SET password_hash = ?, status = ?, moods = ?, updated_at = ? WHERE username = ?"
        ).bind(finalHash, finalStatus, JSON.stringify(finalMoods), new Date().toISOString(), uname).run();

        try {
          const catRow = await env.DB.prepare("SELECT data FROM catalog_store WHERE id = 1").first();
          if (catRow && catRow.data) {
            const storeData = JSON.parse(catRow.data);
            if (Array.isArray(storeData.talents)) {
              let changed = false;
              storeData.talents = storeData.talents.map((t) => {
                const tSlug = String(t.name || "").toLowerCase().replace(/[^\w\s]/g, "").trim().replace(/\s+/g, "_");
                if (tSlug === uname || String(t.name || "").toLowerCase() === String(row.name || "").toLowerCase()) {
                  changed = true;
                  return { ...t, status: finalStatus.toLowerCase(), vibe: finalMoods };
                }
                return t;
              });
              if (changed) {
                await env.DB.prepare("UPDATE catalog_store SET data = ?, updated_at = ? WHERE id = 1")
                  .bind(JSON.stringify(storeData), new Date().toISOString()).run();
              }
            }
          }
        } catch (_) {}

        const sessionToken = await signSessionToken(env.ADMIN_SECRET_TOKEN, row.username, "talent");
        return new Response(JSON.stringify({
          success: true,
          message: newPass ? "Password & profil talent berhasil diperbarui!" : "Status & profil talent berhasil diperbarui!",
          user: {
            username: row.username,
            name: row.name,
            role: "talent",
            approved: true,
            agency: row.agency || "Clubs'Night",
            status: finalStatus,
            moods: finalMoods,
            avatar: row.avatar || "",
            sessionToken
          }
        }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 8. Ambil Postingan & Story Lounge dari D1
      if (url.pathname === "/api/lounge/get" && request.method === "GET") {
        if (!checkRateLimit(clientIp, "lounge_get", 80, 60000)) {
          return new Response(JSON.stringify({ success: false, error: "Rate limit terlampaui." }), {
            status: 429,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const row = await env.DB.prepare("SELECT posts, stories, updated_at FROM lounge_store WHERE id = 1").first();
        let posts = [];
        let stories = [];
        if (row) {
          try { posts = JSON.parse(row.posts || "[]"); } catch (_) {}
          try { stories = JSON.parse(row.stories || "[]"); } catch (_) {}
        }
        const now = Date.now();
        const activeStories = Array.isArray(stories)
          ? stories.filter((st) => !st.createdAt || (now - Number(st.createdAt)) < 86400000)
          : [];

        return new Response(JSON.stringify({
          success: true,
          posts: Array.isArray(posts) ? posts : [],
          stories: activeStories,
          updatedAt: row ? row.updated_at : null
        }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 9. Simpan Postingan & Story Lounge (Wajib Origin Resmi + Rate Limit + Anti-Wipe Protection)
      if (url.pathname === "/api/lounge/save" && request.method === "POST") {
        if (!checkRateLimit(clientIp, "lounge_save", 20, 60000)) {
          return new Response(JSON.stringify({ success: false, error: "Terlalu cepat. Tunggu sebentar." }), {
            status: 429,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const actor = body && body.actor;
        const sessTok = request.headers.get("X-Session-Token") || (actor && actor.sessionToken) || "";
        const verifiedActor = await verifySessionToken(env.ADMIN_SECRET_TOKEN, sessTok);

        if ((!actor || !actor.username) && !verifiedActor && !isAuthorized()) {
          return new Response(JSON.stringify({ success: false, error: "Sesi tidak sah." }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const row = await env.DB.prepare("SELECT posts, stories FROM lounge_store WHERE id = 1").first();
        let curPosts = [];
        let curStories = [];
        if (row) {
          try { curPosts = JSON.parse(row.posts || "[]"); } catch (_) {}
          try { curStories = JSON.parse(row.stories || "[]"); } catch (_) {}
        }

        // Cegah penghapusan massal seluruh postingan sekaligus oleh non-admin
        const incomingPosts = Array.isArray(body.posts) ? body.posts.slice(0, 120) : curPosts;
        if (curPosts.length > 1 && incomingPosts.length === 0 && !isAuthorized() && !(verifiedActor && verifiedActor.role === "superadmin")) {
          return new Response(JSON.stringify({ success: false, error: "Penghapusan massal ditolak." }), {
            status: 403,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const now = Date.now();
        const rawStories = Array.isArray(body.stories) ? body.stories : curStories;
        const nextStories = rawStories
          .filter((st) => !st.createdAt || (now - Number(st.createdAt)) < 86400000)
          .slice(0, 60);

        await env.DB.prepare(
          "INSERT INTO lounge_store (id, posts, stories, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET posts = excluded.posts, stories = excluded.stories, updated_at = excluded.updated_at"
        ).bind(JSON.stringify(incomingPosts), JSON.stringify(nextStories), new Date().toISOString()).run();

        return new Response(JSON.stringify({ success: true, countPosts: incomingPosts.length, countStories: nextStories.length }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 10. Buat Order Baru (Rate Limited: 5 order / 10 menit per IP + Sanitasi XSS)
      if (url.pathname === "/api/orders/create" && request.method === "POST") {
        if (!checkRateLimit(clientIp, "order_create", 5, 600000)) {
          return new Response(JSON.stringify({ success: false, error: "Batas pembuatan order tercapai. Coba lagi nanti." }), {
            status: 429,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const orderId = sanitizeText(body.id || ("ORD-" + Math.floor(100000 + Math.random() * 900000)), 32);
        const custUser = sanitizeText(body.customerUsername || "guest", 40);
        const custName = sanitizeText(body.customerName || "VIP Member", 60);
        const service = sanitizeText(body.service || "", 160);
        const amount = Math.max(0, Math.min(100000000, Number(body.amount || 0) || 0));
        const voucher = sanitizeText(body.voucher || "-", 32);
        const note = sanitizeText(body.note || "", 300);
        const status = sanitizeText(body.status || "Menunggu Konfirmasi", 40);
        const createdAt = new Date().toISOString();

        if (!service) {
          return new Response(JSON.stringify({ success: false, error: "Detail layanan/produk wajib diisi." }), {
            status: 400,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        await env.DB.prepare(
          "INSERT INTO orders_store (id, customer_username, customer_name, service, amount, voucher, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status"
        ).bind(orderId, custUser, custName, service, amount, voucher, note, status, createdAt).run();

        let telegramSent = false;
        if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_CHAT_ID) {
          const textLines = [
            "🔔 <b>ORDER BARU — CLUBS' NIGHT</b>",
            "",
            "🆔 <b>ID Order:</b> <code>" + orderId + "</code>",
            "👤 <b>Member:</b> " + custName + " (@" + custUser.replace(/^@/, "") + ")",
            "✨ <b>Layanan:</b> " + service,
            amount > 0 ? ("💰 <b>Nominal:</b> Rp " + amount.toLocaleString("id-ID")) : "",
            voucher && voucher !== "-" ? ("🎟️ <b>Voucher:</b> " + voucher) : "",
            note ? ("📝 <b>Catatan:</b> " + note) : "",
            "📌 <b>Status:</b> " + status
          ].filter(Boolean).join("\n");

          try {
            const tgRes = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: env.TELEGRAM_ADMIN_CHAT_ID,
                text: textLines,
                parse_mode: "HTML"
              })
            });
            telegramSent = tgRes.ok;
          } catch (_) {}
        }

        return new Response(JSON.stringify({ success: true, orderId, telegramSent }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 11. Daftar Semua Order (Wajib Token Admin)
      if (url.pathname === "/api/orders/list" && request.method === "GET") {
        if (!isAuthorized()) {
          return new Response(JSON.stringify({ success: false, error: "Akses ditolak: Token tidak sah" }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const res = await env.DB.prepare(
          "SELECT id, customer_username, customer_name, service, amount, voucher, note, status, created_at FROM orders_store ORDER BY created_at DESC LIMIT 200"
        ).all();
        return new Response(JSON.stringify({
          success: true,
          orders: (res && res.results) ? res.results : []
        }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response("Not Found", { status: 404, headers: securityHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: "Internal Server Error" }), {
        status: 500,
        headers: { ...securityHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
