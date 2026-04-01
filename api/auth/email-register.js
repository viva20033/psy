import { issueSessionToken, setSessionCookie } from "../_lib/auth.js";
import { registerEmailPassword } from "../_lib/accounts.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const { email, password } = req.body || {};
    const r = await registerEmailPassword({ email, password });
    if (!r.ok) return res.status(400).json({ error: r.error });
    const token = issueSessionToken({ sub: r.userId });
    setSessionCookie(res, token);
    return res.status(200).json({ ok: true, userId: r.userId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

