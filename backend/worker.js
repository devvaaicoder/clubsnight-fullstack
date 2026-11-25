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

async function sendTelegramMessage(botToken, chatId, payload, referenceType, referenceId) {
  const safeReferenceId = String(referenceId || "unknown")
    .replace(/[^\w.-]/g, "_")
    .replace(botToken, "[REDACTED]")
    .slice(0, 120);
  let response;
  let result;
  try {
    response = await fetch("https://api.telegram.org/bot" + botToken + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, ...payload })
    });
    result = await response.json().catch(() => null);
  } catch (_) {
    console.warn("Telegram sendMessage failed " + referenceType + "=" + safeReferenceId +
      ": error_code=network_error description=Network request failed");
    return false;
  }

  if (!response.ok || !result || result.ok !== true) {
    const errorCode = result && Number.isInteger(result.error_code) ? result.error_code : response.status;
    const description = String(result && result.description || "Invalid Telegram response")
      .replace(/https?:\/\/\S+/gi, "[URL]")
      .replace(botToken, "[REDACTED]")
      .replace(/[\r\n\t]/g, " ")
      .slice(0, 200);
    console.warn("Telegram sendMessage failed " + referenceType + "=" + safeReferenceId +
      ": error_code=" + errorCode + " description=" + description);
    return false;
  }

  return true;
}

function sanitizeText(val, maxLen = 500) {
  return String(val == null ? "" : val)
    .replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[ch]))
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLen);
}

