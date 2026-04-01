import crypto from "crypto";
import { getSupabaseAdmin } from "./supabase.js";

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashPassword(pw, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  const key = crypto.scryptSync(String(pw || ""), salt, 32);
  return key.toString("hex");
}

export async function ensureAccountsTable() {
  // Table is created by SQL in README; this is a no-op placeholder to keep flow explicit.
  return true;
}

export async function linkEmailPassword({ userId, email, password }) {
  if (!String(userId || "").startsWith("tg:")) return { ok: false, error: "Привязка доступна только после входа через Telegram" };
  const e = normEmail(email);
  if (!e || !e.includes("@")) return { ok: false, error: "Некорректный email" };
  if (String(password || "").length < 6) return { ok: false, error: "Пароль должен быть минимум 6 символов" };

  const supabase = getSupabaseAdmin();
  const salt = crypto.randomBytes(16).toString("hex");
  const pwHash = hashPassword(password, salt);

  const { error } = await supabase.from("app_accounts").insert({ user_id: userId, email: e, salt, pw_hash: pwHash });
  if (error) {
    if (String(error.message || "").toLowerCase().includes("duplicate")) return { ok: false, error: "Аккаунт уже существует" };
    return { ok: false, error: error.message || String(error) };
  }
  return { ok: true, userId };
}

export async function verifyEmailPassword({ email, password }) {
  const e = normEmail(email);
  if (!e || !e.includes("@")) return { ok: false, error: "Некорректный email" };
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.from("app_accounts").select("user_id,salt,pw_hash").eq("email", e).maybeSingle();
  if (error) return { ok: false, error: error.message || String(error) };
  if (!data) return { ok: false, error: "Аккаунт не найден" };

  const expected = String(data.pw_hash || "");
  const actual = hashPassword(password, data.salt);
  const ok = expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  if (!ok) return { ok: false, error: "Неверный пароль" };
  return { ok: true, userId: data.user_id };
}

