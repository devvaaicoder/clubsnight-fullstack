import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../worker.js";

const sessionSecret = "local-worker-wallet-test-secret";
const subject = "tg:9001";

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function makeSessionToken(role) {
  const claims = {
    sub: role === "talent" ? "talent:test" : "tg:" + (role === "admin" ? "101" : "100"),
    username: role + "_test",
    role,
    permissions: [],
    exp: Math.floor(Date.now() / 1000) + 60,
    nonce: "wallet-test"
  };
  const encoded = base64Url(JSON.stringify(claims));
  const signatureBytes = createHmac("sha256", "cn_worker_session_v1:" + sessionSecret).update(encoded).digest();
  const signature = base64Url(String.fromCharCode(...signatureBytes));
  return encoded + "." + signature;
}

function createDb() {
  const adjustments = new Map();
  const balances = new Map([[subject, 2500]]);
  return {
    prepare(sql) {
      return {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async run() {
          return { meta: { changes: 0 } };
        },
        async first() {
          if (sql.includes("FROM wallet_admin_adjustments WHERE subject = ? AND reference = ?")) {
            return adjustments.get(this.values.join(":")) || null;
          }
          if (sql.includes("FROM wallet_subject_balances WHERE subject = ?")) {
            const balance = balances.get(this.values[0]);
            return balance === undefined ? null : { balance, updated_at: "2026-01-01T00:00:00.000Z" };
          }
          return null;
        },
        async all() {
          return { results: [] };
        }
      };
    },
    async batch(statements) {
      const [balanceStatement, auditStatement] = statements;
      const [targetSubject, delta, , , reference] = balanceStatement.values;
      const key = targetSubject + ":" + reference;
      if (adjustments.has(key)) return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }, { meta: { changes: 0 } }];
      const currentBalance = balances.get(targetSubject) || 0;
      if (currentBalance + delta < 0) return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }, { meta: { changes: 0 } }];
      balances.set(targetSubject, currentBalance + delta);
      adjustments.set(key, { amount: delta, reason: auditStatement.values[4] });
      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }];
    }
  };
}

async function callWorker(path, { role, method = "GET", body, db = createDb(), env = {} } = {}) {
  const headers = new Headers({ Origin: "https://clubsnight.my.id" });
  if (role) headers.set("X-Session-Token", makeSessionToken(role));
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const request = new Request("https://clubsnight.my.id" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const response = await worker.fetch(request, { ADMIN_SECRET_TOKEN: sessionSecret, DB: db, ...env }, {});
  return { response, data: await response.json() };
}

async function withTelegramSendFailure(run, httpStatus = 400) {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const calls = [];
  const warnings = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({
      ok: false,
      error_code: 400,
      description: "Bad Request: not enough rights to send text messages to the chat"
    }), { status: httpStatus });
  };
  console.warn = (...args) => warnings.push(args);
  try {
    await run();
    return { calls, warnings };
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
}

async function rejectTelegramCallback(options = {}) {
  const callback = {
    id: "callback-test-id",
    data: "qris_ok:QRS-test",
    from: { id: options.senderId ?? 7 },
    message: { chat: { id: options.chatId ?? -100222 } }
  };
  const request = new Request("https://clubsnight-fullstack.clubsnight.workers.dev/api/webhook/telegram", {
    method: "POST",
    headers: options.incomingSecret ? { "X-Telegram-Bot-Api-Secret-Token": options.incomingSecret } : {},
    body: JSON.stringify({ callback_query: callback })
  });
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const calls = [];
  const warnings = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  console.warn = (...args) => warnings.push(args);
  try {
    const response = await worker.fetch(request, {
      TELEGRAM_BOT_TOKEN: "test-bot-token",
      TELEGRAM_WEBHOOK_SECRET: options.expectedSecret ?? "expected-secret",
      TELEGRAM_ADMIN_CHAT_ID: options.adminChatId ?? "-100222",
      OWNER_TELEGRAM_IDS: options.ownerIds ?? "7",
      ADMIN_QC_TELEGRAM_IDS: options.adminQcIds ?? ""
    }, {});
    return { response, calls, warnings };
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
}

const roles = [
  ["Developer", "developer", true],
  ["Admin QC", "admin", true],
  ["Merch", "merch", false],
  ["Talent", "talent", false],
  ["Consumer", "consumer", false],
  ["anonymous", null, false]
];

for (const [label, role, allowed] of roles) {
  test(`wallet lookup role matrix: ${label}`, async () => {
    const { response, data } = await callWorker("/api/wallet/lookup?q=" + subject, { role });
    assert.equal(response.status, allowed ? 200 : 403);
    assert.equal(data.success, allowed);
  });

  test(`wallet adjustment role matrix: ${label}`, async () => {
    const { response, data } = await callWorker("/api/wallet/adjust", {
      role,
      method: "POST",
      body: { subject, delta: 500, reference: "QRS-test-001", reason: "Verified payment" }
    });
    assert.equal(response.status, allowed ? 200 : 403);
    assert.equal(data.success, allowed);
  });
}

test("wallet adjustment repeats the reference without applying the credit twice", async () => {
  const db = createDb();
  const request = new Request("https://clubsnight.my.id/api/wallet/adjust", {
    method: "POST",
    headers: {
      Origin: "https://clubsnight.my.id",
      "Content-Type": "application/json",
      "X-Session-Token": makeSessionToken("developer")
    },
    body: JSON.stringify({ subject, delta: 500, reference: "QRS-test-002", reason: "Verified payment" })
  });
  const env = { ADMIN_SECRET_TOKEN: sessionSecret, DB: db };
  const first = await worker.fetch(request.clone(), env, {});
  const second = await worker.fetch(request.clone(), env, {});
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).alreadyApplied, true);
});