function normalizeUsername(val) {
  return String(val == null ? "" : val).replace(/^@/, "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);
}

function isOwnedLoungePost(post, username) {
  if (!post || typeof post !== "object") return false;
  const owner = normalizeUsername(username);
  return [post.ownerUsername, post.username, post.authorHandle, post.handle]
    .some((value) => normalizeUsername(value) === owner);
}

function safeLoungeImage(value, r2PublicUrl) {
  const image = String(value || "").trim().slice(0, 200000);
  if (/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(image)) return image;
  try {
    const parsed = new URL(image);
    const trustedHosts = new Set(["media-cn.my.id"]);
    const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
    try { trustedHosts.add(new URL(r2PublicUrl || "https://media-cn.my.id").hostname); } catch (_) {}
    if (parsed.protocol === "http:" && trustedHosts.has(parsed.hostname)) parsed.protocol = "https:";
    return parsed.protocol === "https:" || (parsed.protocol === "http:" && localHosts.has(parsed.hostname)) ? parsed.href : "";
  } catch (_) {
    return "";
  }
}

function extractSafeR2Key(value, env, requestOrigin) {
  try {
    const parsed = new URL(String(value || ""));
    const workerOrigin = new URL(requestOrigin).origin;
    let path;
    if (parsed.origin === workerOrigin && parsed.pathname.startsWith("/r2/")) {
      path = parsed.pathname.slice("/r2/".length);
    } else {
      const publicBase = new URL(env.R2_PUBLIC_URL || "https://media-cn.my.id");
      if (parsed.origin !== publicBase.origin) return null;
      const basePath = publicBase.pathname.replace(/\/+$/, "");
      if (basePath && !parsed.pathname.startsWith(basePath + "/")) return null;
      path = parsed.pathname.slice(basePath ? basePath.length + 1 : 1);
    }

    const key = decodeURIComponent(path);
    if (!key || key.includes("\\") || /[\u0000-\u001f\u007f]/.test(key) ||
        key.split("/").some((part) => !part || part === "." || part === "..")) return null;
    return key;
  } catch (_) {
    return null;
  }
}

function cleanLoungeText(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "")
    .replace(/<[^>]*>/g, (tag) => {
      const allowed = tag.match(/^<(\/?)(b|strong|i|em|u|br)\s*\/?>$/i);
      return allowed ? "<" + allowed[1] + allowed[2].toLowerCase() + (allowed[2].toLowerCase() === "br" ? " /" : "") + ">" : "";
    })
    .trim()
    .slice(0, maxLength);
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

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  return base64UrlEncodeBytes(bytes);
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(value) {
  const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

async function signHmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

async function signSessionToken(secret, claims, ttlMs = 15 * 60 * 1000) {
  if (!secret) throw new Error("ADMIN_SECRET_TOKEN belum dikonfigurasi");
  const payload = {
    ...claims,
    exp: Math.floor((Date.now() + ttlMs) / 1000),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(8)))
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = await signHmac("cn_worker_session_v1:" + secret, encoded);
  return encoded + "." + base64UrlEncode(String.fromCharCode(...signature));
}

async function verifySessionToken(secret, token) {
  try {
    if (!secret) return null;
    const parts = String(token || "").split(".");
    if (parts.length !== 2) return null;
    const claims = JSON.parse(base64UrlDecode(parts[0]));
    const signature = base64UrlEncode(String.fromCharCode(...await signHmac("cn_worker_session_v1:" + secret, parts[0])));
    if (!safeEqual(parts[1], signature)) return null;
    if (!claims || typeof claims !== "object" || !claims.sub || !claims.role || Number(claims.exp) <= Math.floor(Date.now() / 1000)) return null;
    if (!["consumer", "admin", "merch", "developer", "talent", "guest"].includes(claims.role)) return null;
    if (!Array.isArray(claims.permissions)) claims.permissions = [];
    return claims;
  } catch (_) {
    return null;
  }
}

async function verifyWorkerAssertion(secret, token) {
  try {
    if (!secret) return null;
    const [encoded, suppliedSignature, extra] = String(token || "").split(".");
    if (!encoded || !suppliedSignature || extra) return null;
    const expectedSignature = base64UrlEncodeBytes(await signHmac(secret, encoded));
    if (!safeEqual(suppliedSignature, expectedSignature)) return null;
    const claims = JSON.parse(base64UrlDecode(encoded));
    if (!claims || typeof claims !== "object" || Number(claims.exp) <= Math.floor(Date.now() / 1000)) return null;
    if (!/^tg:[0-9]+$/.test(String(claims.sub || "")) && !/^cn:cn_[a-f0-9]+$/.test(String(claims.sub || ""))) return null;
    if (!["consumer", "admin", "merch", "developer"].includes(claims.role)) return null;
    if (!/^[a-z0-9_]{2,40}$/.test(String(claims.username || ""))) return null;
    if (!Array.isArray(claims.permissions)) claims.permissions = [];
    return claims;
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
    const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
      ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname);
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

    if (request.method === "POST" &&
        url.pathname !== "/api/webhook/saweria" &&
        url.pathname !== "/api/webhook/telegram" &&
        !isAllowedOrigin && !isAuthorized()) {
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
          "CREATE TABLE IF NOT EXISTS wallet_admin_adjustments (subject TEXT NOT NULL, reference TEXT NOT NULL, username TEXT NOT NULL, amount INTEGER NOT NULL, reason TEXT NOT NULL, actor_subject TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (subject, reference))"
        ).run();
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS qris_intents (id TEXT PRIMARY KEY, username TEXT NOT NULL, base_amount INTEGER NOT NULL, unique_code INTEGER NOT NULL, total_amount INTEGER NOT NULL, mode TEXT, service TEXT, status TEXT DEFAULT 'PENDING', expires_at INTEGER, created_at TEXT, paid_at TEXT)"
        ).run();
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS legacy_qris_credits (intent_id TEXT PRIMARY KEY, username TEXT NOT NULL, amount INTEGER NOT NULL, subject TEXT, applied INTEGER NOT NULL DEFAULT 0, credited_at TEXT NOT NULL)"
        ).run();
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS merch_stock_control (product_id TEXT PRIMARY KEY, stock INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)"
        ).run();
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS auth_lockouts (ip_key TEXT PRIMARY KEY, fails INTEGER DEFAULT 0, locked_until INTEGER DEFAULT 0)"
        ).run();
        try {
          await env.DB.prepare("ALTER TABLE talent_accounts ADD COLUMN token_version INTEGER DEFAULT 1").run();
        } catch (_) {}
      };

      const claimLegacyIdentity = async (claims) => {
        if (claims.role !== "consumer") return;
        const username = normalizeUsername(claims.username);
        const subject = String(claims.sub || "");
        if (!username || !subject) return;

        const legacyBalance = await env.DB.prepare(
          "SELECT balance, updated_at FROM wallet_balances WHERE lower(username) = ?"
        ).bind(username).first();
        const legacyOrders = await env.DB.prepare(
          "SELECT id FROM orders_store WHERE lower(customer_username) = ?"
        ).bind(username).all();
        const orderRows = (legacyOrders && legacyOrders.results) || [];
        if (!legacyBalance && orderRows.length === 0) {
          await env.DB.prepare(
            "INSERT INTO wallet_subject_balances (subject, balance, updated_at) VALUES (?, 0, ?) ON CONFLICT(subject) DO NOTHING"
          ).bind(subject, new Date().toISOString()).run();
          return;
        }

        const priorClaims = await env.DB.prepare(
          "SELECT subject, status FROM wallet_legacy_claims WHERE lower(legacy_username) = ?"
        ).bind(username).all();
        const prior = (priorClaims && priorClaims.results) || [];
        if (prior.some((claim) => claim.subject === subject && claim.status === "claimed")) {
          await env.DB.prepare(
            "INSERT INTO wallet_subject_balances (subject, balance, updated_at) VALUES (?, 0, ?) ON CONFLICT(subject) DO NOTHING"
          ).bind(subject, new Date().toISOString()).run();
          return;
        }

        const existingOwner = prior.find((claim) => claim.status === "claimed");
        const reason = claims.username_ambiguous
          ? "username_ambiguous"
          : claims.username_changed_recently
            ? "username_changed_recently"
            : existingOwner
              ? "legacy_row_already_claimed"
              : prior.length
                ? "prior_review"
                : "";
        const now = new Date().toISOString();
        const amount = Math.max(0, Number(legacyBalance && legacyBalance.balance) || 0);

        if (reason) {
          await env.DB.batch([
            env.DB.prepare(
              "INSERT INTO wallet_legacy_claims (legacy_username, subject, amount, status, reason, created_at) VALUES (?, ?, ?, 'review', ?, ?) ON CONFLICT(legacy_username, subject) DO UPDATE SET status = CASE WHEN wallet_legacy_claims.status = 'claimed' THEN 'claimed' ELSE 'review' END, reason = CASE WHEN wallet_legacy_claims.status = 'claimed' THEN wallet_legacy_claims.reason ELSE excluded.reason END"
            ).bind(username, subject, amount, reason, now),
            env.DB.prepare(
              "INSERT INTO wallet_migrations (legacy_username, subject, amount, action, reason, occurred_at) SELECT ?, ?, ?, 'review', ?, ? WHERE NOT EXISTS (SELECT 1 FROM wallet_migrations WHERE legacy_username = ? AND subject = ? AND action IN ('claimed', 'resolved', 'review'))"
            ).bind(username, subject, amount, reason, now, username, subject),
            env.DB.prepare(
              "INSERT INTO wallet_subject_balances (subject, balance, updated_at) VALUES (?, 0, ?) ON CONFLICT(subject) DO NOTHING"
            ).bind(subject, now)
          ]);
          return;
        }

        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO wallet_legacy_claims (legacy_username, subject, amount, status, created_at) VALUES (?, ?, ?, 'claimed', ?) ON CONFLICT DO NOTHING"
          ).bind(username, subject, amount, now),
          env.DB.prepare(
            "INSERT INTO wallet_subject_balances (subject, balance, updated_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM wallet_legacy_claims WHERE legacy_username = ? AND subject = ? AND status = 'claimed') AND NOT EXISTS (SELECT 1 FROM wallet_migrations WHERE legacy_username = ? AND subject = ? AND action IN ('claimed', 'resolved')) ON CONFLICT(subject) DO UPDATE SET balance = wallet_subject_balances.balance + excluded.balance, updated_at = excluded.updated_at"
          ).bind(subject, amount, now, username, subject, username, subject),
          env.DB.prepare(
            "INSERT INTO wallet_migrations (legacy_username, subject, amount, action, occurred_at) SELECT ?, ?, ?, 'claimed', ? WHERE EXISTS (SELECT 1 FROM wallet_legacy_claims WHERE legacy_username = ? AND subject = ? AND status = 'claimed') AND NOT EXISTS (SELECT 1 FROM wallet_migrations WHERE legacy_username = ? AND subject = ? AND action IN ('claimed', 'resolved'))"
          ).bind(username, subject, amount, now, username, subject, username, subject),
          env.DB.prepare(
            "INSERT INTO wallet_transactions (id, subject, username, amount, transaction_type, reference, actor_subject, created_at) SELECT ?, ?, ?, ?, 'legacy_claim', ?, ?, ? WHERE EXISTS (SELECT 1 FROM wallet_migrations WHERE legacy_username = ? AND subject = ? AND action = 'claimed') AND NOT EXISTS (SELECT 1 FROM wallet_transactions WHERE subject = ? AND reference = ?)"
          ).bind("legacy:" + username + ":" + subject, subject, username, amount, "legacy:" + username, subject, now, username, subject, subject, "legacy:" + username),
          env.DB.prepare(
            "INSERT INTO order_subject_links (order_id, subject, order_type, linked_at) SELECT id, ?, CASE WHEN lower(COALESCE(service, '')) LIKE '%merch%' THEN 'merch' ELSE 'standard' END, ? FROM orders_store WHERE lower(customer_username) = ? ON CONFLICT(order_id) DO UPDATE SET order_type = CASE WHEN lower(COALESCE((SELECT service FROM orders_store WHERE id = order_subject_links.order_id), '')) LIKE '%merch%' THEN 'merch' ELSE order_subject_links.order_type END"
          ).bind(subject, now, username),
          env.DB.prepare(
            "INSERT INTO wallet_subject_balances (subject, balance, updated_at) VALUES (?, 0, ?) ON CONFLICT(subject) DO NOTHING"
          ).bind(subject, now)
        ]);
      };

      const approveLegacyQrisIntent = async (intentId, approvedBy) => {
        const intent = await env.DB.prepare("SELECT * FROM qris_intents WHERE id = ?").bind(intentId).first();
        if (!intent) return { found: false };
        if (intent.status !== "PENDING") return { found: true, processed: false, status: intent.status };

        const claim = await env.DB.prepare(
          "SELECT subject FROM wallet_legacy_claims WHERE lower(legacy_username) = lower(?) AND status = 'claimed' LIMIT 1"
        ).bind(intent.username).first();
        const subject = claim && claim.subject || null;
        const now = new Date().toISOString();
        const results = await env.DB.batch([
          env.DB.prepare("UPDATE qris_intents SET status = 'PAID_MANUAL' WHERE id = ? AND status = 'PENDING'")
            .bind(intentId),
          env.DB.prepare(
            "INSERT INTO legacy_qris_credits (intent_id, username, amount, subject, applied, credited_at) SELECT id, username, base_amount, ?, 0, ? FROM qris_intents WHERE id = ? AND status = 'PAID_MANUAL' AND changes() = 1 ON CONFLICT(intent_id) DO NOTHING"
          ).bind(subject, now, intentId),
          env.DB.prepare(
            "INSERT INTO wallet_subject_balances (subject, balance, updated_at) SELECT subject, amount, ? FROM legacy_qris_credits WHERE intent_id = ? AND subject IS NOT NULL AND applied = 0 ON CONFLICT(subject) DO UPDATE SET balance = wallet_subject_balances.balance + excluded.balance, updated_at = excluded.updated_at"
          ).bind(now, intentId),
          env.DB.prepare(
            "INSERT INTO wallet_balances (username, balance, updated_at) SELECT username, amount, ? FROM legacy_qris_credits WHERE intent_id = ? AND subject IS NULL AND applied = 0 ON CONFLICT(username) DO UPDATE SET balance = wallet_balances.balance + excluded.balance, updated_at = excluded.updated_at"
          ).bind(now, intentId),
          env.DB.prepare(
            "INSERT INTO wallet_transactions (id, subject, username, amount, transaction_type, reference, actor_subject, created_at) SELECT 'legacy-qris:' || intent_id, subject, username, amount, 'topup_legacy_telegram', intent_id, ?, ? FROM legacy_qris_credits WHERE intent_id = ? AND subject IS NOT NULL AND applied = 0 ON CONFLICT(id) DO NOTHING"
          ).bind(approvedBy, now, intentId),
          env.DB.prepare(
            "UPDATE wallet_legacy_claims SET amount = COALESCE((SELECT balance FROM wallet_balances WHERE lower(username) = lower(wallet_legacy_claims.legacy_username)), amount) WHERE lower(legacy_username) = lower(?) AND status = 'review' AND EXISTS (SELECT 1 FROM legacy_qris_credits WHERE intent_id = ? AND subject IS NULL AND applied = 0)"
          ).bind(intent.username, intentId),
          env.DB.prepare("UPDATE legacy_qris_credits SET applied = 1, credited_at = ? WHERE intent_id = ? AND applied = 0")
            .bind(now, intentId)
        ]);
        const processed = Number(results && results[0] && results[0].meta && results[0].meta.changes || 0) === 1;
        return { found: true, processed, status: processed ? "PAID_MANUAL" : intent.status, intent, amount: Number(intent.base_amount || 0) };
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
      const getActor = async () => verifySessionToken(env.ADMIN_SECRET_TOKEN, request.headers.get("X-Session-Token") || "");
      const roleAllowed = (actor, roles) => Boolean(actor && (actor.role === "developer" || roles.includes(actor.role)));
      const resolveWalletSubject = async (value) => {
        const raw = String(value || "").trim();
        if (/^tg:[0-9]+$/.test(raw) || /^cn:cn_[a-f0-9]{12}$/.test(raw)) {
          return { subject: raw, username: "" };
        }
        const username = normalizeUsername(raw);
        if (username.length < 2) return null;
        const matches = await env.DB.prepare(
          "SELECT subject FROM (SELECT subject FROM wallet_legacy_claims WHERE lower(legacy_username) = ? AND status = 'claimed' UNION SELECT subject FROM wallet_transactions WHERE lower(username) = ? UNION SELECT subject FROM wallet_intents WHERE lower(username) = ? UNION SELECT subject FROM wallet_migrations WHERE lower(legacy_username) = ? UNION SELECT subject FROM legacy_qris_credits WHERE lower(username) = ? AND subject IS NOT NULL) WHERE subject IS NOT NULL GROUP BY subject LIMIT 2"
        ).bind(username, username, username, username, username).all();
        const subjects = (matches && matches.results || []).map((row) => row.subject).filter(Boolean);
        if (subjects.length !== 1) return { ambiguous: subjects.length > 1, username };
        return { subject: subjects[0], username };
      };

      if (url.pathname === "/api/session/exchange" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "session_exchange", 20, 60000)) return jsonOut({ success: false, error: "Terlalu banyak permintaan sesi." }, 429);
        const body = await request.json().catch(() => ({}));
        const assertionSecret = env.ENVIRONMENT === "development" && isLocalhost
          ? (env.DEV_TEST_SECRET || env.WORKER_ASSERTION_SECRET)
          : env.WORKER_ASSERTION_SECRET;
        const claims = await verifyWorkerAssertion(assertionSecret, body.assertion);
        if (!claims) return jsonOut({ success: false, error: "Assertion identitas tidak valid atau kedaluwarsa." }, 401);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 503);
        await ensureTableExists();
        await claimLegacyIdentity(claims);
        const sessionToken = await signSessionToken(env.ADMIN_SECRET_TOKEN, {
          sub: claims.sub,
          username: claims.username,
          name: claims.name || claims.username,
          role: claims.role,
          permissions: claims.permissions || []
        });
        return jsonOut({ success: true, sessionToken, identity: { sub: claims.sub, username: claims.username, role: claims.role } });
      }

      if (url.pathname === "/api/dev/test-assertion" && request.method === "POST") {
        if (env.ENVIRONMENT !== "development" || !isLocalhost || !env.DEV_TEST_SECRET ||
            !safeEqual(request.headers.get("X-Dev-Test-Secret") || "", env.DEV_TEST_SECRET)) {
          return jsonOut({ success: false, error: "Not found." }, 404);
        }
        const body = await request.json().catch(() => ({}));
        const role = String(body.role || "consumer");
        const username = normalizeUsername(body.username || "test_user") || "test_user";
        const sub = String(body.sub || ("cn:cn_" + toHex(crypto.getRandomValues(new Uint8Array(6)))));
        if (!["consumer", "admin", "merch", "developer"].includes(role) ||
            (!/^tg:[0-9]+$/.test(sub) && !/^cn:cn_[a-f0-9]{12}$/.test(sub))) {
          return jsonOut({ success: false, error: "Invalid test identity." }, 400);
        }
        const claims = {
          sub,
          username,
          name: sanitizeText(body.name || username, 60),
          role,
          permissions: [],
          username_ambiguous: body.username_ambiguous === true,
          username_changed_recently: body.username_changed_recently === true,
          exp: Math.floor(Date.now() / 1000) + 60
        };
        const encoded = base64UrlEncode(JSON.stringify(claims));
        const signature = base64UrlEncodeBytes(await signHmac(env.DEV_TEST_SECRET, encoded));
        return jsonOut({ success: true, assertion: encoded + "." + signature });
      }

      if (url.pathname === "/api/dev/test-session" && request.method === "POST") {
        if (env.ENVIRONMENT !== "development" || !isLocalhost || !env.DEV_TEST_SECRET ||
            !safeEqual(request.headers.get("X-Dev-Test-Secret") || "", env.DEV_TEST_SECRET)) {
          return jsonOut({ success: false, error: "Not found." }, 404);
        }
        const body = await request.json().catch(() => ({}));
        const role = String(body.role || "");
        const username = normalizeUsername(body.username || "test_user") || "test_user";
        const sub = String(body.sub || ("cn:cn_" + toHex(crypto.getRandomValues(new Uint8Array(6)))));
        if (!["consumer", "admin", "merch", "developer", "talent"].includes(role) ||
            (!/^tg:[0-9]+$/.test(sub) && !/^cn:cn_[a-f0-9]{12}$/.test(sub) && !/^talent:[a-z0-9_-]+$/.test(sub))) {
          return jsonOut({ success: false, error: "Invalid test identity." }, 400);
        }
        const sessionToken = await signSessionToken(env.ADMIN_SECRET_TOKEN, {
          sub, username, name: username, role, permissions: [],
          ...(role === "talent" ? { tokenVersion: 1 } : {})
        });
        return jsonOut({ success: true, sessionToken, identity: { sub, username, role } });
      }

      if (url.pathname === "/api/media/upload" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "media_upload", 20, 6e5)) return jsonOut({ success: false, error: "Terlalu banyak upload." }, 429);
        const body = stripDangerousKeys(await request.json().catch(() => ({})));
        const vActor = await verifySessionToken(env.ADMIN_SECRET_TOKEN, request.headers.get("X-Session-Token") || "");
        if (!roleAllowed(vActor, ["talent", "merch", "admin"])) return jsonOut({ success: false, error: "Akses upload ditolak." }, 403);
        const purpose = String(body.purpose || "");
        if (!["merch_product", "lounge", "profile"].includes(purpose)) {
          return jsonOut({ success: false, error: "Tujuan upload tidak valid." }, 400);
        }
        if (vActor.role === "merch" && purpose !== "merch_product") {
          return jsonOut({ success: false, error: "Merch hanya dapat mengunggah foto produk." }, 403);
        }
        if (vActor.role === "talent" && !["lounge", "profile"].includes(purpose)) {
          return jsonOut({ success: false, error: "Talent hanya dapat mengunggah media Lounge atau profil." }, 403);
        }
        if (vActor.role === "talent") {
          if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 503);
          const talentAccount = await env.DB.prepare("SELECT token_version FROM talent_accounts WHERE username = ?")
            .bind(vActor.username).first();
          if (!talentAccount || Number(talentAccount.token_version || 1) !== vActor.tokenVersion) {
            return jsonOut({ success: false, error: "Sesi Talent kedaluwarsa. Silakan login ulang." }, 401);
          }
        }
        if (!env.BUCKET) return jsonOut({ success: false, error: "Binding R2 (BUCKET) belum terpasang." }, 503);
        const mimeMatch = String(body.image || "").match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
        if (!mimeMatch) return jsonOut({ success: false, error: "Format gambar tidak valid." }, 400);
        const mime = mimeMatch[1] === "image/jpg" ? "image/jpeg" : mimeMatch[1];
        const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
        const binary = Uint8Array.from(atob(mimeMatch[2].replace(/\s+/g, "")), (c) => c.charCodeAt(0));
        if (binary.byteLength > 2621440) return jsonOut({ success: false, error: "Ukuran gambar maksimal 2.5 MB." }, 413);
        const prefix = purpose === "merch_product" ? "merch/products/"
          : purpose === "profile" ? "avatars/"
            : "stories/";
        const ownerPrefix = vActor.role === "talent"
          ? prefix + normalizeUsername(vActor.username) + "_"
          : prefix;
        const key = ownerPrefix + Date.now() + "_" + toHex(crypto.getRandomValues(new Uint8Array(8))) + "." + ext;
        await env.BUCKET.put(key, binary, { httpMetadata: { contentType: mime } });
        return jsonOut({ success: true, key, url: url.origin + "/r2/" + key });
      }

      if (url.pathname === "/api/lounge/story/create" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "story_create", 12, 6e5)) return jsonOut({ success: false, error: "Terlalu banyak upload story." }, 429);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 500);
        await ensureTableExists();
        const body = stripDangerousKeys(await request.json().catch(() => ({})));
        const vActor = await verifySessionToken(env.ADMIN_SECRET_TOKEN, request.headers.get("X-Session-Token") || "");
        const isDeveloper = Boolean(vActor && vActor.role === "developer");
        if (!isDeveloper && (!vActor || vActor.role !== "talent")) return jsonOut({ success: false, error: "Hanya Talent yang dapat membuat story." }, 403);
        let talentAccount = null;
        if (vActor && vActor.role === "talent") {
          talentAccount = await env.DB.prepare("SELECT token_version, name FROM talent_accounts WHERE username = ?").bind(vActor.username).first();
          if (!talentAccount || Number(talentAccount.token_version || 1) !== vActor.tokenVersion) return jsonOut({ success: false, error: "Sesi kedaluwarsa. Silakan login ulang." }, 401);
        }
        const ownerUsername = normalizeUsername(vActor && vActor.role === "talent" ? vActor.username : (vActor && vActor.username) || "developer");
        const image = safeLoungeImage(body.image, env.R2_PUBLIC_URL);
        if (!ownerUsername || !image) return jsonOut({ success: false, error: "Data story tidak valid." }, 400);
        const row = await env.DB.prepare("SELECT posts, stories FROM lounge_store WHERE id = 1").first();
        let curPosts = [], curStories = [];
        if (row) { try { curPosts = JSON.parse(row.posts || "[]"); } catch (_) {} try { curStories = JSON.parse(row.stories || "[]"); } catch (_) {} }
        const now = Date.now();
        const active = (Array.isArray(curStories) ? curStories : []).filter((st) => st && (!st.createdAt || now - Number(st.createdAt) < 864e5));
        const todayKey = new Date(now + 7 * 3600 * 1e3).toISOString().slice(0, 10);
        const ownCount = active.filter((st) => normalizeUsername(st.ownerUsername) === ownerUsername && (st.dateKey === todayKey || now - Number(st.createdAt || 0) < 864e5)).length;
        if (ownCount >= 3 && !isDeveloper) return jsonOut({ success: false, error: "Kuota harian maksimal 3 story." }, 429);
        const storyId = cleanLoungeText(body.id || "ust_" + now, 64).replace(/[^a-zA-Z0-9_-]/g, "") || "ust_" + now;
        const newStory = {
          id: storyId,
          ownerUsername,
          ownerName: cleanLoungeText((talentAccount && talentAccount.name) || body.ownerName || ownerUsername, 60),
          color: "#ff2a5f",
          image,
          caption: cleanLoungeText(body.caption || "", 180),
          createdAt: now,
          dateKey: todayKey,
          qcStatus: isDeveloper ? "approved" : "pending"
        };
        const nextStories = [...active, newStory].slice(-60);
        await env.DB.prepare("INSERT INTO lounge_store (id, posts, stories, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET stories = excluded.stories, updated_at = excluded.updated_at").bind(JSON.stringify(curPosts), JSON.stringify(nextStories), new Date(now).toISOString()).run();
        return jsonOut({ success: true, story: newStory, countStories: nextStories.length });
      }

      if (url.pathname === "/api/lounge/story/qc" && request.method === "POST") {
        const actor = await getActor();
        if (!roleAllowed(actor, ["admin"])) return jsonOut({ success: false, error: "Akses ditolak." }, 403);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 503);
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const storyId = sanitizeText(body.storyId || body.id || "", 64);
        const action = body.action === "approved" || body.action === "approve"
          ? "approved"
          : body.action === "rejected" || body.action === "reject"
            ? "rejected"
            : body.action === "delete" || body.action === "deleted"
              ? "delete"
            : "";
        if (!storyId || !action) return jsonOut({ success: false, error: "Story dan status QC wajib diisi." }, 400);
        const row = await env.DB.prepare("SELECT posts, stories FROM lounge_store WHERE id = 1").first();
        let posts = [], stories = [];
        if (row) {
          try { posts = JSON.parse(row.posts || "[]"); } catch (_) {}
          try { stories = JSON.parse(row.stories || "[]"); } catch (_) {}
        }
        const target = Array.isArray(stories) ? stories.find((story) => story && String(story.id) === storyId) : null;
        if (!target) return jsonOut({ success: false, error: "Story tidak ditemukan." }, 404);
        const updatedStories = action === "delete"
          ? stories.filter((story) => !story || String(story.id) !== storyId)
          : stories.map((story) => story && String(story.id) === storyId
            ? Object.assign({}, story, { qcStatus: action })
            : story);
        await env.DB.prepare(
          "INSERT INTO lounge_store (id, posts, stories, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET stories = excluded.stories, updated_at = excluded.updated_at"
        ).bind(JSON.stringify(posts), JSON.stringify(updatedStories), new Date().toISOString()).run();
        return jsonOut({
          success: true,
          deleted: action === "delete",
          story: updatedStories.find((story) => story && String(story.id) === storyId) || null
        });
      }

      if (url.pathname === "/api/lounge/post/delete" && request.method === "POST") {
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 500);
        await ensureTableExists();
        const sTok = request.headers.get("X-Session-Token") || "";
        const actor = await verifySessionToken(env.ADMIN_SECRET_TOKEN, sTok);
        const isDeveloper = roleAllowed(actor, ["admin"]);
        if (!isDeveloper && (!actor || actor.role !== "talent" || !actor.username)) {
          return new Response(JSON.stringify({ success: false, error: "Sesi tidak valid. Silakan login ulang." }), {
            status: 401, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (actor && actor.role === "talent") {
          const account = await env.DB.prepare("SELECT token_version FROM talent_accounts WHERE username = ?").bind(actor.username).first();
          if (!account || Number(account.token_version || 1) !== actor.tokenVersion) return jsonOut({ success: false, error: "Sesi kedaluwarsa. Silakan login ulang." }, 401);
        }
        const body = await request.json().catch(() => ({}));
        const postId = String(body.postId || body.id || "").trim();
        if (!postId) {
          return new Response(JSON.stringify({ success: false, error: "ID postingan tidak ditemukan." }), {
            status: 400, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        const row = await env.DB.prepare("SELECT posts FROM lounge_store WHERE id = 1").first();
        let curPosts = [];
        if (row && row.posts) { try { curPosts = JSON.parse(row.posts); } catch (_) {} }
        if (!Array.isArray(curPosts)) curPosts = [];
        const target = curPosts.find(p => String(p.id) === postId);
        if (!target) {
          return new Response(JSON.stringify({ success: true, deleted: true, alreadyGone: true }), {
            status: 200, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!isDeveloper && !isOwnedLoungePost(target, actor.username)) {
          return new Response(JSON.stringify({ success: false, error: "Akses ditolak: hanya pemilik postingan yang dapat menghapus." }), {
            status: 403, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        const nextPosts = curPosts.filter(p => String(p.id) !== postId);
        await env.DB.prepare("UPDATE lounge_store SET posts = ? WHERE id = 1").bind(JSON.stringify(nextPosts)).run();
        // Bersihkan media di R2 storage jika ada agar tidak memakan ruang
        try {
          const r2 = env.MEDIA_BUCKET || env.R2_BUCKET || env.BUCKET;
          const mediaUrls = [target.media, target.image, target.video, target.mediaUrl].filter(u => typeof u === "string" && u.length > 0);
          if (r2 && typeof r2.delete === "function") {
            for (const u of mediaUrls) {
              const m = u.match(/\/(?:media|r2|uploads?)\/([^?#]+)/i);
              if (m && m[1]) { await r2.delete(decodeURIComponent(m[1])).catch(() => {}); }
            }
          }
        } catch (_) {}
        return new Response(JSON.stringify({ success: true, deleted: true, postId }), {
          status: 200, headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      if (url.pathname === "/api/lounge/story/delete" && request.method === "POST") {
        if (!checkMemoryRate(clientIp, "story_delete", 20, 6e5)) return jsonOut({ success: false, error: "Terlalu banyak permintaan." }, 429);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 500);
        await ensureTableExists();
        const body = stripDangerousKeys(await request.json().catch(() => ({})));
        const vActor = await verifySessionToken(env.ADMIN_SECRET_TOKEN, request.headers.get("X-Session-Token") || "");
        const isDeveloper = roleAllowed(vActor, ["admin"]);
        if (!isDeveloper && (!vActor || vActor.role !== "talent")) return jsonOut({ success: false, error: "Hanya Talent yang dapat menghapus story." }, 403);
        if (vActor && vActor.role === "talent") {
          const account = await env.DB.prepare("SELECT token_version FROM talent_accounts WHERE username = ?").bind(vActor.username).first();
          if (!account || Number(account.token_version || 1) !== vActor.tokenVersion) return jsonOut({ success: false, error: "Sesi kedaluwarsa. Silakan login ulang." }, 401);
        }
        const actorUsername = normalizeUsername(vActor && vActor.username);
        const targetId = sanitizeText(body.id || "", 80);
        if (!targetId || (!isDeveloper && !actorUsername)) return jsonOut({ success: false, error: "ID story dan sesi pemilik wajib diisi." }, 400);
        const row = await env.DB.prepare("SELECT posts, stories FROM lounge_store WHERE id = 1").first();
        let curPosts = [], curStories = [];
        if (row) { try { curPosts = JSON.parse(row.posts || "[]"); } catch (_) {} try { curStories = JSON.parse(row.stories || "[]"); } catch (_) {} }
        if (!Array.isArray(curPosts)) curPosts = [];
        if (!Array.isArray(curStories)) curStories = [];
        const matched = curStories.find((st) => st && String(st.id) === targetId);
        if (!matched) return jsonOut({ success: true, deletedId: targetId, note: "Story sudah terhapus." });
        if (!isDeveloper && normalizeUsername(matched.ownerUsername) !== actorUsername) return jsonOut({ success: false, error: "Forbidden: Hanya bisa menghapus story milik sendiri." }, 403);
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
        if (!roleAllowed(vActor, ["consumer", "talent", "admin"])) return jsonOut({ success: false, error: "Unauthorized: Sesi tidak valid." }, 401);
        const requestedUsername = normalizeUsername(body.username);
        const username = normalizeUsername(vActor ? vActor.username : requestedUsername);
        if (requestedUsername && requestedUsername !== username) return jsonOut({ success: false, error: "Forbidden: Identitas profil tidak cocok." }, 403);
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
        const guestToken = await signSessionToken(env.ADMIN_SECRET_TOKEN, {
          sub: "guest:" + toHex(crypto.getRandomValues(new Uint8Array(16))),
          username: "",
          role: "guest",
          permissions: []
        }, 15 * 60 * 1000);
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
        const developer = await getActor();
        if (!developer || developer.role !== "developer") {
          await recordAuthFailure("admin_auth");
          await new Promise((r) => setTimeout(r, 1500));
          return new Response(JSON.stringify({ success: false, error: "PIN atau Token tidak valid!" }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        await clearAuthFailure("admin_auth");
        const adminSessionToken = request.headers.get("X-Session-Token");
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
        const actor = await getActor();
        if (!actor || actor.role !== "developer") {
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
        const actor = await getActor();
        if (!actor || actor.role !== "developer") {
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
        const actor = await getActor();
        if (!actor || actor.role !== "developer") {
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
        let talentSubject = await env.DB.prepare("SELECT id FROM talent_subjects WHERE username = ?").bind(row.username).first();
        if (!talentSubject) {
          const generatedId = toHex(crypto.getRandomValues(new Uint8Array(12)));
          await env.DB.prepare("INSERT INTO talent_subjects (username, id, created_at) VALUES (?, ?, ?) ON CONFLICT(username) DO NOTHING")
            .bind(row.username, generatedId, new Date().toISOString()).run();
          talentSubject = await env.DB.prepare("SELECT id FROM talent_subjects WHERE username = ?").bind(row.username).first();
        }
        if (!talentSubject) return jsonOut({ success: false, error: "Gagal menginisialisasi identitas talent." }, 500);
        const sessionToken = await signSessionToken(env.ADMIN_SECRET_TOKEN, {
          sub: "talent:" + talentSubject.id,
          username: row.username,
          name: row.name,
          role: "talent",
          permissions: [],
          tokenVersion: tokVer
        });

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
        if (!verifiedActor || (verifiedActor.role !== "talent" && verifiedActor.role !== "developer")) {
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

        const talentSubject = await env.DB.prepare("SELECT id FROM talent_subjects WHERE username = ?").bind(uname).first();
        if (!talentSubject) return jsonOut({ success: false, error: "Identitas talent tidak ditemukan." }, 500);
        const sessionToken = await signSessionToken(env.ADMIN_SECRET_TOKEN, {
          sub: "talent:" + talentSubject.id,
          username: row.username,
          name: row.name,
          role: "talent",
          permissions: [],
          tokenVersion: nextTokVer
        });
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
        const actor = await verifySessionToken(env.ADMIN_SECRET_TOKEN, request.headers.get("X-Session-Token") || "");
        const canReviewStories = roleAllowed(actor, ["admin"]);
        const activeStories = Array.isArray(stories)
          ? stories.filter((st) => {
              if (!st || (st.createdAt && now - Number(st.createdAt) >= 86400000)) return false;
              const status = st.qcStatus || "approved";
              return status === "approved" || canReviewStories ||
                (actor && actor.role === "talent" && status === "pending" && normalizeUsername(st.ownerUsername) === normalizeUsername(actor.username));
            })
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
        const isDeveloper = Boolean(verifiedActor && verifiedActor.role === "developer");
        if (!isDeveloper && (!verifiedActor || verifiedActor.role !== "talent")) {
          return new Response(JSON.stringify({ success: false, error: "Unauthorized: Token sesi HMAC tidak valid." }), {
            status: 403,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        // Jika token milik talent, pastikan token_version masih cocok dengan D1 (belum di-revoke)
        let talentRow = null;
        if (verifiedActor && verifiedActor.role === "talent") {
          talentRow = await env.DB.prepare("SELECT token_version, name FROM talent_accounts WHERE username = ?")
            .bind(verifiedActor.username).first();
          if (!talentRow || Number(talentRow.token_version || 1) !== verifiedActor.tokenVersion) {
            return new Response(JSON.stringify({ success: false, error: "Sesi kedaluwarsa. Silakan login ulang." }), {
              status: 401,
              headers: { ...securityHeaders, "Content-Type": "application/json" }
            });
          }
        }

        const actorUsername = normalizeUsername(verifiedActor && verifiedActor.username);
        if (!isDeveloper && !actorUsername) return jsonOut({ success: false, error: "Sesi Talent tidak memiliki identitas." }, 401);
        if (!isDeveloper && (!talentRow || Number(talentRow.token_version || 1) !== verifiedActor.tokenVersion)) {
          return jsonOut({ success: false, error: "Sesi kedaluwarsa. Silakan login ulang." }, 401);
        }

        const row = await env.DB.prepare("SELECT posts, stories FROM lounge_store WHERE id = 1").first();
        let curPosts = [];
        let curStories = [];
        if (row) {
          try { curPosts = JSON.parse(row.posts || "[]"); } catch (_) {}
          try { curStories = JSON.parse(row.stories || "[]"); } catch (_) {}
        }
        if (!Array.isArray(curPosts)) curPosts = [];
        if (!Array.isArray(curStories)) curStories = [];

        const now = Date.now();
        const rawPosts = Array.isArray(body.posts) ? body.posts.slice(0, 120) : curPosts;
        const sanitizePost = (post, ownerName) => {
          if (!post || typeof post !== "object") return null;
          const id = cleanLoungeText(post.id || "", 64).replace(/[^a-zA-Z0-9_-]/g, "");
          if (!id) return null;
          const replies = Array.isArray(post.replies) ? post.replies.slice(0, 100).map((reply) => ({
            author: cleanLoungeText(reply && reply.author, 60),
            text: cleanLoungeText(reply && reply.text, 500)
          })) : [];
          return {
            id,
            ownerUsername: isDeveloper ? normalizeUsername(post.ownerUsername || post.username || post.handle) : actorUsername,
            username: isDeveloper ? normalizeUsername(post.username || post.ownerUsername || post.handle) : actorUsername,
            authorHandle: isDeveloper ? cleanLoungeText(post.authorHandle || post.handle || "", 44) : "@" + actorUsername,
            author: isDeveloper ? cleanLoungeText(post.author || "User", 60) : ownerName,
            handle: isDeveloper ? cleanLoungeText(post.handle || "", 44) : "@" + actorUsername,
            role: isDeveloper ? cleanLoungeText(post.role || "", 24) : "TALENT",
            time: cleanLoungeText(post.time || "", 80),
            text: cleanLoungeText(post.text || "", 5000),
            image: safeLoungeImage(post.image, env.R2_PUBLIC_URL),
            likes: Math.max(0, Math.min(1000000, Math.round(Number(post.likes) || 0))),
            liked: post.liked === true,
            allowReply: post.allowReply !== false,
            replies
          };
        };
        let incomingPosts;
        let rawStories;
        if (isDeveloper) {
          incomingPosts = rawPosts.map((post) => sanitizePost(post, "")).filter(Boolean);
          rawStories = Array.isArray(body.stories) ? body.stories : curStories;
        } else {
          const ownPosts = rawPosts.filter((post) => isOwnedLoungePost(post, actorUsername));
          const otherPosts = curPosts.filter((post) => !isOwnedLoungePost(post, actorUsername));
          const otherPostIds = new Set(otherPosts.map((post) => String(post && post.id || "")));
          const safeOwnPosts = ownPosts
            .filter((post) => !otherPostIds.has(String(post && post.id || "")))
            .map((post) => sanitizePost(post, talentRow.name))
            .filter(Boolean);
          incomingPosts = [...safeOwnPosts, ...otherPosts].slice(0, 120);
          rawStories = Array.isArray(body.stories) ? body.stories : curStories;
        }

        const activeStories = (Array.isArray(curStories) ? curStories : [])
          .filter((story) => story && (!story.createdAt || now - Number(story.createdAt) < 86400000));
        let nextStories;
        if (isDeveloper) {
          nextStories = rawStories
            .filter((story) => story && (!story.createdAt || now - Number(story.createdAt) < 86400000))
            .slice(0, 60)
            .map((story) => {
              const qcStatus = ["pending", "approved", "rejected"].includes(story.qcStatus) ? story.qcStatus : "approved";
              return {
                id: cleanLoungeText(story.id || "", 64).replace(/[^a-zA-Z0-9_-]/g, ""),
                ownerUsername: normalizeUsername(story.ownerUsername),
                ownerName: cleanLoungeText(story.ownerName || "", 60),
                color: "#ff2a5f",
                image: safeLoungeImage(story.image, env.R2_PUBLIC_URL),
                caption: cleanLoungeText(story.caption || "", 180),
                createdAt: Number(story.createdAt) || now,
                dateKey: cleanLoungeText(story.dateKey || "", 10),
                qcStatus
              };
            })
            .filter((story) => story.id && story.image);
        } else {
          nextStories = activeStories;
        }

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
        if (!roleAllowed(verifiedActor, ["consumer", "admin"])) {
          return new Response(JSON.stringify({ success: false, error: "Unauthorized: Sesi order tidak valid." }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const orderId = sanitizeText(body.id || ("ORD-" + Math.floor(100000 + Math.random() * 900000)), 32);
        const custUser = normalizeUsername(verifiedActor.username);
        const custName = sanitizeText(verifiedActor.name || verifiedActor.username || "VIP Member", 60);
        const orderType = body.orderType === "merch" ? "merch" : "standard";
        const quantity = Math.max(1, Math.min(10, Math.round(Number(body.quantity) || 1)));
        let service = sanitizeText(body.service || "", 160);
        let amount = Math.max(0, Math.min(100000000, Number(body.amount || 0) || 0));
        const voucher = sanitizeText(body.voucher || "-", 32);
        const note = sanitizeText(body.note || "", 300);
        const status = "Menunggu Konfirmasi";
        const createdAt = new Date().toISOString();

        if (orderType === "merch") {
          const productId = sanitizeText(body.productId || "", 64);
          const product = await env.DB.prepare(
            "SELECT p.name, p.price, s.stock FROM merch_products p LEFT JOIN merch_stock_control s ON s.product_id = p.id WHERE p.id = ?"
          ).bind(productId).first();
          if (!product) return jsonOut({ success: false, error: "Produk Merch tidak ditemukan." }, 404);
          if (product.stock !== null && product.stock !== undefined && Number(product.stock) < quantity) {
            return jsonOut({ success: false, error: "Stok Merch tidak mencukupi." }, 409);
          }
          service = "Merch — " + sanitizeText(product.name, 100) + (quantity > 1 ? " × " + quantity : "");
          amount = Math.min(100000000, Number(product.price || 0) * quantity);
          body.productId = productId;
          body.stockManaged = product.stock !== null && product.stock !== undefined;
        }

        if (!service) {
          return new Response(JSON.stringify({ success: false, error: "Detail layanan/produk wajib diisi." }), {
            status: 400,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        if (orderType === "merch") {
          const productId = sanitizeText(body.productId || "", 64);
          const orderResults = body.stockManaged
            ? await env.DB.batch([
                env.DB.prepare(
                  "UPDATE merch_stock_control SET stock = stock - ?, updated_at = ? WHERE product_id = ? AND stock >= ? AND NOT EXISTS (SELECT 1 FROM orders_store WHERE id = ?)"
                ).bind(quantity, createdAt, productId, quantity, orderId),
                env.DB.prepare(
                  "INSERT INTO orders_store (id, customer_username, customer_name, service, amount, voucher, note, status, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1 ON CONFLICT(id) DO NOTHING"
                ).bind(orderId, custUser, custName, service, amount, voucher, note, status, createdAt),
                env.DB.prepare(
                  "INSERT INTO order_subject_links (order_id, subject, order_type, linked_at) SELECT ?, ?, 'merch', ? WHERE changes() = 1 ON CONFLICT(order_id) DO NOTHING"
                ).bind(orderId, verifiedActor.sub, createdAt)
              ])
            : await env.DB.batch([
                env.DB.prepare(
                  "INSERT INTO orders_store (id, customer_username, customer_name, service, amount, voucher, note, status, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM merch_stock_control WHERE product_id = ?) ON CONFLICT(id) DO NOTHING"
                ).bind(orderId, custUser, custName, service, amount, voucher, note, status, createdAt, productId),
                env.DB.prepare(
                  "INSERT INTO order_subject_links (order_id, subject, order_type, linked_at) SELECT ?, ?, 'merch', ? WHERE changes() = 1 ON CONFLICT(order_id) DO NOTHING"
                ).bind(orderId, verifiedActor.sub, createdAt)
              ]);
          if (Number(orderResults && orderResults[0] && orderResults[0].meta && orderResults[0].meta.changes || 0) !== 1) {
            return jsonOut({ success: false, error: "Stok berubah atau ID order sudah digunakan." }, 409);
          }
        } else {
          await env.DB.batch([
            env.DB.prepare(
              "INSERT INTO orders_store (id, customer_username, customer_name, service, amount, voucher, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING"
            ).bind(orderId, custUser, custName, service, amount, voucher, note, status, createdAt),
            env.DB.prepare(
              "INSERT INTO order_subject_links (order_id, subject, order_type, linked_at) SELECT ?, ?, 'standard', ? WHERE changes() = 1 ON CONFLICT(order_id) DO NOTHING"
            ).bind(orderId, verifiedActor.sub, createdAt)
          ]);
        }
        const linkedOrder = await env.DB.prepare("SELECT subject FROM order_subject_links WHERE order_id = ?").bind(orderId).first();
        if (!linkedOrder || linkedOrder.subject !== verifiedActor.sub) return jsonOut({ success: false, error: "ID order sudah digunakan." }, 409);

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

          telegramSent = await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            env.TELEGRAM_ADMIN_CHAT_ID,
            { text: textLines, parse_mode: "HTML" },
            "order_id",
            orderId
          );
        }

        return new Response(JSON.stringify({ success: true, orderId, telegramSent }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      // 11. Daftar Semua Order (Wajib Token Admin)
      if (url.pathname === "/api/orders/list" && request.method === "GET") {
        const actor = await getActor();
        if (!roleAllowed(actor, ["consumer", "admin", "merch", "talent"])) {
          return new Response(JSON.stringify({ success: false, error: "Akses ditolak: Token tidak sah" }), {
            status: 401,
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        let query = "SELECT o.id, o.customer_username, o.customer_name, o.service, o.amount, o.voucher, o.note, o.status, o.created_at, l.order_type, l.assigned_talent_subject FROM orders_store o LEFT JOIN order_subject_links l ON l.order_id = o.id";
        let bindValues = [];
        if (actor.role === "consumer") {
          query += " WHERE l.subject = ?";
          bindValues = [actor.sub];
        } else if (actor.role === "merch") {
          query += " WHERE COALESCE(l.order_type, CASE WHEN lower(COALESCE(o.service, '')) LIKE '%merch%' THEN 'merch' ELSE 'standard' END) = 'merch'";
        } else if (actor.role === "talent") {
          query += " WHERE l.assigned_talent_subject = ?";
          bindValues = [actor.sub];
        }
        query += " ORDER BY o.created_at DESC LIMIT 200";
        const res = await env.DB.prepare(query).bind(...bindValues).all();
        return new Response(JSON.stringify({
          success: true,
          readOnly: actor.role === "talent" || actor.role === "consumer",
          canAssign: actor.role === "admin" || actor.role === "developer",
          orders: (res && res.results) ? res.results : []
        }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      if (url.pathname === "/api/orders/manage" && request.method === "POST") {
        const actor = await getActor();
        if (!roleAllowed(actor, ["admin", "merch"])) return jsonOut({ success: false, error: "Akses ditolak." }, 403);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 503);
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const orderId = sanitizeText(body.orderId || "", 64);
        if (!orderId) return jsonOut({ success: false, error: "ID order wajib diisi." }, 400);
        const row = await env.DB.prepare(
          "SELECT o.id, o.service, l.order_type FROM orders_store o LEFT JOIN order_subject_links l ON l.order_id = o.id WHERE o.id = ?"
        ).bind(orderId).first();
        if (!row) return jsonOut({ success: false, error: "Order tidak ditemukan." }, 404);
        const orderType = row.order_type || (/merch/i.test(String(row.service || "")) ? "merch" : "standard");
        if (actor.role === "merch" && orderType !== "merch") return jsonOut({ success: false, error: "Merch hanya dapat mengelola order Merch." }, 403);
        const validStatuses = ["Menunggu Konfirmasi", "Diproses", "Lunas", "Selesai", "Dibatalkan", "Ditolak"];
        if (typeof body.status === "string" && validStatuses.includes(body.status)) {
          await env.DB.prepare("UPDATE orders_store SET status = ? WHERE id = ?").bind(body.status, orderId).run();
        }
        if (actor.role === "admin" || actor.role === "developer") {
          if (typeof body.talentSubject === "string") {
            const talentSubject = body.talentSubject.trim();
            if (talentSubject && !/^talent:[a-z0-9_-]+$/.test(talentSubject)) return jsonOut({ success: false, error: "Identitas talent tidak valid." }, 400);
            if (talentSubject) {
              const talent = await env.DB.prepare("SELECT 1 FROM talent_subjects WHERE id = ?")
                .bind(talentSubject.slice("talent:".length)).first();
              if (!talent) return jsonOut({ success: false, error: "Akun talent tidak ditemukan." }, 404);
            }
            await env.DB.prepare("UPDATE order_subject_links SET assigned_talent_subject = ? WHERE order_id = ?")
              .bind(talentSubject || null, orderId).run();
          }
        }
        return jsonOut({ success: true });
      }

      if (url.pathname === "/api/talent/subjects" && request.method === "GET") {
        const actor = await getActor();
        if (!roleAllowed(actor, ["admin"])) return jsonOut({ success: false, error: "Akses ditolak." }, 403);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 503);
        await ensureTableExists();
        const result = await env.DB.prepare(
          "SELECT s.id, s.username, t.name FROM talent_subjects s LEFT JOIN talent_accounts t ON t.username = s.username ORDER BY s.username"
        ).all();
        return jsonOut({ success: true, talents: (result.results || []).map((row) => ({
          subject: "talent:" + row.id,
          username: row.username,
          name: row.name || row.username
        })) });
      }

      if (url.pathname === "/api/merch/products" && request.method === "GET") {
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 503);
        await ensureTableExists();
        const result = await env.DB.prepare(
          "SELECT p.id, p.name, p.category, p.price, p.tag, p.image, p.description, s.stock, CASE WHEN s.product_id IS NULL THEN 0 ELSE 1 END AS stock_managed FROM merch_products p LEFT JOIN merch_stock_control s ON s.product_id = p.id ORDER BY p.name"
        ).all();
        return jsonOut({ success: true, products: result.results || [] });
      }

      if (url.pathname === "/api/merch/products" && request.method === "POST") {
        const actor = await getActor();
        if (!roleAllowed(actor, ["admin", "merch"])) return jsonOut({ success: false, error: "Akses ditolak." }, 403);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 503);
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const id = sanitizeText(body.id || "", 64);
        const name = sanitizeText(body.name || "", 100);
        const category = sanitizeText(body.category || "merch", 40);
        const price = Math.max(0, Math.min(100000000, Math.round(Number(body.price) || 0)));
        const stockProvided = Object.prototype.hasOwnProperty.call(body, "stock") && body.stock !== null && body.stock !== "";
        const stock = stockProvided ? Number(body.stock) : null;
        if (stockProvided && (!Number.isInteger(stock) || stock < 0 || stock > 1000000)) {
          return jsonOut({ success: false, error: "Stok produk tidak valid." }, 400);
        }
        const image = safeLoungeImage(body.image, env.R2_PUBLIC_URL) || "";
        const description = sanitizeText(body.description || body.desc || "", 1000);
        if (!id || !name || price <= 0) return jsonOut({ success: false, error: "Data produk tidak valid." }, 400);
        await env.DB.prepare(
          "INSERT INTO merch_products (id, name, category, price, tag, image, description, stock, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category, price = excluded.price, tag = excluded.tag, image = excluded.image, description = excluded.description, updated_at = excluded.updated_at, updated_by = excluded.updated_by"
        ).bind(id, name, category, price, sanitizeText(body.tag || "OFFICIAL", 40), image, description, new Date().toISOString(), actor.sub).run();
        if (stockProvided) {
          await env.DB.prepare(
            "INSERT INTO merch_stock_control (product_id, stock, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET stock = excluded.stock, updated_at = excluded.updated_at, updated_by = excluded.updated_by"
          ).bind(id, stock, new Date().toISOString(), actor.sub).run();
        } else {
          await env.DB.prepare("DELETE FROM merch_stock_control WHERE product_id = ?").bind(id).run();
        }
        return jsonOut({ success: true });
      }

      if (url.pathname === "/api/merch/products/delete" && request.method === "POST") {
        const actor = await getActor();
        if (!roleAllowed(actor, ["admin", "merch"])) return jsonOut({ success: false, error: "Akses ditolak." }, 403);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 503);
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const id = sanitizeText(body.id || "", 64);
        if (!id) return jsonOut({ success: false, error: "ID produk wajib diisi." }, 400);
        const result = await env.DB.prepare("DELETE FROM merch_products WHERE id = ?").bind(id).run();
        return jsonOut({ success: true, deleted: Number(result.meta && result.meta.changes || 0) > 0 });
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
        const actor = await getActor();
        if (!roleAllowed(actor, ["consumer", "admin"])) return jsonOut({ success: false, error: "Akses wallet ditolak." }, 403);
        const subject = actor.role === "consumer"
          ? actor.sub
          : String(url.searchParams.get("subject") || actor.sub).trim();
        if ((!/^tg:[0-9]+$/.test(subject) && !/^cn:cn_[a-f0-9]{12}$/.test(subject)) ||
            (actor.role === "consumer" && subject !== actor.sub)) {
          return jsonOut({ success: false, error: "Subjek wallet tidak valid." }, 400);
        }
        const row = await env.DB.prepare("SELECT balance, updated_at FROM wallet_subject_balances WHERE subject = ?").bind(subject).first();
        return new Response(JSON.stringify({
          success: true,
          subject,
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
        if (!roleAllowed(verifiedActor, ["consumer", "admin"])) {
          return new Response(JSON.stringify({ success: false, error: "Unauthorized: Sesi tidak valid." }), {
            status: 401, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const targetSubject = verifiedActor.sub;
        const actorUser = normalizeUsername(verifiedActor.username);
        if (!actorUser || (!/^tg:[0-9]+$/.test(targetSubject) && !/^cn:cn_[a-f0-9]{12}$/.test(targetSubject))) {
          return jsonOut({ success: false, error: "Identitas target tidak valid." }, 400);
        }

        const baseAmount = Math.max(5000, Math.min(50000000, Math.round(Number(body.baseAmount || 0))));
        const mode = body.mode === "booking" ? "booking" : "topup";
        const service = sanitizeText(body.service || "Top-Up Saldo CN Wallet", 160);
        const now = Date.now();

        // Batalkan intent PENDING sebelumnya milik user yang sama (Anti-Spam / Anti-Exhaustion kode unik)
        await env.DB.prepare(
          "UPDATE wallet_intents SET status = 'SUPERSEDED' WHERE subject = ? AND status = 'PENDING'"
        ).bind(targetSubject).run();

        // Bersihkan intent kedaluwarsa (> 45 menit)
        await env.DB.prepare(
          "UPDATE wallet_intents SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < ?"
        ).bind(now).run();

        // Pilih kode unik 1..499 yang tidak bertabrakan dengan intent aktif nominal dasar sama
        const activeRows = await env.DB.prepare(
          "SELECT unique_code FROM wallet_intents WHERE status = 'PENDING' AND base_amount = ?"
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
          "INSERT INTO wallet_intents (id, subject, username, base_amount, unique_code, total_amount, mode, service, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)"
        ).bind(intentId, targetSubject, actorUser, baseAmount, uniqueCode, totalAmount, mode, service, expiresAt, new Date(now).toISOString()).run();

        // Kirim notifikasi approval ketat ke Telegram Admin
        if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_ADMIN_CHAT_ID) {
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
          await sendTelegramMessage(
            env.TELEGRAM_BOT_TOKEN,
            env.TELEGRAM_ADMIN_CHAT_ID,
            {
              text: msgText,
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[
                  { text: "✅ Approve Saldo", callback_data: "qris_ok:" + intentId + ":" + targetSubject },
                  { text: "❌ Tolak", callback_data: "qris_no:" + intentId + ":" + targetSubject }
                ]]
              }
            },
            "intent_id",
            intentId
          );
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
        const update = await request.json().catch(() => null);
        const cb = update && update.callback_query;
        const rejectCallback = async (reason) => {
          console.warn("Telegram webhook rejected:", reason);
          const callbackId = String(cb && cb.id || "").slice(0, 256);
          if (callbackId && env.TELEGRAM_BOT_TOKEN) {
            try {
              const ackResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  callback_query_id: callbackId,
                  text: "Aksi ditolak. Hubungi administrator.",
                  show_alert: true
                })
              });
              const ackResult = await ackResponse.json().catch(() => null);
              if (!ackResponse.ok || !ackResult || ackResult.ok !== true) {
                console.warn("Telegram callback rejection acknowledgement failed.");
              }
            } catch (_) {
              console.warn("Telegram callback rejection acknowledgement failed.");
            }
          }
          return new Response("Forbidden", { status: 403 });
        };
        const expectedSecret = (env.TELEGRAM_WEBHOOK_SECRET || "").trim();
        const incomingSecret = (request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "").trim();
        if (!expectedSecret) return rejectCallback("secret_not_configured");
        if (incomingSecret !== expectedSecret) return rejectCallback("secret_token_mismatch");
        if (!cb || !cb.data) return new Response("OK", { status: 200 });

        const adminChatId = String(env.TELEGRAM_ADMIN_CHAT_ID || "").trim();
        const fromId = String(cb.from?.id || "");
        const chatId = String(cb.message?.chat?.id || "");
        const approverIds = new Set(
          [env.OWNER_TELEGRAM_IDS, env.ADMIN_QC_TELEGRAM_IDS]
            .flatMap((ids) => String(ids || "").split(","))
            .map((id) => id.trim())
            .filter(Boolean)
        );
        if (!adminChatId) return rejectCallback("admin_chat_not_configured");
        if (chatId !== adminChatId) return rejectCallback("chat_id_mismatch");
        if (!approverIds.has(fromId)) return rejectCallback("sender_not_allowlisted");

        const parts = String(cb.data).split(":");
        const action = parts.shift();
        const targetId = parts.shift();
        const callbackSubject = parts.join(":");
        if ((action !== "qris_ok" && action !== "qris_no") || !targetId) return new Response("OK", { status: 200 });

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

        if (!callbackSubject) {
          if (!env.DB) return new Response("Unavailable", { status: 503 });
          await ensureTableExists();
          if (action === "qris_no") {
            const result = await env.DB.prepare(
              "UPDATE qris_intents SET status = 'REJECTED' WHERE id = ? AND status = 'PENDING'"
            ).bind(targetId).run();
            if (Number(result && result.meta && result.meta.changes || 0) > 0) {
              await answerCb("❌ Transaksi legacy ditolak.");
              await editMsg("❌ DITOLAK oleh Admin (" + new Date().toISOString() + ")");
            } else {
              await answerCb("⚠️ Intent legacy sudah diproses atau tidak ditemukan.");
            }
            return new Response("OK", { status: 200 });
          }
          const legacyResult = await approveLegacyQrisIntent(targetId, "telegram:approval");
          if (!legacyResult.found) {
            await answerCb("Intent legacy tidak ditemukan.");
          } else if (legacyResult.processed) {
            await answerCb("✅ Saldo Rp " + legacyResult.amount.toLocaleString("id-ID") + " masuk ke @" + legacyResult.intent.username);
            await editMsg("✅ APPROVED • Top-up legacy Rp " + legacyResult.amount.toLocaleString("id-ID") + " masuk (" + new Date().toISOString() + ")");
          } else {
            await answerCb("⚠️ Intent legacy sudah diproses (" + legacyResult.status + ").");
          }
          return new Response("OK", { status: 200 });
        }

        if (!env.DB) return new Response("Unavailable", { status: 503 });
        await ensureTableExists();
        const intent = await env.DB.prepare("SELECT * FROM wallet_intents WHERE id = ? AND subject = ?").bind(targetId, callbackSubject).first();
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
          await env.DB.prepare("UPDATE wallet_intents SET status = 'REJECTED' WHERE id = ? AND subject = ? AND status = 'PENDING'").bind(targetId, callbackSubject).run();
          await answerCb("❌ Transaksi ditolak.");
          await editMsg("❌ DITOLAK oleh Admin (" + nowIso + ")");
          return new Response("OK", { status: 200 });
        }

        // Atomic Approve & Credit Saldo (Anti-Double Credit)
        const approvalResults = await env.DB.batch([
          env.DB.prepare(
            "UPDATE wallet_intents SET status = 'PAID', paid_at = ? WHERE id = ? AND subject = ? AND status = 'PENDING'"
          ).bind(nowIso, targetId, callbackSubject),
          env.DB.prepare(
            "INSERT INTO wallet_subject_balances (subject, balance, updated_at) SELECT subject, base_amount, ? FROM wallet_intents WHERE id = ? AND subject = ? AND status = 'PAID' AND changes() = 1 ON CONFLICT(subject) DO UPDATE SET balance = wallet_subject_balances.balance + excluded.balance, updated_at = excluded.updated_at"
          ).bind(nowIso, targetId, callbackSubject),
          env.DB.prepare(
            "INSERT INTO wallet_transactions (id, subject, username, amount, transaction_type, reference, actor_subject, created_at) SELECT ?, subject, username, base_amount, 'topup_telegram', id, 'telegram:approval', ? FROM wallet_intents WHERE id = ? AND subject = ? AND status = 'PAID' AND changes() = 1 ON CONFLICT(id) DO NOTHING"
          ).bind("topup:" + targetId, nowIso, targetId, callbackSubject)
        ]);
        const upd = approvalResults && approvalResults[0];

        if (upd?.meta?.changes > 0) {
          const creditAmount = Number(intent.base_amount || intent.total_amount || 0);
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
        if (!roleAllowed(verifiedActor, ["consumer", "admin"])) {
          return new Response(JSON.stringify({ success: false, error: "Unauthorized: Sesi pembayaran tidak valid." }), {
            status: 401, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const subject = verifiedActor.sub;
        if (!/^tg:[0-9]+$/.test(subject) && !/^cn:cn_[a-f0-9]{12}$/.test(subject)) {
          return jsonOut({ success: false, error: "Subjek wallet tidak valid." }, 400);
        }
        const amount = Math.max(1, Math.min(50000000, Math.round(Number(body.amount || 0))));

        if (!subject || amount <= 0) {
          return new Response(JSON.stringify({ success: false, error: "Nominal transaksi tidak valid" }), {
            status: 400, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        // Atomic debit di D1: hanya berhasil jika saldo >= amount (anti race-condition / double spend)
        const now = new Date().toISOString();
        const txId = "spend:" + toHex(crypto.getRandomValues(new Uint8Array(12)));
        const debitResults = await env.DB.batch([
          env.DB.prepare(
            "UPDATE wallet_subject_balances SET balance = balance - ?, updated_at = ? WHERE subject = ? AND balance >= ?"
          ).bind(amount, now, subject, amount),
          env.DB.prepare(
            "INSERT INTO wallet_transactions (id, subject, username, amount, transaction_type, reference, actor_subject, created_at) SELECT ?, ?, ?, ?, 'spend', ?, ?, ? WHERE changes() = 1"
          ).bind(txId, subject, normalizeUsername(verifiedActor.username), -amount, sanitizeText(body.service || "", 160), verifiedActor.sub, now)
        ]);
        const debitRes = debitResults && debitResults[0];

        if (!debitRes || !debitRes.meta || Number(debitRes.meta.changes || 0) !== 1) {
          const row = await env.DB.prepare("SELECT balance FROM wallet_subject_balances WHERE subject = ?").bind(subject).first();
          return new Response(JSON.stringify({
            success: false,
            error: "Saldo CN Wallet tidak mencukupi",
            balance: row ? Number(row.balance || 0) : 0
          }), {
            status: 402, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const updatedRow = await env.DB.prepare("SELECT balance FROM wallet_subject_balances WHERE subject = ?").bind(subject).first();
        return new Response(JSON.stringify({
          success: true,
          subject,
          balance: updatedRow ? Number(updatedRow.balance || 0) : 0
        }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      if (url.pathname === "/api/wallet/adjust" && request.method === "POST") {
        const actor = await getActor();
        if (!roleAllowed(actor, ["admin"])) return jsonOut({ success: false, error: "Akses ditolak." }, 403);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 503);
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const identity = await resolveWalletSubject(body.subject || body.username || "");
        if (!identity || identity.ambiguous || !identity.subject) {
          return jsonOut({
            success: false,
            error: identity && identity.ambiguous
              ? "Username terhubung ke beberapa akun; gunakan subject yang tepat."
              : "Subjek atau username konsumen tidak ditemukan."
          }, identity && identity.ambiguous ? 409 : 404);
        }
        const subject = identity.subject;
        const delta = Math.round(Number(body.delta) || 0);
        const reference = String(body.reference || "").trim();
        const reason = sanitizeText(body.reason || "", 240);
        if ((!/^tg:[0-9]+$/.test(subject) && !/^cn:cn_[a-f0-9]{12}$/.test(subject)) ||
            !Number.isSafeInteger(delta) || !delta || Math.abs(delta) > 50000000 ||
            !/^[A-Za-z0-9._:-]{3,120}$/.test(reference) || reason.length < 3) {
          return jsonOut({ success: false, error: "Nominal, referensi, dan alasan wajib valid." }, 400);
        }
        const now = new Date().toISOString();
        const transactionId = "staff-adjust:" + subject + ":" + reference;
        const results = await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO wallet_subject_balances (subject, balance, updated_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM wallet_admin_adjustments WHERE subject = ? AND reference = ?) AND (? > 0 OR EXISTS (SELECT 1 FROM wallet_subject_balances WHERE subject = ? AND balance + ? >= 0)) ON CONFLICT(subject) DO UPDATE SET balance = wallet_subject_balances.balance + excluded.balance, updated_at = excluded.updated_at WHERE wallet_subject_balances.balance + excluded.balance >= 0"
          ).bind(subject, delta, now, subject, reference, delta, subject, delta),
          env.DB.prepare(
            "INSERT INTO wallet_admin_adjustments (subject, reference, username, amount, reason, actor_subject, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1 ON CONFLICT(subject, reference) DO NOTHING"
          ).bind(subject, reference, identity.username || "", delta, reason, actor.sub, now),
          env.DB.prepare(
            "INSERT INTO wallet_transactions (id, subject, username, amount, transaction_type, reference, actor_subject, created_at) SELECT ?, ?, ?, ?, 'admin_adjustment', ?, ?, ? WHERE EXISTS (SELECT 1 FROM wallet_admin_adjustments WHERE subject = ? AND reference = ?) AND NOT EXISTS (SELECT 1 FROM wallet_transactions WHERE id = ?) ON CONFLICT(id) DO NOTHING"
          ).bind(transactionId, subject, identity.username || "", delta, reference, actor.sub, now, subject, reference, transactionId)
        ]);
        if (Number(results && results[0] && results[0].meta && results[0].meta.changes || 0) !== 1) {
          const prior = await env.DB.prepare(
            "SELECT amount FROM wallet_admin_adjustments WHERE subject = ? AND reference = ?"
          ).bind(subject, reference).first();
          if (prior) {
            const current = await env.DB.prepare("SELECT balance FROM wallet_subject_balances WHERE subject = ?").bind(subject).first();
            return jsonOut({ success: true, alreadyApplied: true, subject, balance: Number(current && current.balance || 0) });
          }
          return jsonOut({ success: false, error: "Saldo tidak mencukupi." }, 402);
        }
        const balance = await env.DB.prepare("SELECT balance FROM wallet_subject_balances WHERE subject = ?").bind(subject).first();
        return jsonOut({ success: true, subject, reference, balance: Number(balance && balance.balance || 0) });
      }

      if (url.pathname === "/api/wallet/lookup" && request.method === "GET") {
        const actor = await getActor();
        if (!roleAllowed(actor, ["admin"])) return jsonOut({ success: false, error: "Akses ditolak." }, 403);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 503);
        await ensureTableExists();
        const query = String(url.searchParams.get("q") || "").trim();
        const identity = await resolveWalletSubject(query);
        if (!identity || identity.ambiguous || !identity.subject) {
          return jsonOut({
            success: false,
            error: identity && identity.ambiguous
              ? "Username terhubung ke beberapa akun; cari berdasarkan subject."
              : "Konsumen tidak ditemukan."
          }, identity && identity.ambiguous ? 409 : 404);
        }
        const [balance, transactions] = await Promise.all([
          env.DB.prepare("SELECT balance, updated_at FROM wallet_subject_balances WHERE subject = ?").bind(identity.subject).first(),
          env.DB.prepare(
            "SELECT t.id, t.subject, t.username, t.amount, t.transaction_type, t.reference, t.actor_subject, t.created_at, a.reason FROM wallet_transactions t LEFT JOIN wallet_admin_adjustments a ON a.subject = t.subject AND a.reference = t.reference WHERE t.subject = ? ORDER BY t.created_at DESC LIMIT 25"
          ).bind(identity.subject).all()
        ]);
        return jsonOut({
          success: true,
          subject: identity.subject,
          username: identity.username,
          balance: Number(balance && balance.balance || 0),
          updatedAt: balance && balance.updated_at || null,
          transactions: transactions && transactions.results || []
        });
      }

      if (url.pathname === "/api/wallet/transactions" && request.method === "GET") {
        const actor = await getActor();
        if (!roleAllowed(actor, ["consumer", "admin"])) return jsonOut({ success: false, error: "Akses ditolak." }, 403);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 503);
        await ensureTableExists();
        const subject = actor.role === "consumer" ? actor.sub : String(url.searchParams.get("subject") || "").trim();
        const query = subject
          ? "SELECT * FROM wallet_transactions WHERE subject = ? ORDER BY created_at DESC LIMIT 200"
          : "SELECT * FROM wallet_transactions ORDER BY created_at DESC LIMIT 500";
        const result = subject ? await env.DB.prepare(query).bind(subject).all() : await env.DB.prepare(query).all();
        return jsonOut({ success: true, transactions: result.results || [] });
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
        const actor = await getActor();
        if (!roleAllowed(actor, ["admin"])) {
          return new Response(JSON.stringify({ success: false, error: "Akses ditolak" }), {
            status: 401, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const [res, legacyRes] = await Promise.all([
          env.DB.prepare(
          "SELECT * FROM wallet_intents ORDER BY created_at DESC LIMIT 50"
          ).all(),
          env.DB.prepare(
            "SELECT id, username, base_amount, unique_code, total_amount, mode, service, status, expires_at, created_at, 1 AS legacy FROM qris_intents ORDER BY created_at DESC LIMIT 50"
          ).all()
        ]);
        const intents = [
          ...((res && res.results) || []).map((intent) => Object.assign({ legacy: false }, intent)),
          ...((legacyRes && legacyRes.results) || [])
        ].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, 50);
        return new Response(JSON.stringify({
          success: true,
          intents
        }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      if (url.pathname === "/api/wallet/approve-backup" && request.method === "POST") {
        const actor = await getActor();
        if (!roleAllowed(actor, ["admin"])) {
          return new Response(JSON.stringify({ success: false, error: "Akses ditolak" }), {
            status: 401, headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const intentId = sanitizeText(body.intentId || "", 64).trim();
        const intent = await env.DB.prepare("SELECT * FROM wallet_intents WHERE id = ?").bind(intentId).first();
        if (!intent) {
          const legacyResult = await approveLegacyQrisIntent(intentId, actor.sub);
          if (!legacyResult.found) return jsonOut({ success: false, error: "Intent tidak ditemukan" }, 404);
          return jsonOut({
            success: legacyResult.processed,
            legacy: true,
            status: legacyResult.status,
            error: legacyResult.processed ? undefined : "Intent sudah diproses."
          }, legacyResult.processed ? 200 : 409);
        }

        const now = new Date().toISOString();
        const approvalResults = await env.DB.batch([
          env.DB.prepare("UPDATE wallet_intents SET status = 'PAID', paid_at = ? WHERE id = ? AND status = 'PENDING'")
            .bind(now, intentId),
          env.DB.prepare(
            "INSERT INTO wallet_subject_balances (subject, balance, updated_at) SELECT subject, base_amount, ? FROM wallet_intents WHERE id = ? AND status = 'PAID' AND changes() = 1 ON CONFLICT(subject) DO UPDATE SET balance = wallet_subject_balances.balance + excluded.balance, updated_at = excluded.updated_at"
          ).bind(now, intentId),
          env.DB.prepare(
            "INSERT INTO wallet_transactions (id, subject, username, amount, transaction_type, reference, actor_subject, created_at) SELECT ?, subject, username, base_amount, 'topup_manual', id, ?, ? FROM wallet_intents WHERE id = ? AND status = 'PAID' AND changes() = 1 ON CONFLICT(id) DO NOTHING"
          ).bind("topup:" + intentId, actor.sub, now, intentId)
        ]);
        const claimRes = approvalResults && approvalResults[0];

        if (!claimRes || !claimRes.meta || Number(claimRes.meta.changes || 0) !== 1) {
          return new Response(JSON.stringify({ success: true, alreadyPaid: true }), {
            headers: { ...securityHeaders, "Content-Type": "application/json" }
          });
        }

        const creditAmount = Number(intent.base_amount || 0);
        const updatedBal = await env.DB.prepare("SELECT balance FROM wallet_subject_balances WHERE subject = ?").bind(intent.subject).first();

        return new Response(JSON.stringify({
          success: true,
          subject: intent.subject,
          credited: creditAmount,
          newBalance: updatedBal ? Number(updatedBal.balance || 0) : creditAmount
        }), {
          headers: { ...securityHeaders, "Content-Type": "application/json" }
        });
      }

      if (url.pathname === "/api/wallet/migrations" && request.method === "GET") {
        const actor = await getActor();
        if (!roleAllowed(actor, ["admin"])) return jsonOut({ success: false, error: "Akses ditolak." }, 403);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 503);
        await ensureTableExists();
        const res = await env.DB.prepare(
          "SELECT c.legacy_username, c.subject, c.amount, c.reason, c.created_at, (SELECT COUNT(*) FROM orders_store o WHERE lower(o.customer_username) = lower(c.legacy_username)) AS order_count FROM wallet_legacy_claims c WHERE c.status = 'review' ORDER BY c.created_at"
        ).all();
        return jsonOut({ success: true, reviews: res.results || [] });
      }

      if (url.pathname === "/api/wallet/migrations/resolve" && request.method === "POST") {
        const actor = await getActor();
        if (!roleAllowed(actor, ["admin"])) return jsonOut({ success: false, error: "Akses ditolak." }, 403);
        if (!env.DB) return jsonOut({ success: false, error: "Binding D1 (DB) belum terpasang." }, 503);
        await ensureTableExists();
        const body = await request.json().catch(() => ({}));
        const username = normalizeUsername(body.username);
        const subject = String(body.subject || "").trim();
        const action = body.action === "reject" ? "reject" : "claim";
        if (!username || (!/^tg:[0-9]+$/.test(subject) && !/^cn:cn_[a-f0-9]{12}$/.test(subject))) {
          return jsonOut({ success: false, error: "Username atau subjek tidak valid." }, 400);
        }
        const claim = await env.DB.prepare(
          "SELECT amount FROM wallet_legacy_claims WHERE lower(legacy_username) = ? AND subject = ? AND status = 'review'"
        ).bind(username, subject).first();
        if (!claim) return jsonOut({ success: false, error: "Klaim review tidak ditemukan." }, 404);
        if (action === "reject") {
          const now = new Date().toISOString();
          await env.DB.batch([
            env.DB.prepare("UPDATE wallet_legacy_claims SET status = 'rejected', resolved_at = ?, resolved_by = ? WHERE lower(legacy_username) = ? AND subject = ? AND status = 'review'")
              .bind(now, actor.sub, username, subject),
            env.DB.prepare(
              "INSERT INTO wallet_migrations (legacy_username, subject, amount, action, reason, occurred_at, resolved_by) SELECT legacy_username, subject, amount, 'rejected', reason, ?, ? FROM wallet_legacy_claims WHERE lower(legacy_username) = ? AND subject = ? AND status = 'rejected' AND NOT EXISTS (SELECT 1 FROM wallet_migrations WHERE lower(legacy_username) = ? AND subject = ? AND action = 'rejected')"
            ).bind(now, actor.sub, username, subject, username, subject)
          ]);
          return jsonOut({ success: true, subject, username, action });
        }
        const otherClaim = await env.DB.prepare(
          "SELECT subject FROM wallet_legacy_claims WHERE lower(legacy_username) = ? AND status = 'claimed' AND subject != ? LIMIT 1"
        ).bind(username, subject).first();
        if (otherClaim) return jsonOut({ success: false, error: "Legacy balance sudah diklaim oleh subjek lain; tolak atau eskalasi klaim ini." }, 409);
        const now = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare("UPDATE wallet_legacy_claims SET status = 'claimed', resolved_at = ?, resolved_by = ? WHERE lower(legacy_username) = ? AND subject = ? AND status = 'review'")
            .bind(now, actor.sub, username, subject),
          env.DB.prepare(
            "INSERT INTO wallet_subject_balances (subject, balance, updated_at) SELECT ?, amount, ? FROM wallet_legacy_claims WHERE lower(legacy_username) = ? AND subject = ? AND status = 'claimed' AND NOT EXISTS (SELECT 1 FROM wallet_migrations WHERE lower(legacy_username) = ? AND subject = ? AND action = 'resolved') ON CONFLICT(subject) DO UPDATE SET balance = wallet_subject_balances.balance + excluded.balance, updated_at = excluded.updated_at"
          ).bind(subject, now, username, subject, username, subject),
          env.DB.prepare(
            "INSERT INTO wallet_migrations (legacy_username, subject, amount, action, occurred_at, resolved_by) SELECT legacy_username, subject, amount, 'resolved', ?, ? FROM wallet_legacy_claims WHERE lower(legacy_username) = ? AND subject = ? AND status = 'claimed' AND NOT EXISTS (SELECT 1 FROM wallet_migrations WHERE lower(legacy_username) = ? AND subject = ? AND action = 'resolved')"
          ).bind(now, actor.sub, username, subject, username, subject),
          env.DB.prepare(
            "INSERT INTO wallet_transactions (id, subject, username, amount, transaction_type, reference, actor_subject, created_at) SELECT ?, ?, ?, amount, 'legacy_claim', ?, ?, ? FROM wallet_legacy_claims WHERE lower(legacy_username) = ? AND subject = ? AND status = 'claimed' AND NOT EXISTS (SELECT 1 FROM wallet_transactions WHERE subject = ? AND reference = ?)"
          ).bind("legacy:" + username + ":" + subject, subject, username, "legacy:" + username, actor.sub, now, username, subject, subject, "legacy:" + username),
          env.DB.prepare(
            "INSERT INTO order_subject_links (order_id, subject, order_type, linked_at) SELECT id, ?, 'standard', ? FROM orders_store WHERE lower(customer_username) = ? ON CONFLICT(order_id) DO NOTHING"
          ).bind(subject, now, username)
        ]);
        return jsonOut({ success: true, subject, username });
      }

      return new Response("Not Found", { status: 404, headers: securityHeaders });
    } catch (err) {
      console.error("Worker request failed:", err);
      return new Response(JSON.stringify({ success: false, error: "Internal Server Error" }), {
        status: 500,
        headers: { ...securityHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
