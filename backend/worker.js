const ipRateMap = new Map();

function checkMemoryRate(ip, bucket, maxHits, windowMs) {
  const key = bucket + ":" + ip;
  const now = Date.now();
  let entry = ipRateMap.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  entry.count += 1;
  ipRateMap.set(key, entry);
  if (ipRateMap.size > 4000) {
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

function stripDangerousKeys(obj, depth = 0) {
  if (depth > 6 || obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((item) => stripDangerousKeys(item, depth + 1));
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    clean[k] = stripDangerousKeys(v, depth + 1);
  }
  return clean;
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

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  const clean = String(hex || "").replace(/[^0-9a-f]/gi, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

// PBKDF2-HMAC-SHA256 (100.000 iterasi + 16-byte Random Salt unik per akun)
async function hashPasswordPBKDF2(plain, saltHexOpt) {
  const saltBytes = saltHexOpt ? fromHex(saltHexOpt) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(plain)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );
  return "pbkdf2_v1$" + toHex(saltBytes) + "$" + toHex(derivedBits);
}

// Legacy SHA-256 verifier untuk migrasi otomatis tanpa memutus akun yang sudah ada
async function hashLegacySHA256(plain) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("cn_salt_v1:" + String(plain)));
  return toHex(buf);
}

async function verifyPassword(plain, storedHash) {
  const stored = String(storedHash || "");
  if (stored.startsWith("pbkdf2_v1$")) {
    const parts = stored.split("$");
    if (parts.length !== 3) return { valid: false, needsUpgrade: false };
    const candidate = await hashPasswordPBKDF2(plain, parts[1]);
    return { valid: safeEqual(candidate, stored), needsUpgrade: false };
  }
  const legacyCandidate = await hashLegacySHA256(plain);
  const ok = safeEqual(legacyCandidate, stored);
  return { valid: ok, needsUpgrade: ok };
}

async function signSessionToken(secret, username, role, tokenVersion = 1, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  if (!secret) throw new Error("ADMIN_SECRET_TOKEN belum dikonfigurasi");
  const exp = Date.now() + ttlMs;
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(8)));
  const payload = username + ":" + role + ":" + tokenVersion + ":" + exp + ":" + nonce;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("cn_hmac_v3:" + secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(payload) + "." + toHex(sigBuf);
}

