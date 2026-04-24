import { getSupabaseAdmin } from "../_lib/supabase.js";
import { requireUserId, isSuperAdminUserId } from "../_lib/auth.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
    const a = requireUserId(req);
    if (!a.ok) return res.status(401).json({ error: "Unauthorized" });
    if (!isSuperAdminUserId(a.userId)) return res.status(403).json({ error: "forbidden" });

    const userId = String(req.query?.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "userId required" });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("app_state").select("id,updated_at,state").eq("id", userId).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "not_found" });

    const state = data.state || null;
    const counts = state
      ? {
          users: Array.isArray(state.users) ? state.users.length : 0,
          groups: Array.isArray(state.groups) ? state.groups.length : 0,
          groupMembers: Array.isArray(state.groupMembers) ? state.groupMembers.length : 0,
          sessions: Array.isArray(state.sessions) ? state.sessions.length : 0,
        }
      : { users: 0, groups: 0, groupMembers: 0, sessions: 0 };

    return res.status(200).json({ ok: true, row: { id: data.id, updated_at: data.updated_at }, counts, state });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