test("staff balance requests return the caller's single wallet balance", async () => {
  const { response, data } = await callWorker("/api/wallet/balance", { role: "admin" });
  assert.equal(response.status, 200);
  assert.equal(data.subject, "tg:101");
  assert.equal(typeof data.balance, "number");
  assert.equal(Object.hasOwn(data, "wallets"), false);
});

test("staff QRIS intents are bound to the session subject", async () => {
  let insertedIntent;
  const db = {
    prepare(sql) {
      return {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          if (sql.includes("INSERT INTO wallet_intents")) insertedIntent = values;
          return this;
        },
        async run() { return { meta: { changes: 1 } }; },
        async first() { return null; },
        async all() { return { results: [] }; }
      };
    }
  };
  const { response, data } = await callWorker("/api/wallet/intent", {
    role: "admin",
    method: "POST",
    body: { username: "attacker", subject: "tg:9999", baseAmount: 10000 },
    db
  });
  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(insertedIntent[1], "tg:101");
  assert.equal(insertedIntent[2], "admin_test");
});

test("staff wallet spending is bound to the session subject", async () => {
  let debitValues;
  const db = {
    prepare(sql) {
      return {
        sql,
        values: [],
        bind(...values) { this.values = values; return this; },
        async run() { return { meta: { changes: 0 } }; },
        async first() { return null; },
        async all() { return { results: [] }; }
      };
    },
    async batch(statements) {
      debitValues = statements[0].values;
      return [{ meta: { changes: 0 } }, { meta: { changes: 0 } }];
    }
  };
  const { response } = await callWorker("/api/wallet/spend", {
    role: "admin",
    method: "POST",
    body: { username: "attacker", subject: "tg:9999", amount: 100 },
    db
  });
  assert.equal(response.status, 402);
  assert.equal(debitValues[2], "tg:101");
});