async function verifySessionToken(secret, token) {
  try {
    if (!secret) return null;
    const parts = String(token || "").split(".");
    if (parts.length !== 2) return null;
    const payload = atob(parts[0]);
    const [username, role, verStr, expStr] = payload.split(":");
    if (!username || !role || Number(expStr) < Date.now()) return null;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("cn_hmac_v3:" + secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    if (!safeEqual(parts[1], toHex(sigBuf))) return null;
    return { username, role, tokenVersion: Number(verStr || 1) };
  } catch (_) {
    return null;
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      fetch(`${env.ELIXIR_API_URL}/api/health`, {
        method: "GET",
        headers: { "User-Agent": "ClubsNight-KeepAlive/1.0" }
      }).catch(() => null)
    );
  },

  async fetch(request, env, ctx) {
    const allowedOrigins = [
      "https://clubsnight.my.id",
      "https://www.clubsnight.my.id",
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "https://clubsnight.my.id",
  "https://clubsnight-id.pages.dev",
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
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Cache-Control": "no-store, no-cache, must-revalidate",
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

    // Wajib Origin resmi untuk seluruh POST (kecuali admin dengan Bearer Token sah)
    
    if (url.pathname.startsWith("/r2/") && request.method === "GET") {
      if (!env.BUCKET) return new Response("Storage unavailable", { status: 503, headers: securityHeaders });
      const safeKey = extractSafeR2Key(url.origin + url.pathname, env, url.origin);
      if (!safeKey) return new Response("Forbidden", { status: 403, headers: securityHeaders });
      const obj = await env.BUCKET.get(safeKey);
      if (!obj) return new Response("Not Found", { status: 404, headers: securityHeaders });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("etag", obj.httpEtag);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(obj.body, { headers });
    }

    if (request.method === "POST" && url.pathname !== "/api/webhook/saweria" && !isAllowedOrigin && !isAuthorized()) {
      return new Response(JSON.stringify({ success: false, error: "Forbidden: Origin tidak diizinkan." }), {
        status: 403,
        headers: { ...securityHeaders, "Content-Type": "application/json" }
      });
    }

    // Batasi ukuran payload POST maksimal 512 KB (kecuali /upload R2)
    if (request.method === "POST" && url.pathname !== "/upload") {
      const contentLen = Number(request.headers.get("Content-Length") || 0);
      const maxPayload = url.pathname === "/api/media/upload" ? 3670016 : 524288;
      if (contentLen > maxPayload) {
        return new Response(JSON.stringify({ success: false, error: "Payload terlalu besar." }), {
          status: 413,
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }
    }

    try {
      const ensureTableExists = async () => {
        if (!env.DB) return;
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS catalog_store (id INTEGER PRIMARY KEY, data TEXT, updated_at TEXT)"
        ).run();
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS talent_accounts (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, name TEXT NOT NULL, agency TEXT, status TEXT, moods TEXT, avatar TEXT, token_version INTEGER DEFAULT 1, updated_at TEXT)"
        ).run();
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS lounge_store (id INTEGER PRIMARY KEY, posts TEXT, stories TEXT, updated_at TEXT)"
        ).run();
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS user_profiles (username TEXT PRIMARY KEY, name TEXT NOT NULL, bio TEXT DEFAULT '', avatar TEXT DEFAULT '', updated_at TEXT)"
        ).run();
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS orders_store (id TEXT PRIMARY KEY, customer_username TEXT, customer_name TEXT, service TEXT, amount INTEGER, voucher TEXT, note TEXT, status TEXT, created_at TEXT)"
        ).run();
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS wallet_balances (username TEXT PRIMARY KEY, balance INTEGER DEFAULT 0, updated_at TEXT)"
        ).run();
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS qris_intents (id TEXT PRIMARY KEY, username TEXT NOT NULL, base_amount INTEGER NOT NULL, unique_code INTEGER NOT NULL, total_amount INTEGER NOT NULL, mode TEXT, service TEXT, status TEXT DEFAULT 'PENDING', expires_at INTEGER, created_at TEXT)"
        ).run();
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS auth_lockouts (ip_key TEXT PRIMARY KEY, fails INTEGER DEFAULT 0, locked_until INTEGER DEFAULT 0)"
        ).run();
        try {
          await env.DB.prepare("ALTER TABLE talent_accounts ADD COLUMN token_version INTEGER DEFAULT 1").run();
        } catch (_) {}
      };

      // Persistent D1 Brute-Force Lockout (Global di seluruh edge Cloudflare)
      const checkPersistentLockout = async (bucket) => {
        if (!env.DB) return { locked: false };
        await ensureTableExists();
        const ipKey = bucket + ":" + clientIp;
        const row = await env.DB.prepare("SELECT fails, locked_until FROM auth_lockouts WHERE ip_key = ?").bind(ipKey).first();
        if (row && Number(row.locked_until || 0) > Date.now()) {
          return { locked: true, retryAfterSec: Math.ceil((Number(row.locked_until) - Date.now()) / 1000) };
        }
        return { locked: false };
      };

      const recordAuthFailure = async (bucket) => {
        if (!env.DB) return;
        const ipKey = bucket + ":" + clientIp;
        const row = await env.DB.prepare("SELECT fails FROM auth_lockouts WHERE ip_key = ?").bind(ipKey).first();
        const nextFails = (row ? Number(row.fails || 0) : 0) + 1;
        const lockUntil = nextFails >= 5 ? (Date.now() + 15 * 60 * 1000) : 0;
        await env.DB.prepare(
          "INSERT INTO auth_lockouts (ip_key, fails, locked_until) VALUES (?, ?, ?) ON CONFLICT(ip_key) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until"
        ).bind(ipKey, nextFails >= 5 ? 0 : nextFails, lockUntil).run();
      };

      const clearAuthFailure = async (bucket) => {
        if (!env.DB) return;
        await env.DB.prepare("DELETE FROM auth_lockouts WHERE ip_key = ?").bind(bucket + ":" + clientIp).run();
      };

      // 0. Terbitkan Guest Session Token berjangka pendek (untuk member/tamu yang membuat order atau komentar)
      
      const jsonOut = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...securityHeaders, "Content-Type": "application/json" } });

      if (url.pathname === "/api/media/upload" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "media_upload", 20, 6e5)) return jsonOut({ success: false, error: "Terlalu banyak upload." }, 429);
        if (!env.BUCKET) return jsonOut({ success: false, error: "Binding R2 (BUCKET) belum terpasang." }, 500);
        const body = stripDangerousKeys(await request.json().catch(() => ({})));
        const mimeMatch = String(body.image || "").match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
        if (!mimeMatch) return jsonOut({ success: false, error: "Format gambar tidak valid." }, 400);
        const mime = mimeMatch[1] === "image/jpg" ? "image/jpeg" : mimeMatch[1];
        const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
        const binary = Uint8Array.from(atob(mimeMatch[2].replace(/\s+/g, "")), (c) => c.charCodeAt(0));
        if (binary.byteLength > 2621440) return jsonOut({ success: false, error: "Ukuran gambar maksimal 2.5 MB." }, 413);
        const folder = ["stories", "avatars", "lounge"].includes(body.folder) ? body.folder : "stories";
        const vActor = await verifySessionToken(env.ADMIN_SECRET_TOKEN, request.headers.get("X-Session-Token") || "");
        const safeUser = normalizeUsername((vActor && vActor.username) || body.username || "user") || "user";
        const key = folder + "/" + safeUser + "_" + Date.now() + "_" + toHex(crypto.getRandomValues(new Uint8Array(4))) + "." + ext;
        await env.BUCKET.put(key, binary, { httpMetadata: { contentType: mime } });
        return jsonOut({ success: true, key, url: url.origin + "/r2/" + key });
      }

      if (url.pathname === "/api/lounge/story/create" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "story_create", 12, 6e5)) return jsonOut({ success: false, error: "Terlalu banyak upload story." }, 429);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 500);
        await ensureTableExists();
        const body = stripDangerousKeys(await request.json().catch(() => ({})));
        const vActor = await verifySessionToken(env.ADMIN_SECRET_TOKEN, request.headers.get("X-Session-Token") || "");
        if (!vActor && !isAuthorized()) return jsonOut({ success: false, error: "Unauthorized: Sesi tidak valid." }, 401);
        const ownerUsername = normalizeUsername(vActor ? vActor.username : body.ownerUsername);
        const image = String(body.image || "").trim();
        if (!ownerUsername || !image || (!image.startsWith("https://") && !image.startsWith("data:image/"))) return jsonOut({ success: false, error: "Data story tidak valid." }, 400);
        const row = await env.DB.prepare("SELECT posts, stories FROM lounge_store WHERE id = 1").first();
        let curPosts = [], curStories = [];
        if (row) { try { curPosts = JSON.parse(row.posts || "[]"); } catch (_) {} try { curStories = JSON.parse(row.stories || "[]"); } catch (_) {} }
        const now = Date.now();
        const active = (Array.isArray(curStories) ? curStories : []).filter((st) => st && (!st.createdAt || now - Number(st.createdAt) < 864e5));
        const todayKey = new Date(now + 7 * 3600 * 1e3).toISOString().slice(0, 10);
        const ownCount = active.filter((st) => normalizeUsername(st.ownerUsername) === ownerUsername && (st.dateKey === todayKey || now - Number(st.createdAt || 0) < 864e5)).length;
        if (ownCount >= 3 && !isAuthorized()) return jsonOut({ success: false, error: "Kuota harian maksimal 3 story." }, 429);
        const newStory = { id: sanitizeText(body.id || "ust_" + now, 64), ownerUsername, ownerName: sanitizeText(body.ownerName || ownerUsername, 60), color: "#ff2a5f", image: image.slice(0, 200000), caption: sanitizeText(body.caption || "", 180), createdAt: now, dateKey: todayKey };
        const nextStories = [...active, newStory].slice(-60);
        await env.DB.prepare("INSERT INTO lounge_store (id, posts, stories, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET stories = excluded.stories, updated_at = excluded.updated_at").bind(JSON.stringify(curPosts), JSON.stringify(nextStories), new Date(now).toISOString()).run();
        return jsonOut({ success: true, story: newStory, countStories: nextStories.length });
      }

      if (url.pathname === "/api/lounge/story/delete" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "story_delete", 20, 6e5)) return jsonOut({ success: false, error: "Terlalu banyak permintaan." }, 429);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 500);
        await ensureTableExists();
        const body = stripDangerousKeys(await request.json().catch(() => ({})));
        const vActor = await verifySessionToken(env.ADMIN_SECRET_TOKEN, request.headers.get("X-Session-Token") || "");
        if (!vActor && !isAuthorized()) return jsonOut({ success: false, error: "Unauthorized: Sesi tidak valid." }, 401);
        const actorUsername = normalizeUsername(vActor ? vActor.username : body.ownerUsername);
        const targetId = sanitizeText(body.id || "", 80);
        if (!targetId || !actorUsername) return jsonOut({ success: false, error: "ID story dan pemilik wajib diisi." }, 400);
        const row = await env.DB.prepare("SELECT posts, stories FROM lounge_store WHERE id = 1").first();
        let curPosts = [], curStories = [];
        if (row) { try { curPosts = JSON.parse(row.posts || "[]"); } catch (_) {} try { curStories = JSON.parse(row.stories || "[]"); } catch (_) {} }
        const matched = curStories.find((st) => st && String(st.id) === targetId);
        if (!matched) return jsonOut({ success: true, deletedId: targetId, note: "Story sudah terhapus." });
        if (normalizeUsername(matched.ownerUsername) !== actorUsername) return jsonOut({ success: false, error: "Forbidden: Hanya bisa menghapus story milik sendiri." }, 403);
        let r2Deleted = false;
        if (env.BUCKET && matched.image) {
          const safeKey = extractSafeR2Key(matched.image, env, url.origin);
          if (safeKey && safeKey.startsWith("stories/")) { try { await env.BUCKET.delete(safeKey); r2Deleted = true; } catch (_) {} }
        }
        const nextStories = curStories.filter((st) => st && String(st.id) !== targetId);
        await env.DB.prepare("INSERT INTO lounge_store (id, posts, stories, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET stories = excluded.stories, updated_at = excluded.updated_at").bind(JSON.stringify(curPosts), JSON.stringify(nextStories), new Date().toISOString()).run();
        return jsonOut({ success: true, deletedId: targetId, r2Deleted, remainingStories: nextStories.length });
      }

      if (url.pathname === "/api/profile/update" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "profile_update", 15, 6e5)) return jsonOut({ success: false, error: "Terlalu banyak update profil." }, 429);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 500);
        await ensureTableExists();
        const body = stripDangerousKeys(await request.json().catch(() => ({})));
        const vActor = await verifySessionToken(env.ADMIN_SECRET_TOKEN, request.headers.get("X-Session-Token") || "");
        if (!vActor && !isAuthorized()) return jsonOut({ success: false, error: "Unauthorized: Sesi tidak valid." }, 401);
        const requestedUsername = normalizeUsername(body.username);
        const username = normalizeUsername(vActor ? vActor.username : requestedUsername);
        if (requestedUsername && requestedUsername !== username && !isAuthorized()) return jsonOut({ success: false, error: "Forbidden: Identitas profil tidak cocok." }, 403);
        const name = sanitizeText(body.name || "", 50);
        const bio = sanitizeText(body.bio || "", 200);
        const avatar = String(body.avatar || "").trim().slice(0, 200000);
        if (!username || !name) return jsonOut({ success: false, error: "Username dan nama wajib diisi." }, 400);
        const prev = await env.DB.prepare("SELECT avatar FROM user_profiles WHERE username = ?").bind(username).first();
        if (env.BUCKET && prev && prev.avatar && avatar && prev.avatar !== avatar) {
          const oldKey = extractSafeR2Key(prev.avatar, env, url.origin);
          if (oldKey && oldKey.startsWith("avatars/")) { try { await env.BUCKET.delete(oldKey); } catch (_) {} }
        }
        const nowIso = new Date().toISOString();
        await env.DB.prepare("INSERT INTO user_profiles (username, name, bio, avatar, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(username) DO UPDATE SET name = excluded.name, bio = excluded.bio, avatar = CASE WHEN excluded.avatar != '' THEN excluded.avatar ELSE user_profiles.avatar END, updated_at = excluded.updated_at").bind(username, name, bio, avatar, nowIso).run();
        try { await env.DB.prepare("UPDATE talent_accounts SET name = ?, avatar = CASE WHEN ? != '' THEN ? ELSE avatar END, updated_at = ? WHERE username = ?").bind(name, avatar, avatar, nowIso, username).run(); } catch (_) {}
        return jsonOut({ success: true, profile: { username, name, bio, avatar: avatar || (prev && prev.avatar) || "", updatedAt: nowIso } });
      }

      if (url.pathname === "/api/profile/get" && request.method === "GET") {
        if (!checkMemoryRate(clientIp, "profile_get", 80, 6e4)) return jsonOut({ success: false, error: "Rate limit terlampaui." }, 429);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 500);
        await ensureTableExists();
        const uname = normalizeUsername(url.searchParams.get("username") || "");
        if (!uname) return jsonOut({ success: false, error: "Username wajib diisi." }, 400);
        const prof = await env.DB.prepare("SELECT username, name, bio, avatar FROM user_profiles WHERE username = ?").bind(uname).first();
        const talent = await env.DB.prepare("SELECT username, name, agency, status, moods, avatar FROM talent_accounts WHERE username = ?").bind(uname).first();
        if (!prof && !talent) return jsonOut({ success: false, notFound: true, error: "Profil tidak ditemukan." }, 404);
        let moods = []; try { moods = talent && talent.moods ? JSON.parse(talent.moods) : []; } catch (_) {}
        return jsonOut({ success: true, profile: { username: uname, name: (prof && prof.name) || (talent && talent.name) || uname, bio: (prof && prof.bio) || "", avatar: (prof && prof.avatar) || (talent && talent.avatar) || "", role: talent ? "talent" : "member", agency: (talent && talent.agency) || "", status: (talent && talent.status) || "", moods } });
      }

      if (url.pathname === "/api/session/guest" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "guest_tok", 15, 600000)) {
          return new Response(JSON.stringify({ success: false, error: "Terlalu banyak permintaan sesi." }), {
            status: 429,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        const body = await request.json().catch(() => ({}));
        const rawUser = sanitizeText(body.username || ("vip_" + Math.floor(1000 + Math.random() * 9000)), 32).replace(/[^a-zA-Z0-9_]/g, "");
        const guestToken = await signSessionToken(env.ADMIN_SECRET_TOKEN, rawUser || "vip_guest", "member", 1, 24 * 60 * 60 * 1000);
        return new Response(JSON.stringify({ success: true, sessionToken: guestToken }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 1. Verifikasi Login Admin / PIN Developer (PBKDF2-grade Lockout D1)
      if (url.pathname === "/api/verify-auth" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "admin_auth", 6, 600000)) {
          return new Response(JSON.stringify({ success: false, error: "Terlalu banyak percobaan. Coba lagi nanti." }), {
            status: 429,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        const lock = await checkPersistentLockout("admin_auth");
        if (lock.locked) {
          return new Response(JSON.stringify({ success: false, error: "IP dikunci sementara (" + lock.retryAfterSec + "d) karena gagal berulang." }), {
            status: 429,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!isAuthorized()) {
          await recordAuthFailure("admin_auth");
          await new Promise((r) => setTimeout(r, 1500));
          return new Response(JSON.stringify({ success: false, error: "PIN atau Token tidak valid!" }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        await clearAuthFailure("admin_auth");
        const adminSessionToken = await signSessionToken(env.ADMIN_SECRET_TOKEN, "superadmin", "superadmin", 1);
        return new Response(JSON.stringify({ success: true, sessionToken: adminSessionToken }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 2. Ambil Data Katalog dari D1 (Publik Read-Only)
      if (url.pathname === "/api/get" && request.method === "GET") {
        if (!checkMemoryRate(clientIp, "catalog_get", 60, 60000)) {
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

      // 3. Simpan Data Katalog ke D1 (Wajib Token Admin + Sanitasi Prototype Pollution)
      if (url.pathname === "/api/save" && request.method === "POST") {
        if (!isAuthorized()) {
          return new Response(JSON.stringify({ success: false, error: "Akses ditolak: Token tidak sah" }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const rawBody = await request.json();
        const body = stripDangerousKeys(rawBody);
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

      // 4. Upload Media ke R2 (Wajib Token Admin)
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

      // 5. Seed Akun Talent dengan PBKDF2-SHA256 100.000 iterasi (Wajib Token Admin)
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
          const pHash = await hashPasswordPBKDF2(String(item.password).trim());
          await env.DB.prepare(
            "INSERT INTO talent_accounts (username, password_hash, name, agency, status, moods, avatar, token_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, name = excluded.name, agency = excluded.agency, status = excluded.status, moods = excluded.moods, avatar = excluded.avatar, updated_at = excluded.updated_at"
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
        return new Response(JSON.stringify({ success: true, seeded: count, algo: "PBKDF2-SHA256-100k" }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 6. Login Resmi Talent (PBKDF2 + Auto-Upgrade Hash Lama + D1 Persistent Lockout)
      if (url.pathname === "/api/talent/login" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "talent_login", 8, 600000)) {
          return new Response(JSON.stringify({ success: false, error: "Terlalu banyak percobaan login. Tunggu 10 menit." }), {
            status: 429,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        const lock = await checkPersistentLockout("talent_login");
        if (lock.locked) {
          return new Response(JSON.stringify({ success: false, error: "Akses dikunci sementara (" + lock.retryAfterSec + "d) karena gagal berulang." }), {
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
          "SELECT username, password_hash, name, agency, status, moods, avatar, token_version FROM talent_accounts WHERE username = ?"
        ).bind(uname).first();

        if (!row) {
          await recordAuthFailure("talent_login");
          return new Response(JSON.stringify({ success: false, notFound: true, error: "Akun tidak ditemukan." }), {
            status: 404,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const check = await verifyPassword(pass, row.password_hash);
        if (!check.valid) {
          await recordAuthFailure("talent_login");
          await new Promise((r) => setTimeout(r, 1000));
          return new Response(JSON.stringify({ success: false, error: "Password talent salah." }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        await clearAuthFailure("talent_login");

        // Auto-upgrade hash SHA-256 lama ke PBKDF2-SHA256 100.000 iterasi + Random Salt secara transparan
        if (check.needsUpgrade) {
          const upgradedHash = await hashPasswordPBKDF2(pass);
          await env.DB.prepare("UPDATE talent_accounts SET password_hash = ?, updated_at = ? WHERE username = ?")
            .bind(upgradedHash, new Date().toISOString(), uname).run();
        }

        let parsedMoods = ["GFE"];
        try { parsedMoods = JSON.parse(row.moods || "[]"); } catch (_) {}
        const tokVer = Number(row.token_version || 1);
        const sessionToken = await signSessionToken(env.ADMIN_SECRET_TOKEN, row.username, "talent", tokVer);

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

      // 7. Update Profil & Password Talent (PBKDF2 + Token Version Revocation)
      if (url.pathname === "/api/talent/update-profile" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "talent_update", 8, 600000)) {
          return new Response(JSON.stringify({ success: false, error: "Terlalu banyak permintaan update." }), {
            status: 429,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        const sessTok = request.headers.get("X-Session-Token") || "";
        const verifiedActor = await verifySessionToken(env.ADMIN_SECRET_TOKEN, sessTok);
        if (!verifiedActor && !isAuthorized()) {
          return jsonOut({ success: false, error: "Unauthorized: Sesi talent tidak valid." }, 401);
        }
        const lock = await checkPersistentLockout("talent_update");
        if (lock.locked) {
          return new Response(JSON.stringify({ success: false, error: "Akses dikunci sementara (" + lock.retryAfterSec + "d)." }), {
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
        if (verifiedActor && verifiedActor.role === "talent" && verifiedActor.username !== uname) {
          return new Response(JSON.stringify({ success: false, error: "Forbidden: Identitas talent tidak cocok." }), {
            status: 403,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const row = await env.DB.prepare(
          "SELECT username, password_hash, name, agency, status, moods, avatar, token_version FROM talent_accounts WHERE username = ?"
        ).bind(uname).first();
        if (!row) {
          return new Response(JSON.stringify({ success: false, error: "Akun talent tidak ditemukan." }), {
            status: 404,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (verifiedActor && verifiedActor.role === "talent" &&
            Number(row.token_version || 1) !== verifiedActor.tokenVersion) {
          return new Response(JSON.stringify({ success: false, error: "Sesi kedaluwarsa. Silakan login ulang." }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const check = await verifyPassword(currentPass, row.password_hash);
        if (!check.valid) {
          await recordAuthFailure("talent_update");
          await new Promise((r) => setTimeout(r, 1000));
          return new Response(JSON.stringify({ success: false, error: "Password saat ini salah." }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        await clearAuthFailure("talent_update");

        if (newPass && (newPass.length < 6 || newPass.length > 64)) {
          return new Response(JSON.stringify({ success: false, error: "Password baru harus 6-64 karakter." }), {
            status: 400,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const validStatuses = ["READY", "BUSY", "OFFLINE"];
        const finalStatus = validStatuses.includes(nextStatus) ? nextStatus : (row.status || "READY");
        const finalHash = newPass
          ? await hashPasswordPBKDF2(newPass)
          : (check.needsUpgrade ? await hashPasswordPBKDF2(currentPass) : row.password_hash);

        // Naikkan token_version jika ganti password agar sesi di perangkat lain otomatis hangus
        const nextTokVer = Number(row.token_version || 1) + (newPass ? 1 : 0);

        let parsedMoods = ["GFE"];
        try { parsedMoods = JSON.parse(row.moods || "[]"); } catch (_) {}
        const finalMoods = (nextMoods && nextMoods.length) ? nextMoods : parsedMoods;

        await env.DB.prepare(
          "UPDATE talent_accounts SET password_hash = ?, status = ?, moods = ?, token_version = ?, updated_at = ? WHERE username = ?"
        ).bind(finalHash, finalStatus, JSON.stringify(finalMoods), nextTokVer, new Date().toISOString(), uname).run();

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

        const sessionToken = await signSessionToken(env.ADMIN_SECRET_TOKEN, row.username, "talent", nextTokVer);
        return new Response(JSON.stringify({
          success: true,
          message: newPass ? "Password & profil talent berhasil diperbarui (PBKDF2)!" : "Status & profil talent berhasil diperbarui!",
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
        if (!checkMemoryRate(clientIp, "lounge_get", 80, 60000)) {
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

      // 9. Simpan Postingan & Story Lounge (WAJIB HMAC X-Session-Token Valid + Anti-Wipe)
      if (url.pathname === "/api/lounge/save" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "lounge_save", 20, 60000)) {
          return new Response(JSON.stringify({ success: false, error: "Terlalu cepat. Tunggu sebentar." }), {
            status: 429,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const rawBody = await request.json().catch(() => ({}));
        const body = stripDangerousKeys(rawBody);
        const sessTok = request.headers.get("X-Session-Token") || (body && body.actor && body.actor.sessionToken) || "";
        const verifiedActor = await verifySessionToken(env.ADMIN_SECRET_TOKEN, sessTok);

        if (!verifiedActor && !isAuthorized()) {
          return new Response(JSON.stringify({ success: false, error: "Unauthorized: Token sesi HMAC tidak valid." }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        // Jika token milik talent, pastikan token_version masih cocok dengan D1 (belum di-revoke)
        if (verifiedActor && verifiedActor.role === "talent") {
          const tRow = await env.DB.prepare("SELECT token_version FROM talent_accounts WHERE username = ?")
            .bind(verifiedActor.username).first();
          if (!tRow || Number(tRow.token_version || 1) !== verifiedActor.tokenVersion) {
            return new Response(JSON.stringify({ success: false, error: "Sesi kedaluwarsa. Silakan login ulang." }), {
              status: 401,
              headers: { ...securityHeaders, "Content-Type": "application/json" }
            });
          }
        }

        const row = await env.DB.prepare("SELECT posts, stories FROM lounge_store WHERE id = 1").first();
        let curPosts = [];
        let curStories = [];
        if (row) {
          try { curPosts = JSON.parse(row.posts || "[]"); } catch (_) {}
          try { curStories = JSON.parse(row.stories || "[]"); } catch (_) {}
        }

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

      // 10. Buat Order Baru (WAJIB HMAC X-Session-Token Valid + Rate Limit + Sanitasi XSS)
      if (url.pathname === "/api/orders/create" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "order_create", 5, 600000)) {
          return new Response(JSON.stringify({ success: false, error: "Batas pembuatan order tercapai. Coba lagi nanti." }), {
            status: 429,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        const sessTok = request.headers.get("X-Session-Token") || "";
        const verifiedActor = await verifySessionToken(env.ADMIN_SECRET_TOKEN, sessTok);
        if (!verifiedActor && !isAuthorized()) {
          return new Response(JSON.stringify({ success: false, error: "Unauthorized: Sesi order tidak valid." }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const orderId = sanitizeText(body.id || ("ORD-" + Math.floor(100000 + Math.random() * 900000)), 32);
        const custUser = sanitizeText((verifiedActor && verifiedActor.username) || body.customerUsername || "guest", 40);
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

      
      // 12. Cek Saldo CN Wallet Pengguna (Rate-Limited)
      if (url.pathname === "/api/wallet/balance" && request.method === "GET") {
        if (!checkMemoryRate(clientIp, "wallet_bal", 40, 60000)) {
          return new Response(JSON.stringify({ success: false, error: "Terlalu banyak permintaan." }), {
            status: 429, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const uname = sanitizeText(url.searchParams.get("username") || "", 40).replace(/^@/, "").trim().toLowerCase();
        if (!uname) {
          return new Response(JSON.stringify({ success: false, error: "Username wajib diisi" }), {
            status: 400, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        const row = await env.DB.prepare("SELECT balance, updated_at FROM wallet_balances WHERE username = ?").bind(uname).first();
        return new Response(JSON.stringify({
          success: true,
          username: uname,
          balance: row ? Number(row.balance || 0) : 0,
          updatedAt: row ? row.updated_at : null
        }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 13. Buat Intent QRIS Dinamis (WAJIB X-Session-Token HMAC Valid + Rate Limit + Kode Unik 1..499)
      if (url.pathname === "/api/wallet/intent" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "wallet_intent", 10, 600000)) {
          return new Response(JSON.stringify({ success: false, error: "Batas pembuatan tagihan QRIS tercapai. Coba lagi nanti." }), {
            status: 429, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        const sessTok = request.headers.get("X-Session-Token") || "";
        const verifiedActor = await verifySessionToken(env.ADMIN_SECRET_TOKEN, sessTok);
        if (!verifiedActor && !isAuthorized()) {
          return new Response(JSON.stringify({ success: false, error: "Unauthorized: Sesi tidak valid." }), {
            status: 401, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const requestedUser = sanitizeText(body.username || "", 40).replace(/^@/, "").trim().toLowerCase();
        const actorUser = verifiedActor ? String(verifiedActor.username || "").toLowerCase() : requestedUser;

        if (!actorUser || (verifiedActor && requestedUser && actorUser !== requestedUser && !isAuthorized())) {
          return new Response(JSON.stringify({ success: false, error: "Forbidden: Identitas sesi tidak cocok." }), {
            status: 403, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const baseAmount = Math.max(5000, Math.min(50000000, Math.round(Number(body.baseAmount || 0))));
        const mode = body.mode === "booking" ? "booking" : "topup";
        const service = sanitizeText(body.service || "Top-Up Saldo CN Wallet", 160);
        const now = Date.now();

        // Batalkan intent PENDING sebelumnya milik user yang sama (Anti-Spam / Anti-Exhaustion kode unik)
        await env.DB.prepare(
          "UPDATE qris_intents SET status = 'SUPERSEDED' WHERE username = ? AND status = 'PENDING'"
        ).bind(actorUser).run();

        // Bersihkan intent kedaluwarsa (> 45 menit)
        await env.DB.prepare(
          "UPDATE qris_intents SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < ?"
        ).bind(now).run();

        // Pilih kode unik 1..499 yang tidak bertabrakan dengan intent aktif nominal dasar sama
        const activeRows = await env.DB.prepare(
          "SELECT unique_code FROM qris_intents WHERE status = 'PENDING' AND base_amount = ?"
        ).bind(baseAmount).all();
        const usedCodes = new Set(((activeRows && activeRows.results) || []).map(r => Number(r.unique_code)));

        let uniqueCode = 1;
        for (let attempt = 0; attempt < 200; attempt++) {
          const candidate = (crypto.getRandomValues(new Uint32Array(1))[0] % 499) + 1; // Cryptographic RNG 1..499 (< 500)
          if (!usedCodes.has(candidate)) {
            uniqueCode = candidate;
            break;
          }
        }

        const totalAmount = baseAmount + uniqueCode;
        const intentId = "QRS-" + now + "-" + String(uniqueCode).padStart(3, "0");
        const expiresAt = now + (45 * 60 * 1000);

        await env.DB.prepare(
          "INSERT INTO qris_intents (id, username, base_amount, unique_code, total_amount, mode, service, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)"
        ).bind(intentId, actorUser, baseAmount, uniqueCode, totalAmount, mode, service, expiresAt, new Date(now).toISOString()).run();

        // Kirim notifikasi approval ketat ke Telegram Admin
        if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_CHAT_ID) {
          try {
            const msgText = [
              "💳 *PERMINTAAN TOPUP QRIS DANA*",
              "━━━━━━━━━━━━━━",
              "👤 User: `" + actorUser + "`",
              "💰 Nominal: *Rp " + Number(totalAmount).toLocaleString("id-ID") + "*",
              "🔢 Kode Unik: `" + uniqueCode + "` (Pokok: Rp " + Number(baseAmount).toLocaleString("id-ID") + ")",
              "🏷️ Layanan: " + (service || mode || "Topup Wallet"),
              "🆔 Intent: `" + intentId + "`",
              "━━━━━━━━━━━━━━",
              "⚠️ Cek mutasi DANA terlebih dahulu sebelum klik Approve."
            ].join("\n");
            await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: env.TELEGRAM_ADMIN_CHAT_ID,
                text: msgText,
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [[
                    { text: "✅ Approve Saldo", callback_data: "qris_ok:" + intentId },
                    { text: "❌ Tolak", callback_data: "qris_no:" + intentId }
                  ]]
                }
              })
            });
          } catch (e) {}
        }

        return new Response(JSON.stringify({
          success: true,
          intent: {
            id: intentId,
            username: actorUser,
            baseAmount,
            uniqueCode,
            totalAmount,
            mode,
            service,
            expiresAt
          }
        }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 13B. Strict Telegram Approval Webhook (Anti-Manipulasi Saldo)
      if (url.pathname === "/api/webhook/telegram" && request.method === "POST") {
        const expectedSecret = (env.TELEGRAM_WEBHOOK_SECRET || "").trim();
        const incomingSecret = (request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "").trim();
        if (!expectedSecret || incomingSecret !== expectedSecret) {
          return new Response("Forbidden", { status: 403 });
        }

        const update = await request.json().catch(() => null);
        const cb = update && update.callback_query;
        if (!cb || !cb.data) return new Response("OK", { status: 200 });

        const adminChatId = String(env.TELEGRAM_ADMIN_CHAT_ID || "").trim();
        const fromId = String(cb.from?.id || "");
        const chatId = String(cb.message?.chat?.id || "");
        if (!adminChatId || (fromId !== adminChatId && chatId !== adminChatId)) {
          return new Response("Unauthorized", { status: 403 });
        }

        const [action, targetId] = String(cb.data).split(":");
        if ((action !== "qris_ok" && action !== "qris_no") || !targetId) {
          return new Response("OK", { status: 200 });
        }

        const answerCb = async (text) => {
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callback_query_id: cb.id, text, show_alert: true })
          });
        };

        const editMsg = async (suffix) => {
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: cb.message.chat.id,
              message_id: cb.message.message_id,
              text: (cb.message.text || "") + "\n\n" + suffix,
              reply_markup: { inline_keyboard: [] }
            })
          });
        };

        const intent = await env.DB.prepare("SELECT * FROM qris_intents WHERE id = ?").bind(targetId).first();
        if (!intent) {
          await answerCb("Intent tidak ditemukan.");
          return new Response("OK", { status: 200 });
        }
        if (intent.status !== "PENDING") {
          await answerCb("Transaksi sudah diproses (" + intent.status + ").");
          await editMsg("ℹ️ Status: " + intent.status);
          return new Response("OK", { status: 200 });
        }

        const nowIso = new Date().toISOString();
        if (action === "qris_no") {
          await env.DB.prepare("UPDATE qris_intents SET status = 'REJECTED' WHERE id = ? AND status = 'PENDING'").bind(targetId).run();
          await answerCb("❌ Transaksi ditolak.");
          await editMsg("❌ DITOLAK oleh Admin (" + nowIso + ")");
          return new Response("OK", { status: 200 });
        }

        // Atomic Approve & Credit Saldo (Anti-Double Credit)
        const upd = await env.DB.prepare(
          "UPDATE qris_intents SET status = 'PAID', paid_at = ? WHERE id = ? AND status = 'PENDING'"
        ).bind(nowIso, targetId).run();

        if (upd?.meta?.changes > 0) {
          const creditAmount = Number(intent.base_amount || intent.total_amount || 0);
          if (creditAmount > 0) {
            await env.DB.prepare(
              "INSERT INTO wallet_balances (username, balance, updated_at) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at"
            ).bind(intent.username, creditAmount, nowIso).run();
          }
          await answerCb("✅ Saldo Rp " + creditAmount.toLocaleString("id-ID") + " masuk ke " + intent.username);
          await editMsg("✅ APPROVED • Saldo Rp " + creditAmount.toLocaleString("id-ID") + " masuk (" + nowIso + ")");
        } else {
          await answerCb("⚠️ Sudah diproses sebelumnya.");
        }
        return new Response("OK", { status: 200 });
      }

      // 14. Potong Saldo Wallet (WAJIB X-Session-Token HMAC Valid + Atomic Balance Check)
      if (url.pathname === "/api/wallet/spend" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "wallet_spend", 15, 600000)) {
          return new Response(JSON.stringify({ success: false, error: "Terlalu banyak transaksi." }), {
            status: 429, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        const sessTok = request.headers.get("X-Session-Token") || "";
        const verifiedActor = await verifySessionToken(env.ADMIN_SECRET_TOKEN, sessTok);
        if (!verifiedActor) {
          return new Response(JSON.stringify({ success: false, error: "Unauthorized: Sesi pembayaran tidak valid." }), {
            status: 401, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const uname = String(verifiedActor.username || "").replace(/^@/, "").trim().toLowerCase();
        const amount = Math.max(1, Math.min(50000000, Math.round(Number(body.amount || 0))));

        if (!uname || amount <= 0) {
          return new Response(JSON.stringify({ success: false, error: "Nominal transaksi tidak valid" }), {
            status: 400, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        // Atomic debit di D1: hanya berhasil jika saldo >= amount (anti race-condition / double spend)
        const debitRes = await env.DB.prepare(
          "UPDATE wallet_balances SET balance = balance - ?, updated_at = ? WHERE username = ? AND balance >= ?"
        ).bind(amount, new Date().toISOString(), uname, amount).run();

        if (!debitRes || !debitRes.meta || Number(debitRes.meta.changes || 0) !== 1) {
          const row = await env.DB.prepare("SELECT balance FROM wallet_balances WHERE username = ?").bind(uname).first();
          return new Response(JSON.stringify({
            success: false,
            error: "Saldo CN Wallet tidak mencukupi",
            balance: row ? Number(row.balance || 0) : 0
          }), {
            status: 402, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const updatedRow = await env.DB.prepare("SELECT balance FROM wallet_balances WHERE username = ?").bind(uname).first();
        return new Response(JSON.stringify({
          success: true,
          balance: updatedRow ? Number(updatedRow.balance || 0) : 0
        }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 15. WEBHOOK OTOMATIS SAWERIA (WAJIB Secret Token + Brute-Force Lockout + Atomic Anti-Replay)
      if (url.pathname === "/api/webhook/saweria" && request.method === "POST") {
        return new Response(JSON.stringify({ error: "Saweria webhook disabled" }), { status: 410, headers: { ...securityHeaders, "Content-Type": "application/json" } });
        if (!env.SAWERIA_WEBHOOK_TOKEN) {
          return new Response(JSON.stringify({ success: false, error: "Webhook belum dikonfigurasi." }), {
            status: 503, headers: { "Content-Type": "application/json" }
          });
        }
        const lock = await checkPersistentLockout("saweria_wh");
        if (lock.locked) {
          return new Response(JSON.stringify({ success: false, error: "Too many invalid webhook attempts." }), {
            status: 429, headers: { "Content-Type": "application/json" }
          });
        }

        const expectedWebhookToken = env.SAWERIA_WEBHOOK_TOKEN;
        const providedToken = (url.searchParams.get("token") || request.headers.get("X-Webhook-Token") || "").trim();

        if (!providedToken || !safeEqual(providedToken, expectedWebhookToken)) {
          await recordAuthFailure("saweria_wh");
          return new Response(JSON.stringify({ success: false, error: "Unauthorized: Webhook token tidak valid." }), {
            status: 401, headers: { "Content-Type": "application/json" }
          });
        }
        await clearAuthFailure("saweria_wh");

        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();

        const payload = await request.json().catch(() => ({}));
        const paidAmount = Math.round(Number(payload.amount_raw || payload.amount || 0));
        const rawMsg = String(payload.message || payload.donator_name || "").toLowerCase();

        if (paidAmount <= 0 || paidAmount > 100000000) {
          return new Response(JSON.stringify({ success: false, error: "Nominal tidak valid" }), {
            status: 400, headers: { "Content-Type": "application/json" }
          });
        }

        const now = Date.now();
        let matched = await env.DB.prepare(
          "SELECT * FROM qris_intents WHERE status = 'PENDING' AND total_amount = ? AND expires_at >= ? ORDER BY created_at DESC LIMIT 1"
        ).bind(paidAmount, now).first();

        if (!matched) {
          const userMatch = rawMsg.match(/@([a-z0-9_]{2,30})/);
          if (userMatch && userMatch[1]) {
            matched = await env.DB.prepare(
              "SELECT * FROM qris_intents WHERE status = 'PENDING' AND username = ? AND expires_at >= ? ORDER BY created_at DESC LIMIT 1"
            ).bind(userMatch[1], now).first();
          }
        }

        if (!matched) {
          return new Response(JSON.stringify({
            success: true,
            matched: false,
            note: "Tidak ada intent pending yang cocok."
          }), {
            headers: { "Content-Type": "application/json" }
          });
        }

        // Atomic Anti-Replay: hanya mengkreditkan saldo jika status berhasil diubah dari PENDING -> PAID_AUTO (changes === 1)
        const claimRes = await env.DB.prepare(
          "UPDATE qris_intents SET status = 'PAID_AUTO' WHERE id = ? AND status = 'PENDING'"
        ).bind(matched.id).run();

        if (!claimRes || !claimRes.meta || Number(claimRes.meta.changes || 0) !== 1) {
          return new Response(JSON.stringify({ success: true, matched: false, note: "Transaksi sudah diproses sebelumnya." }), {
            headers: { "Content-Type": "application/json" }
          });
        }

        const creditAmount = Number(matched.total_amount || paidAmount);
        await env.DB.prepare(
          "INSERT INTO wallet_balances (username, balance, updated_at) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at"
        ).bind(matched.username, creditAmount, new Date().toISOString()).run();

        const updatedBal = await env.DB.prepare("SELECT balance FROM wallet_balances WHERE username = ?").bind(matched.username).first();

        await env.DB.prepare(
          "INSERT OR REPLACE INTO orders_store (id, customer_username, customer_name, service, amount, voucher, note, status, created_at) VALUES (?, ?, ?, ?, ?, '-', 'Auto-Verified via Saweria Webhook', 'Lunas (Auto QRIS)', ?)"
        ).bind(matched.id, matched.username, "@" + matched.username, matched.service, creditAmount, new Date().toISOString()).run();

        return new Response(JSON.stringify({
          success: true,
          matched: true,
          intentId: matched.id,
          username: matched.username,
          credited: creditAmount,
          newBalance: updatedBal ? Number(updatedBal.balance || 0) : creditAmount
        }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // 16. BACKUP MANUAL: Daftar Intent Pending & Approval SuperAdmin (Atomic Anti-Double Credit)
      if (url.pathname === "/api/wallet/pending" && request.method === "GET") {
        if (!isAuthorized()) {
          return new Response(JSON.stringify({ success: false, error: "Akses ditolak" }), {
            status: 401, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const res = await env.DB.prepare(
          "SELECT * FROM qris_intents ORDER BY created_at DESC LIMIT 50"
        ).all();
        return new Response(JSON.stringify({
          success: true,
          intents: (res && res.results) ? res.results : []
        }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      if (url.pathname === "/api/wallet/approve-backup" && request.method === "POST") {
        if (!isAuthorized()) {
          return new Response(JSON.stringify({ success: false, error: "Akses ditolak" }), {
            status: 401, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const intentId = sanitizeText(body.intentId || "", 64).trim();
        const intent = await env.DB.prepare("SELECT * FROM qris_intents WHERE id = ?").bind(intentId).first();
        if (!intent) {
          return new Response(JSON.stringify({ success: false, error: "Intent tidak ditemukan" }), {
            status: 404, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const claimRes = await env.DB.prepare(
          "UPDATE qris_intents SET status = 'PAID_MANUAL' WHERE id = ? AND status NOT IN ('PAID_AUTO', 'PAID_MANUAL')"
        ).bind(intentId).run();

        if (!claimRes || !claimRes.meta || Number(claimRes.meta.changes || 0) !== 1) {
          return new Response(JSON.stringify({ success: true, alreadyPaid: true }), {
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const creditAmount = Number(intent.total_amount || intent.base_amount || 0);
        await env.DB.prepare(
          "INSERT INTO wallet_balances (username, balance, updated_at) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at"
        ).bind(intent.username, creditAmount, new Date().toISOString()).run();

        const updatedBal = await env.DB.prepare("SELECT balance FROM wallet_balances WHERE username = ?").bind(intent.username).first();

        await env.DB.prepare(
          "INSERT OR REPLACE INTO orders_store (id, customer_username, customer_name, service, amount, voucher, note, status, created_at) VALUES (?, ?, ?, ?, ?, '-', 'Approved via Backup Admin', 'Lunas (Verified Admin)', ?)"
        ).bind(intent.id, intent.username, "@" + intent.username, intent.service, creditAmount, new Date().toISOString()).run();

        return new Response(JSON.stringify({
          success: true,
          username: intent.username,
          credited: creditAmount,
          newBalance: updatedBal ? Number(updatedBal.balance || 0) : creditAmount
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
