export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    try {
      // Helper: Buat tabel catalog_store otomatis jika belum ada
      const ensureTableExists = async () => {
        if (env.DB) {
          await env.DB.prepare(
            "CREATE TABLE IF NOT EXISTS catalog_store (id INTEGER PRIMARY KEY, data TEXT, updated_at TEXT)"
          ).run();
        }
      };

      // Endpoint 1: Direct Upload URL ke Cloudflare Stream
      if (url.pathname === "/api/get-upload-url" && request.method === "POST") {
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

      // Endpoint 2: GET Data dari D1 Database
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

      // Endpoint 3: SAVE Data ke D1 Database
      if (url.pathname === "/api/save" && request.method === "POST") {
        if (!env.DB) throw new Error("D1 Database binding missing");
        await ensureTableExists();

        const body = await request.json();
        const jsonString = JSON.stringify(body);

        await env.DB.prepare(
          "INSERT INTO catalog_store (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
        ).bind(jsonString, new Date().toISOString()).run();

        return new Response(JSON.stringify({ success: true, message: "Data berhasil disimpan di D1!" }), {
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