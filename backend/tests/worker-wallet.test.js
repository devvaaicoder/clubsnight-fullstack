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
