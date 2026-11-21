export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const token = env.TG_BOT_TOKEN;
    const chatId = env.TG_ADMIN_CHAT_ID;

    if (!token || !chatId) {
      return new Response(JSON.stringify({ ok: false, error: "Server Telegram env belum dikonfigurasi." }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const body = await request.json().catch(() => ({}));
    const ticket = String(body.ticket || "").trim();
    const username = String(body.username || "").replace(/^@/, "").trim();
    const amount = Number(body.amount || 0);
    const fee = Number(body.fee || 2500);
    const netAmount = Number(body.netAmount || Math.max(0, amount - fee));
    const method = String(body.method || "").trim();
    const accNo = String(body.accNo || "").trim();
    const accName = String(body.accName || "").trim();
    const note = String(body.note || "Salah nominal top-up").trim();

    if (!ticket || !username || amount < 10000 || !method || !accNo || !accName) {
      return new Response(JSON.stringify({ ok: false, error: "Data tiket penarikan tidak lengkap." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const rp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const text =
      "💸 <b>TIKET PENARIKAN / REFUND SALDO</b>\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "🎫 <b>Tiket:</b> <code>" + esc(ticket) + "</code>\n" +
      "👤 <b>Akun:</b> @" + esc(username) + "\n" +
      "💰 <b>Potong Saldo:</b> " + rp(amount) + "\n" +
      "🧾 <b>Admin Refund:</b> " + rp(fee) + "\n" +
      "✅ <b>Transfer Bersih:</b> <b>" + rp(netAmount) + "</b>\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "🏦 <b>Bank/E-Wallet:</b> " + esc(method) + "\n" +
      "🔢 <b>No. Rek/HP:</b> <code>" + esc(accNo) + "</code>\n" +
      "🪪 <b>Atas Nama:</b> " + esc(accName) + "\n" +
      "📝 <b>Catatan:</b> " + esc(note) + "\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "⚠️ <i>Saldo user sudah otomatis terpotong. Silakan admin proses transfer manual.</i>";

    const tgRes = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });

    const tgData = await tgRes.json().catch(() => ({}));
    if (!tgRes.ok || !tgData.ok) {
      return new Response(JSON.stringify({ ok: false, error: tgData.description || "Gagal kirim ke Telegram." }), {
        status: 502,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: true, message_id: tgData.result && tgData.result.message_id }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