test("QRIS notification logs Telegram send failures without changing the consumer response", async () => {
  let responseData;
  const { calls, warnings } = await withTelegramSendFailure(async () => {
    const result = await callWorker("/api/wallet/intent", {
      role: "admin",
      method: "POST",
      body: { baseAmount: 10000 },
      env: { TELEGRAM_BOT_TOKEN: "test-bot-token", TELEGRAM_ADMIN_CHAT_ID: "-100222" }
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.data.success, true);
    responseData = result.data;
  }, 200);
  const warning = JSON.stringify(warnings);
  assert.equal(calls.length, 1);
  assert.ok(warning.includes("intent_id=" + responseData.intent.id));
  assert.ok(warning.includes("error_code=400"));
  assert.ok(warning.includes("not enough rights to send text messages to the chat"));
  assert.equal(warning.includes("test-bot-token"), false);
  assert.equal(warning.includes("api.telegram.org"), false);
});

test("order notification logs Telegram send failures without exposing errors to the consumer", async () => {
  const db = {
    prepare(sql) {
      return {
        sql,
        values: [],
        bind(...values) { this.values = values; return this; },
        async run() { return { meta: { changes: 1 } }; },
        async first() {
          return sql.includes("SELECT subject FROM order_subject_links")
            ? { subject: "tg:100" }
            : null;
        },
        async all() { return { results: [] }; }
      };
    },
    async batch(statements) {
      return statements.map(() => ({ meta: { changes: 1 } }));
    }
  };
  let responseData;
  const { calls, warnings } = await withTelegramSendFailure(async () => {
    const result = await callWorker("/api/orders/create", {
      role: "consumer",
      method: "POST",
      body: { id: "ORD-TELEGRAM-FAIL", service: "Test service", amount: 1000 },
      db,
      env: { TELEGRAM_BOT_TOKEN: "test-bot-token", TELEGRAM_ADMIN_CHAT_ID: "-100222" }
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.data.success, true);
    assert.equal(result.data.telegramSent, false);
    responseData = result.data;
  });
  const warning = JSON.stringify(warnings);
  assert.equal(calls.length, 1);
  assert.ok(warning.includes("order_id=" + responseData.orderId));
  assert.ok(warning.includes("error_code=400"));
  assert.ok(warning.includes("not enough rights to send text messages to the chat"));
  assert.equal(warning.includes("test-bot-token"), false);
  assert.equal(warning.includes("api.telegram.org"), false);
});

for (const [reason, options] of [
  ["secret_not_configured", { expectedSecret: "" }],
  ["secret_token_mismatch", { incomingSecret: "wrong-secret" }],
  ["admin_chat_not_configured", { adminChatId: "" }],
  ["chat_id_mismatch", { chatId: -100333 }],
  ["sender_not_allowlisted", { senderId: 8 }]
]) {
  test(`Telegram webhook reports and acknowledges ${reason}`, async () => {
    const { response, calls, warnings } = await rejectTelegramCallback({
      incomingSecret: options.incomingSecret || "expected-secret",
      ...options
    });
    assert.equal(response.status, 403);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /answerCallbackQuery$/);
    assert.equal(calls[0].body.callback_query_id, "callback-test-id");
    assert.ok(warnings.some((args) => args.includes(reason)));
    assert.equal(JSON.stringify(warnings).includes("expected-secret"), false);
    assert.equal(JSON.stringify(warnings).includes("wrong-secret"), false);
  });
}

// ============================================================================
// LOUNGE SERVER SYNC: CONFIG, PERMANENT STORY DELETE & TALENT APPROVAL TESTS
// ============================================================================

let loungeTestIpSeq = 10;
function nextTestIp() {
  loungeTestIpSeq += 1;
  return "10.99.0." + loungeTestIpSeq;
}

function makeLoungeSessionToken({ role, username, sub, tokenVersion }) {
  const claims = {
    sub: sub || (role === "talent" ? "talent:" + (username || "t1") : "tg:" + (role === "developer" ? "100" : role === "admin" ? "101" : role === "merch" ? "102" : "103")),
    username: username || (role + "_user"),
    name: username || (role + "_user"),
    role,
    permissions: [],
    exp: Math.floor(Date.now() / 1000) + 300,
    nonce: "lounge-sync-" + loungeTestIpSeq,
    ...(role === "talent" ? { tokenVersion: tokenVersion || 1 } : {})
  };
  const encoded = base64Url(JSON.stringify(claims));
  const signatureBytes = createHmac("sha256", "cn_worker_session_v1:" + sessionSecret).update(encoded).digest();
  const signature = base64Url(String.fromCharCode(...signatureBytes));
  return encoded + "." + signature;
}

function createLoungeSyncEnv() {
  const configMap = new Map([
    ["min_post_chars", "1"],
    ["max_stories_per_day", "3"],
    ["max_global_posts", "20"],
    ["posting_locked", "0"],
    ["qc_gateway", "1"]
  ]);
  const talentAccounts = new Map([
    ["talent_grandfathered", { username: "talent_grandfathered", name: "Grandfathered Talent", agency: "Clubs'Night", avatar: "", token_version: 1 }],
    ["talent_other", { username: "talent_other", name: "Other Talent", agency: "Clubs'Night", avatar: "", token_version: 1 }],
    ["talent_pending", { username: "talent_pending", name: "Pending Talent", agency: "Clubs'Night", avatar: "", token_version: 1 }],
    ["talent_rejected", { username: "talent_rejected", name: "Rejected Talent", agency: "Clubs'Night", avatar: "", token_version: 1 }]
  ]);
  const approvalsMap = new Map([
    ["talent_pending", { talent_id: "talent_pending", status: "pending", decided_by: null, decided_at: null, reason: "", updated_at: "2026-11-01T00:00:00.000Z" }],
    ["talent_rejected", { talent_id: "talent_rejected", status: "rejected", decided_by: "tg:100", decided_at: "2026-11-01T00:00:00.000Z", reason: "Incomplete docs", updated_at: "2026-11-01T00:00:00.000Z" }]
  ]);
  const deletedStories = new Set();
  const audits = [];
  const r2Objects = new Map();
  const r2DeletedKeys = [];
  let loungeStore = { posts: "[]", stories: "[]", updated_at: "2026-11-01T00:00:00.000Z" };

  const execStmt = (sql, values) => {
    if (sql.includes("INSERT INTO lounge_config")) {
      configMap.set(values[0], String(values[1]));
      return { meta: { changes: 1 } };
    }
    if (sql.includes("INSERT INTO lounge_admin_audit")) {
      audits.push({ id: values[0], action: values[1], target_id: values[2], actor_subject: values[3], payload: JSON.parse(values[4]), created_at: values[5] });
      return { meta: { changes: 1 } };
    }
    if (sql.includes("INSERT INTO talent_approvals") && sql.includes("WHERE NOT EXISTS")) {
      const [uname, nowIso] = values;
      if (!talentAccounts.has(uname) && !approvalsMap.has(uname)) {
        approvalsMap.set(uname, { talent_id: uname, status: "pending", decided_by: null, decided_at: null, reason: "", updated_at: nowIso });
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (sql.includes("INSERT INTO talent_approvals")) {
      const [talentId, status, decidedBy, decidedAt, reason, updatedAt] = values;
      approvalsMap.set(talentId, { talent_id: talentId, status, decided_by: decidedBy, decided_at: decidedAt, reason, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (sql.includes("INSERT INTO talent_accounts")) {
      const [uname, pHash, name, agency, status, moods, avatar, updatedAt] = values;
      talentAccounts.set(uname, { username: uname, password_hash: pHash, name, agency, status, moods, avatar, token_version: 1, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (sql.includes("INSERT INTO lounge_store")) {
      if (sql.includes("SET posts = excluded.posts, stories = excluded.stories")) {
        loungeStore = { posts: values[0], stories: values[1], updated_at: values[2] };
      } else if (sql.includes("SET stories = excluded.stories")) {
        loungeStore = { posts: values[0], stories: values[1], updated_at: values[2] };
      }
      return { meta: { changes: 1 } };
    }
    if (sql.includes("INSERT OR IGNORE INTO lounge_deleted_stories")) {
      deletedStories.add(String(values[0]));
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 0 } };
  };

  const DB = {
    prepare(sql) {
      return {
        sql,
        values: [],
        bind(...vals) {
          this.values = vals;
          return this;
        },
        async run() {
          return execStmt(sql, this.values);
        },
        async first() {
          if (sql.includes("FROM talent_accounts WHERE username = ?")) {
            return talentAccounts.get(this.values[0]) || null;
          }
          if (sql.includes("SELECT status FROM talent_approvals WHERE talent_id = ?")) {
            const row = approvalsMap.get(this.values[0]);
            return row ? { status: row.status } : null;
          }
          if (sql.includes("SELECT talent_id FROM talent_approvals WHERE talent_id = ?")) {
            const row = approvalsMap.get(this.values[0]);
            return row ? { talent_id: row.talent_id } : null;
          }
          if (sql.includes("FROM lounge_store WHERE id = 1")) {
            return { ...loungeStore };
          }
          return null;
        },
        async all() {
          if (sql.includes("SELECT key, value FROM lounge_config")) {
            return { results: Array.from(configMap.entries()).map(([key, value]) => ({ key, value })) };
          }
          if (sql.includes("SELECT story_id FROM lounge_deleted_stories")) {
            return { results: Array.from(deletedStories).map((story_id) => ({ story_id })) };
          }
          if (sql.includes("FROM talent_approvals a LEFT JOIN talent_accounts t")) {
            const pending = [];
            for (const row of approvalsMap.values()) {
              if (row.status !== "pending") continue;
              const acc = talentAccounts.get(row.talent_id) || {};
              pending.push({ ...row, name: acc.name || row.talent_id, agency: acc.agency || "Clubs'Night", avatar: acc.avatar || "" });
            }
            return { results: pending };
          }
          return { results: [] };
        }
      };
    },
    async batch(statements) {
      return statements.map((stmt) => execStmt(stmt.sql, stmt.values));
    }
  };

  const BUCKET = {
    async put(key, val) { r2Objects.set(key, val); },
    async delete(key) { r2Objects.delete(key); r2DeletedKeys.push(key); }
  };

  const env = {
    ADMIN_SECRET_TOKEN: sessionSecret,
    R2_PUBLIC_URL: "https://media-cn.my.id",
    DB,
    BUCKET
  };

  return { env, configMap, talentAccounts, approvalsMap, deletedStories, audits, r2Objects, r2DeletedKeys, getStore: () => loungeStore, setStore: (s) => { loungeStore = s; } };
}

async function callLoungeWorker(env, method, path, { token = "", body = undefined } = {}) {
  const headers = {
    Origin: "https://clubsnight.my.id",
    "CF-Connecting-IP": nextTestIp()
  };
  if (token) headers["X-Session-Token"] = token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const req = new Request("https://worker.example" + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const res = await worker.fetch(req, env);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

test("GET/PUT /api/lounge/config enforces role matrix, validation, and audit logging", async () => {
  const ctx = createLoungeSyncEnv();
  const tokens = {
    anonymous: "",
    consumer: makeLoungeSessionToken({ role: "consumer" }),
    merch: makeLoungeSessionToken({ role: "merch" }),
    adminQc: makeLoungeSessionToken({ role: "admin" }),
    talentApproved: makeLoungeSessionToken({ role: "talent", username: "talent_grandfathered" }),
    talentPending: makeLoungeSessionToken({ role: "talent", username: "talent_pending" }),
    developer: makeLoungeSessionToken({ role: "developer" })
  };

  // Public GET works for anonymous and every role
  for (const [, tok] of Object.entries(tokens)) {
    const res = await callLoungeWorker(ctx.env, "GET", "/api/lounge/config", { token: tok });
    assert.equal(res.status, 200);
    assert.equal(res.data.min_post_chars, 1);
    assert.equal(res.data.max_stories_per_day, 3);
    assert.equal(res.data.max_global_posts, 20);
    assert.equal(res.data.posting_locked, 0);
    assert.equal(res.data.qc_gateway, 1);
  }

  // PUT denied for anonymous (401) and non-developers (403)
  assert.equal((await callLoungeWorker(ctx.env, "PUT", "/api/lounge/config", { body: { qc_gateway: 0 } })).status, 401);
  for (const roleKey of ["consumer", "merch", "adminQc", "talentApproved", "talentPending"]) {
    const res = await callLoungeWorker(ctx.env, "PUT", "/api/lounge/config", { token: tokens[roleKey], body: { qc_gateway: 0 } });
    assert.equal(res.status, 403, roleKey + " should get 403 on PUT /api/lounge/config");
  }

  // Validation errors for developer
  assert.equal((await callLoungeWorker(ctx.env, "PUT", "/api/lounge/config", { token: tokens.developer, body: {} })).status, 400);
  assert.equal((await callLoungeWorker(ctx.env, "PUT", "/api/lounge/config", { token: tokens.developer, body: { max_global_posts: 0 } })).status, 400);
  assert.equal((await callLoungeWorker(ctx.env, "PUT", "/api/lounge/config", { token: tokens.developer, body: { min_post_chars: 1.5 } })).status, 400);
  assert.equal((await callLoungeWorker(ctx.env, "PUT", "/api/lounge/config", { token: tokens.developer, body: { unknown_key: 1 } })).status, 400);

  // Valid PUT by developer succeeds and writes audit row
  const ok = await callLoungeWorker(ctx.env, "PUT", "/api/lounge/config", {
    token: tokens.developer,
    body: { min_post_chars: 10, max_stories_per_day: 2, max_global_posts: 5, posting_locked: 1, qc_gateway: 0 }
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.config.min_post_chars, 10);
  assert.equal(ok.data.config.max_global_posts, 5);
  assert.equal(ok.data.config.posting_locked, 1);
  assert.equal(ok.data.config.qc_gateway, 0);
  assert.equal(ctx.audits.length, 1);
  assert.equal(ctx.audits[0].action, "lounge_config_update");

  const checkGet = await callLoungeWorker(ctx.env, "GET", "/api/lounge/config");
  assert.equal(checkGet.data.min_post_chars, 10);
  assert.equal(checkGet.data.qc_gateway, 0);
});

test("Lounge config enforcement on posts (min_post_chars, posting_locked 423, max_global_posts auto-prune)", async () => {
  const ctx = createLoungeSyncEnv();
  const devTok = makeLoungeSessionToken({ role: "developer" });
  const adminQcTok = makeLoungeSessionToken({ role: "admin" });
  const talentTok = makeLoungeSessionToken({ role: "talent", username: "talent_grandfathered" });

  await callLoungeWorker(ctx.env, "PUT", "/api/lounge/config", {
    token: devTok,
    body: { min_post_chars: 10, max_global_posts: 5, posting_locked: 0 }
  });

  // Text shorter than min_post_chars without media -> 400
  const tooShort = await callLoungeWorker(ctx.env, "POST", "/api/lounge/save", {
    token: talentTok,
    body: { posts: [{ id: "p_short", ownerUsername: "talent_grandfathered", text: "short" }] }
  });
  assert.equal(tooShort.status, 400);

  // Short text WITH media -> allowed (200)
  const withMedia = await callLoungeWorker(ctx.env, "POST", "/api/lounge/save", {
    token: talentTok,
    body: { posts: [{ id: "p_media", ownerUsername: "talent_grandfathered", text: "hi", image: "https://media-cn.my.id/stories/img1.jpg" }] }
  });
  assert.equal(withMedia.status, 200);

  // Auto-prune respects max_global_posts=5 and removes evicted R2 image
  ctx.r2Objects.set("stories/evicted.jpg", "bytes");
  const manyPosts = Array.from({ length: 7 }, (_, i) => ({
    id: "p_" + i,
    ownerUsername: "talent_grandfathered",
    text: "Long enough post content number " + i,
    image: i === 6 ? "https://media-cn.my.id/stories/evicted.jpg" : ""
  }));
  const pruned = await callLoungeWorker(ctx.env, "POST", "/api/lounge/save", { token: talentTok, body: { posts: manyPosts } });
  assert.equal(pruned.status, 200);
  assert.equal(pruned.data.countPosts, 5);
  assert.ok(ctx.r2DeletedKeys.includes("stories/evicted.jpg"));

  // Lock posting -> Talent gets 423, Developer & Admin QC still allowed
  await callLoungeWorker(ctx.env, "PUT", "/api/lounge/config", { token: devTok, body: { posting_locked: 1 } });
  const lockedTalent = await callLoungeWorker(ctx.env, "POST", "/api/lounge/save", {
    token: talentTok,
    body: { posts: [{ id: "p_locked", ownerUsername: "talent_grandfathered", text: "Long enough locked post" }] }
  });
  assert.equal(lockedTalent.status, 423);

  const unlockedAdmin = await callLoungeWorker(ctx.env, "POST", "/api/lounge/save", {
    token: adminQcTok,
    body: { posts: [{ id: "p_admin_ok", ownerUsername: "admin_user", text: "Admin QC bypasses lock" }] }
  });
  assert.equal(unlockedAdmin.status, 200);

  const unlockedDev = await callLoungeWorker(ctx.env, "POST", "/api/lounge/save", {
    token: devTok,
    body: { posts: [{ id: "p_dev_ok", ownerUsername: "developer_user", text: "Developer bypasses lock" }] }
  });
  assert.equal(unlockedDev.status, 200);
});

test("Story create enforces qc_gateway, max_stories_per_day per UTC day, posting_locked, and role matrix", async () => {
  const ctx = createLoungeSyncEnv();
  const devTok = makeLoungeSessionToken({ role: "developer" });
  const adminQcTok = makeLoungeSessionToken({ role: "admin" });
  const merchTok = makeLoungeSessionToken({ role: "merch" });
  const consumerTok = makeLoungeSessionToken({ role: "consumer" });
  const talentTok = makeLoungeSessionToken({ role: "talent", username: "talent_grandfathered" });

  // Anonymous (401), consumer (403), merch (403)
  assert.equal((await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/create", { body: { image: "https://media-cn.my.id/stories/a.jpg" } })).status, 401);
  assert.equal((await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/create", { token: consumerTok, body: { image: "https://media-cn.my.id/stories/a.jpg" } })).status, 403);
  assert.equal((await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/create", { token: merchTok, body: { image: "https://media-cn.my.id/stories/a.jpg" } })).status, 403);

  // qc_gateway=1 (default): Talent story is pending, Developer/Admin QC are approved
  const s1 = await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/create", {
    token: talentTok,
    body: { id: "st_1", image: "https://media-cn.my.id/stories/st_1.jpg", caption: "First" }
  });
  assert.equal(s1.status, 200);
  assert.equal(s1.data.story.qcStatus, "pending");

  const sAdmin = await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/create", {
    token: adminQcTok,
    body: { id: "st_admin", image: "https://media-cn.my.id/stories/st_admin.jpg" }
  });
  assert.equal(sAdmin.status, 200);
  assert.equal(sAdmin.data.story.qcStatus, "approved");

  // Set qc_gateway=0 & max_stories_per_day=2
  await callLoungeWorker(ctx.env, "PUT", "/api/lounge/config", {
    token: devTok,
    body: { qc_gateway: 0, max_stories_per_day: 2 }
  });
  const s2 = await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/create", {
    token: talentTok,
    body: { id: "st_2", image: "https://media-cn.my.id/stories/st_2.jpg", caption: "Second" }
  });
  assert.equal(s2.status, 200);
  assert.equal(s2.data.story.qcStatus, "approved");

  // 3rd story same UTC day exceeds max_stories_per_day=2 -> 429
  const s3 = await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/create", {
    token: talentTok,
    body: { id: "st_3", image: "https://media-cn.my.id/stories/st_3.jpg" }
  });
  assert.equal(s3.status, 429);

  // posting_locked=1 rejects Talent story (423), allows Developer
  await callLoungeWorker(ctx.env, "PUT", "/api/lounge/config", { token: devTok, body: { posting_locked: 1 } });
  const lockedStory = await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/create", {
    token: talentTok,
    body: { id: "st_locked", image: "https://media-cn.my.id/stories/st_locked.jpg" }
  });
  assert.equal(lockedStory.status, 423);

  const devStory = await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/create", {
    token: devTok,
    body: { id: "st_dev", image: "https://media-cn.my.id/stories/st_dev.jpg" }
  });
  assert.equal(devStory.status, 200);
  assert.equal(devStory.data.story.qcStatus, "approved");
});

test("Permanent story delete removes D1 + R2, enforces role matrix, and never reappears in /api/lounge/get", async () => {
  const ctx = createLoungeSyncEnv();
  const devTok = makeLoungeSessionToken({ role: "developer" });
  const adminQcTok = makeLoungeSessionToken({ role: "admin" });
  const merchTok = makeLoungeSessionToken({ role: "merch" });
  const consumerTok = makeLoungeSessionToken({ role: "consumer" });
  const ownerTok = makeLoungeSessionToken({ role: "talent", username: "talent_grandfathered" });
  const otherTok = makeLoungeSessionToken({ role: "talent", username: "talent_other" });

  await callLoungeWorker(ctx.env, "PUT", "/api/lounge/config", { token: devTok, body: { qc_gateway: 0, max_stories_per_day: 10 } });

  for (const id of ["del_owner", "del_admin", "del_dev"]) {
    ctx.r2Objects.set("stories/" + id + ".jpg", "img-bytes");
    const created = await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/create", {
      token: ownerTok,
      body: { id, image: "https://media-cn.my.id/stories/" + id + ".jpg" }
    });
    assert.equal(created.status, 200);
  }

  // Unauthorized roles cannot delete
  assert.equal((await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/delete", { body: { id: "del_owner" } })).status, 401);
  assert.equal((await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/delete", { token: consumerTok, body: { id: "del_owner" } })).status, 403);
  assert.equal((await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/delete", { token: merchTok, body: { id: "del_owner" } })).status, 403);
  assert.equal((await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/delete", { token: otherTok, body: { id: "del_owner" } })).status, 403);

  // Owner Talent deletes via POST /api/lounge/story/delete
  const dOwner = await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/delete", { token: ownerTok, body: { id: "del_owner" } });
  assert.equal(dOwner.status, 200);
  assert.equal(dOwner.data.r2Deleted, true);
  assert.ok(ctx.r2DeletedKeys.includes("stories/del_owner.jpg"));

  // Admin QC deletes via DELETE /api/lounge/story/:id
  const dAdmin = await callLoungeWorker(ctx.env, "DELETE", "/api/lounge/story/del_admin", { token: adminQcTok });
  assert.equal(dAdmin.status, 200);
  assert.equal(dAdmin.data.r2Deleted, true);
  assert.ok(ctx.r2DeletedKeys.includes("stories/del_admin.jpg"));

  // Developer deletes via POST /api/lounge/story/delete
  const dDev = await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/delete", { token: devTok, body: { id: "del_dev" } });
  assert.equal(dDev.status, 200);
  assert.equal(dDev.data.r2Deleted, true);
  assert.ok(ctx.r2DeletedKeys.includes("stories/del_dev.jpg"));

  // GET /api/lounge/get never returns deleted stories
  const listAfter = await callLoungeWorker(ctx.env, "GET", "/api/lounge/get", { token: devTok });
  assert.equal(listAfter.status, 200);
  assert.equal(listAfter.data.stories.length, 0);
});

test("Talent approval workflow: grandfathering, new pending accounts, role matrix, audit, and 403 gating", async () => {
  const ctx = createLoungeSyncEnv();
  const devTok = makeLoungeSessionToken({ role: "developer" });
  const adminQcTok = makeLoungeSessionToken({ role: "admin" });
  const merchTok = makeLoungeSessionToken({ role: "merch" });
  const consumerTok = makeLoungeSessionToken({ role: "consumer" });
  const pendingTok = makeLoungeSessionToken({ role: "talent", username: "talent_pending" });
  const rejectedTok = makeLoungeSessionToken({ role: "talent", username: "talent_rejected" });
  const grandfatheredTok = makeLoungeSessionToken({ role: "talent", username: "talent_grandfathered" });

  // Pending & rejected Talents get 403 on post create and story create
  for (const tok of [pendingTok, rejectedTok]) {
    assert.equal((await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/create", {
      token: tok,
      body: { id: "st_blocked", image: "https://media-cn.my.id/stories/blocked.jpg" }
    })).status, 403);
    assert.equal((await callLoungeWorker(ctx.env, "POST", "/api/lounge/save", {
      token: tok,
      body: { posts: [{ id: "p_blocked", ownerUsername: "talent_pending", text: "Blocked post" }] }
    })).status, 403);
  }

  // Grandfathered Talent (no talent_approvals row) still works
  assert.equal((await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/create", {
    token: grandfatheredTok,
    body: { id: "st_gf", image: "https://media-cn.my.id/stories/gf.jpg" }
  })).status, 200);

  // Creating a new Talent via /api/talent/seed marks it pending; re-seeding grandfathered keeps it grandfathered
  const seedRes = await callLoungeWorker(ctx.env, "POST", "/api/talent/seed", {
    token: devTok,
    body: {
      talents: [
        { username: "new_talent_01", password: "Password123!", name: "New Talent 01" },
        { username: "talent_grandfathered", password: "Password123!", name: "Grandfathered Updated" }
      ]
    }
  });
  assert.equal(seedRes.status, 200);
  assert.equal(ctx.approvalsMap.get("new_talent_01")?.status, "pending");
  assert.equal(ctx.approvalsMap.has("talent_grandfathered"), false);

  // GET /api/talent/approvals role matrix: Developer only
  assert.equal((await callLoungeWorker(ctx.env, "GET", "/api/talent/approvals")).status, 401);
  for (const tok of [consumerTok, merchTok, adminQcTok, grandfatheredTok, pendingTok]) {
    assert.equal((await callLoungeWorker(ctx.env, "GET", "/api/talent/approvals", { token: tok })).status, 403);
  }
  const listPending = await callLoungeWorker(ctx.env, "GET", "/api/talent/approvals", { token: devTok });
  assert.equal(listPending.status, 200);
  const pendingIds = listPending.data.approvals.map((a) => a.talent_id);
  assert.ok(pendingIds.includes("talent_pending"));
  assert.ok(pendingIds.includes("new_talent_01"));
  assert.equal(pendingIds.includes("talent_rejected"), false);

  // POST /api/talent/approvals/:id role matrix: Developer only
  assert.equal((await callLoungeWorker(ctx.env, "POST", "/api/talent/approvals/talent_pending", { body: { decision: "approved" } })).status, 401);
  for (const tok of [consumerTok, merchTok, adminQcTok, grandfatheredTok, pendingTok]) {
    assert.equal((await callLoungeWorker(ctx.env, "POST", "/api/talent/approvals/talent_pending", { token: tok, body: { decision: "approved" } })).status, 403);
  }

  // Developer approves talent_pending -> audited, and talent_pending can now post & create stories
  const approveRes = await callLoungeWorker(ctx.env, "POST", "/api/talent/approvals/talent_pending", {
    token: devTok,
    body: { decision: "approved", reason: "Verified ID" }
  });
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.data.approval.status, "approved");
  assert.ok(ctx.audits.some((a) => a.action === "talent_approval_decision" && a.target_id === "talent_pending"));

  assert.equal((await callLoungeWorker(ctx.env, "POST", "/api/lounge/story/create", {
    token: pendingTok,
    body: { id: "st_now_ok", image: "https://media-cn.my.id/stories/now_ok.jpg" }
  })).status, 200);
  assert.equal((await callLoungeWorker(ctx.env, "POST", "/api/lounge/save", {
    token: pendingTok,
    body: { posts: [{ id: "p_now_ok", ownerUsername: "talent_pending", text: "Now approved!" }] }
  })).status, 200);
});


function createTelemetryEnv() {
  const clientErrors = [];
  const execStmt = (sql, values) => {
    if (sql.includes("INSERT INTO client_errors")) {
      clientErrors.unshift({ id: values[0], ts: values[1], page: values[2], message: values[3], line: values[4], ua: values[5], error_code: values[6], request_id: values[7], scope: values[8], action: values[9], endpoint: values[10], http_status: values[11] });
      return { meta: { changes: 1 } };
    }
    if (sql.includes("DELETE FROM client_errors")) {
      clientErrors.length = 0;
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 1 } };
  };
  const DB = {
    prepare(sql) {
      return {
        sql, values: [],
        bind(...vals) { this.values = vals; return this; },
        async run() { return execStmt(sql, this.values); },
        async first() {
          if (sql.includes("SELECT 1 AS ok")) return { ok: 1 };
          if (sql.includes("SELECT COUNT(*) AS cnt FROM client_errors")) return { cnt: clientErrors.length };
          return null;
        },
        async all() {
          if (sql.includes("FROM client_errors")) return { results: clientErrors.slice(0, 50) };
          return { results: [] };
        }
      };
    },
    async batch(stmts) { return stmts.map((st) => execStmt(st.sql, st.values)); }
  };
  const BUCKET = {
    async list() { return { objects: [] }; },
    async put() {},
    async delete() {}
  };
  return {
    env: { ADMIN_SECRET_TOKEN: sessionSecret, WORKER_ASSERTION_SECRET: "fake-assertion-secret", R2_PUBLIC_URL: "https://media-cn.my.id", DB, BUCKET },
    clientErrors
  };
}

test("Error responses include X-Error-Code, X-Request-Id, and JSON errorCode/requestId", async () => {
  const ctx = createTelemetryEnv();
  const res = await callLoungeWorker(ctx.env, "GET", "/api/client-error");
  assert.equal(res.status, 401);
  assert.equal(res.data.errorCode, "CN-SYSTEM-401");
  assert.ok(typeof res.data.requestId === "string" && res.data.requestId.length > 3);
});

test("GET /api/system/health-matrix is restricted to Developer and returns service statuses", async () => {
  const ctx = createTelemetryEnv();
  const devTok = makeLoungeSessionToken({ role: "developer" });
  const consumerTok = makeLoungeSessionToken({ role: "consumer" });

  assert.equal((await callLoungeWorker(ctx.env, "GET", "/api/system/health-matrix")).status, 401);
  assert.equal((await callLoungeWorker(ctx.env, "GET", "/api/system/health-matrix", { token: consumerTok })).status, 403);

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, ram_mb: 42.5, uptime_sec: 120 }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const devRes = await callLoungeWorker(ctx.env, "GET", "/api/system/health-matrix", { token: devTok });
    assert.equal(devRes.status, 200);
    assert.equal(devRes.data.matrix.d1.ok, true);
    assert.equal(devRes.data.matrix.r2.ok, true);
    assert.equal(devRes.data.matrix.elixir.ok, true);
    assert.equal(devRes.data.matrix.envBindings.DB, true);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("DELETE /api/client-error requires Developer role and clears logs", async () => {
  const ctx = createTelemetryEnv();
  const devTok = makeLoungeSessionToken({ role: "developer" });
  const consumerTok = makeLoungeSessionToken({ role: "consumer" });

  assert.equal((await callLoungeWorker(ctx.env, "DELETE", "/api/client-error", { token: consumerTok })).status, 403);
  const delRes = await callLoungeWorker(ctx.env, "DELETE", "/api/client-error?olderThanHours=24", { token: devTok });
  assert.equal(delRes.status, 200);
  assert.equal(delRes.data.cleared, true);
});
