export default {
  async fetch(request, env, ctx) {
    const allowedOrigins = [
      "https://clubsnight.my.id", "http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://127.0.0.1:5173", "http://127.0.0.1:5174", "http://127.0.0.1:5175",
      "https://www.clubsnight.my.id"
    ];
    const origin = request.headers.get("Origin") || "";
    const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const isPagesPreview = /^https:\/\/[a-z0-9-]+\.clubsnight-id\.pages\.dev$/.test(origin);
    const corsOrigin = (allowedOrigins.includes(origin) || isLocalhost || isPagesPreview) ? origin : allowedOrigins[0];

    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Verifikasi Token / PIN Developer terhadap Secret Variable Cloudflare
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

      // 1. Verifikasi Login Admin / PIN Menu Developer
      if (url.pathname === "/api/verify-auth" && request.method === "POST") {
        if (!isAuthorized()) {
          await new Promise(r => setTimeout(r, 1500));
          return new Response(JSON.stringify({ success: false, error: "PIN atau Token tidak valid!" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify({ success: true, message: "Verifikasi berhasil!" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 2. Ambil Data Katalog dari D1 (Publik - Read Only)
      if (url.pathname === "/api/get" && request.method === "GET") {
        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();

        const row = await env.DB.prepare("SELECT data FROM catalog_store WHERE id = 1").first();
        let storeData = { talents: [], banners: [], vouchers: [], favorites: [] };

        if (row && row.data) {
          try {
            storeData = JSON.parse(row.data);
          } catch (e) {}
        }

        return new Response(JSON.stringify({ success: true, data: storeData }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 3. Simpan Data Katalog ke D1 (Wajib Auth)
      if (url.pathname === "/api/save" && request.method === "POST") {
        if (!isAuthorized()) {
          return new Response(JSON.stringify({ success: false, error: "Akses ditolak: Token tidak sah" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (!env.DB) throw new Error("Binding D1 (DB) belum terpasang");
        await ensureTableExists();

        const body = await request.json();
        if (!body || typeof body !== "object" || !Array.isArray(body.talents)) {
          return new Response(JSON.stringify({ success: false, error: "Payload tidak valid" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        await env.DB.prepare(
          "INSERT INTO catalog_store (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
        ).bind(JSON.stringify(body), new Date().toISOString()).run();

        return new Response(JSON.stringify({ success: true, message: "Tersimpan aman di D1!" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 4. Upload Foto & Video ke Cloudflare R2 (Wajib Auth)
      if (url.pathname === "/upload" && request.method === "POST") {
        if (!isAuthorized()) {
          return new Response(JSON.stringify({ success: false, message: "Akses upload ditolak: Token tidak sah" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        if (!env.BUCKET) throw new Error("Binding R2 (BUCKET) belum terpasang");

        const formData = await request.formData();
        const file = formData.get("file");
        const mediaType = formData.get("type") || "image";

        if (!file || typeof file === "string") {
          return new Response(JSON.stringify({ success: false, message: "File tidak ditemukan" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const allowedMimes = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"];
        if (file.type && !allowedMimes.includes(file.type)) {
          return new Response(JSON.stringify({ success: false, message: "Format file dilarang demi keamanan!" }), {
            status: 415,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        const folder = mediaType === "video" ? "assets-video" : "assets-pict";
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const objectKey = `${folder}/${Date.now()}_${safeName}`;

        await env.BUCKET.put(objectKey, file.stream(), {
          httpMetadata: {
            contentType: file.type || (mediaType === "video" ? "video/mp4" : "image/jpeg")
          }
        });

        const publicDomain = (env.R2_PUBLIC_URL || "https://media-cn.my.id").replace(/\/$/, "");
        const fileUrl = `${publicDomain}/${objectKey}`;

        return new Response(JSON.stringify({ success: true, url: fileUrl }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });

    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message, message: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
