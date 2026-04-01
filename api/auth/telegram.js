import crypto from "crypto";
import { issueSessionToken, setSessionCookie } from "../_lib/auth.js";

function parseInitData(initData) {
  // Важно: URLSearchParams декодирует '+' как пробел, что может ломать проверку подписи.
  // Парсим вручную и декодируем через decodeURIComponent (без замены '+').
  const raw = String(initData || "");
  const out = {};
  for (const part of raw.split("&")) {
    if (!part) continue;
    const idx = part.indexOf("=");
    const kRaw = idx === -1 ? part : part.slice(0, idx);
    const vRaw = idx === -1 ? "" : part.slice(idx + 1);
    const k = decodeURIComponent(kRaw);
    const v = decodeURIComponent(vRaw);
    out[k] = v;
  }
  return out;
}

function verifyTelegramInitData({ initData, botToken }) {
  const data = parseInitData(initData);
  const providedHash = data.hash;
  if (!providedHash) return { ok: false, error: "Missing hash" };

  const pairs = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === "hash") continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const ok = computed.length === providedHash.length && crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(providedHash));
  if (!ok) return { ok: false, error: "Bad signature" };

  // Optional freshness: auth_date within 1 day
  const authDate = Number(data.auth_date || 0);
  if (Number.isFinite(authDate) && authDate > 0) {
    const age = Math.floor(Date.now() / 1000) - authDate;
    if (age > 86400) return { ok: false, error: "initData too old" };
  }

  let user = null;
  if (data.user) {
    try {
      user = JSON.parse(data.user);
    } catch {
      user = null;
    }
  }
  const tgId = user?.id;
  if (!tgId) return { ok: false, error: "Missing user id" };
  return { ok: true, tgId: String(tgId), user };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return res.status(500).json({ error: "TELEGRAM_BOT_TOKEN is not set" });

    const { initData } = req.body || {};
    const v = verifyTelegramInitData({ initData, botToken });
    if (!v.ok) return res.status(401).json({ error: v.error });

    const userId = `tg:${v.tgId}`;
    const token = issueSessionToken({ sub: userId });
    setSessionCookie(res, token);
    return res.status(200).json({ ok: true, userId, tg: v.user || null });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

