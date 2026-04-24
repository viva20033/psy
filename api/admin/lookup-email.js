import { getSupabaseAdmin } from "../_lib/supabase.js";
import { requireUserId, isSuperAdminUserId } from "../_lib/auth.js";

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
    const a = requireUserId(req);
    if (!a.ok) return res.status(401).json({ error: "Unauthorized" });
    if (!isSuperAdminUserId(a.userId)) return res.status(403).json({ error: "forbidden" });

    const email = normEmail(req.query?.email || "");
    if (!email || !email.includes("@")) return res.status(400).json({ error: "email required" });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("app_accounts").select("user_id,email,created_at").eq("email", email).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "not_found" });

    return res.status(200).json({ ok: true, userId: data.user_id, email: data.email, created_at: data.created_at });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

