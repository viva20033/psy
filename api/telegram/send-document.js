import { requireUserId } from "../_lib/auth.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};

/**
 * Отправка PDF в личку пользователю от бота (chat_id = telegram user id).
 * Тело: JSON { filename, caption?, data } — data в base64.
 */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const a = requireUserId(req);
    if (!a.ok) return res.status(401).json({ error: "Unauthorized" });
    if (!a.userId.startsWith("tg:")) {
      return res.status(400).json({ error: "only_telegram", message: "Доступно только при входе через Telegram" });
    }
    const chatId = a.userId.slice(3);

    const { filename, caption, data } = req.body || {};
    if (!data || typeof data !== "string") return res.status(400).json({ error: "missing data" });

    let buf;
    try {
      buf = Buffer.from(data, "base64");
    } catch {
      return res.status(400).json({ error: "bad base64" });
    }
    if (buf.length < 16) return res.status(400).json({ error: "empty file" });
    if (buf.length > 3.5 * 1024 * 1024) return res.status(400).json({ error: "file too large" });

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.status(500).json({ error: "TELEGRAM_BOT_TOKEN is not set" });

    const name = String(filename || "document.pdf")
      .replace(/[^\p{L}\d.\-_]+/gu, "_")
      .slice(0, 120);
    if (!name.toLowerCase().endsWith(".pdf")) {
      return res.status(400).json({ error: "filename must end with .pdf" });
    }

    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("document", new Blob([buf]), name);
    if (caption) form.append("caption", String(caption).slice(0, 1024));

    const url = `https://api.telegram.org/bot${token}/sendDocument`;
    const tg = await fetch(url, { method: "POST", body: form });
    const txt = await tg.text();
    let j;
    try {
      j = JSON.parse(txt);
    } catch {
      j = { ok: false, description: txt };
    }
    if (!tg.ok || !j.ok) {
      console.error("sendDocument", tg.status, txt);
      return res.status(502).json({ error: j.description || "telegram_error" });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
