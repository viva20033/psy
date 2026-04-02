import { requireUserId } from "./_lib/auth.js";
import { getLinkedEmailForUser } from "./_lib/accounts.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
    const a = requireUserId(req);
    if (!a.ok) return res.status(401).json({ error: "Unauthorized" });
    const linked = await getLinkedEmailForUser(a.userId);
    const linkedEmail = linked.ok ? linked.email : null;
    return res.status(200).json({ userId: a.userId, linkedEmail });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

