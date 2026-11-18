export default {
  async fetch(request, env, ctx) {
    const allowedOrigins = [
      "https://clubsnight.my.id",
      "https://www.clubsnight.my.id",
      "http://localhost:5173"
    ];
    const origin = request.headers.get("Origin") || "";
    const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Helper: Verifikasi Bearer Token terhadap Secret Variable Cloudflare
    const isAuthorized = () => {
      const authHeader = request.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      const validSecret = env.ADMIN_SECRET_TOKEN;
      if (!validSecret || !token) return false;
      return token === validSecret;
    };

    try {
      const ensureTableExists = async () => {
        if (env.DB) {
          await env.DB.prepare(
            "CREATE TABLE IF NOT EXISTS catalog_store (id INTEGER PRIMARY KEY, data TEXT, updated_at TEXT)"
          ).run();
        }
      };

      // Endpoint 0: Verifikasi Login Admin / PIN Developer dari Frontend
      if (url.pathname === "/api/verify-auth" && request.method === "POST") {
        if (!isAuthorized()) {
          return new Response(JSON.stringify({ success: false, error: "Kredensial atau PIN tidak valid!" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify({ success: true, message: "Autentikasi berhasil" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Endpoint 1: Direct Upload URL ke Cloudflare Stream (Wajib Token Admin)
      if (url.pathname === "/api/get-upload-url" && request.method === "POST") {
        if (!isAuthorized()) {
          return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;
        const API_TOKEN = env.CLOUDFLARE_STREAM_TOKEN;

        if (!ACCOUNT_ID || !API_TOKEN) {
          return new Response(JSON.stringify({ success: false, error: "Stream credentials missing" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const streamResponse = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/direct_upload`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${API_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              maxDurationSeconds: 60,
              expiry: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            }),
          }
        );

        const resultData = await streamResponse.json();
        return new Response(JSON.stringify(resultData), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Endpoint 2: GET Data dari D1 Database (Publik - Read Only)
      if (url.pathname === "/api/get" && request.method === "GET") {
        if (!env.DB) throw new Error("D1 Database binding missing");
        await ensureTableExists();

        const row = await env.DB.prepare("SELECT data FROM catalog_store WHERE id = 1").first();
        let storeData = { talents: [], banners: [], favorites: [] };

        if (row && row.data) {
          try {
            storeData = JSON.parse(row.data);
          } catch (e) {}
        }

        return new Response(JSON.stringify({ success: true, data: storeData }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Endpoint 3: SAVE Data ke D1 Database (Wajib Token Admin)
      if (url.pathname === "/api/save" && request.method === "POST") {
        if (!isAuthorized()) {
          return new Response(JSON.stringify({ success: false, error: "Akses ditolak: Token tidak sah" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (!env.DB) throw new Error("D1 Database binding missing");
        await ensureTableExists();

        const body = await request.json();
        if (!body || typeof body !== "object" || !Array.isArray(body.talents)) {
          return new Response(JSON.stringify({ success: false, error: "Format payload tidak valid" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const jsonString = JSON.stringify(body);

        await env.DB.prepare(
          "INSERT INTO catalog_store (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
        ).bind(jsonString, new Date().toISOString()).run();

        return new Response(JSON.stringify({ success: true, message: "Data berhasil disimpan dengan aman di D1!" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
