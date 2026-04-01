import crypto from "crypto";

function base64urlEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlDecodeToBuffer(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Buffer.from(b64, "base64");
}

function sign(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest();
}

function json(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8");
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function issueSessionToken({ sub, ttlSeconds = 60 * 60 * 24 * 30 }) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const iat = nowSec();
  const exp = iat + ttlSeconds;
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { sub, iat, exp };
  const h = base64urlEncode(json(header));
  const p = base64urlEncode(json(payload));
  const data = `${h}.${p}`;
  const sig = base64urlEncode(sign(secret, data));
  return `${data}.${sig}`;
}

export function verifySessionToken(token) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return { ok: false, error: "bad token" };
  const [h, p, s] = parts;
  const data = `${h}.${p}`;
  const expected = base64urlEncode(sign(secret, data));
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return { ok: false, error: "bad signature" };
  let payload;
  try {
    payload = JSON.parse(base64urlDecodeToBuffer(p).toString("utf8"));
  } catch {
    return { ok: false, error: "bad payload" };
  }
  const t = nowSec();
  if (!payload?.sub || typeof payload.sub !== "string") return { ok: false, error: "no sub" };
  if (!payload?.exp || typeof payload.exp !== "number") return { ok: false, error: "no exp" };
  if (t >= payload.exp) return { ok: false, error: "expired" };
  return { ok: true, sub: payload.sub, payload };
}

export function parseCookies(req) {
  const header = req.headers?.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function setSessionCookie(res, token, { maxAgeSeconds = 60 * 60 * 24 * 30 } = {}) {
  const secure = process.env.VERCEL ? "Secure; " : "";
  const cookie = `psy_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; ${secure}Max-Age=${maxAgeSeconds}`;
  res.setHeader("Set-Cookie", cookie);
}

export function clearSessionCookie(res) {
  const secure = process.env.VERCEL ? "Secure; " : "";
  const cookie = `psy_session=; Path=/; HttpOnly; SameSite=Lax; ${secure}Max-Age=0`;
  res.setHeader("Set-Cookie", cookie);
}

export function requireUserId(req) {
  const cookies = parseCookies(req);
  const token = cookies.psy_session;
  const v = verifySessionToken(token);
  if (!v.ok) return { ok: false, error: v.error || "unauthorized" };
  return { ok: true, userId: v.sub };
}

