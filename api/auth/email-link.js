import { requireUserId } from "../_lib/auth.js";
import { linkEmailPassword } from "../_lib/accounts.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const a = requireUserId(req);
    if (!a.ok) return res.status(401).json({ error: "Unauthorized" });

    const { email, password } = req.body || {};
    const r = await linkEmailPassword({ userId: a.userId, email, password });
    if (!r.ok) return res.status(400).json({ error: r.error });
    return res.status(200).json({ ok: true, userId: r.userId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

