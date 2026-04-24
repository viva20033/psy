import { getSupabaseAdmin } from "./_lib/supabase.js";
import { requireUserId, isSuperAdminUserId } from "./_lib/auth.js";
import { validateState } from "./_lib/demoState.js";

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function migrateIdInState(state, fromId, toId) {
  let changed = false;
  if (!state || typeof state !== "object") return { changed: false };
  const from = String(fromId || "");
  const to = String(toId || "");
  if (!from || !to || from === to) return { changed: false };

  if (state.meId === from) {
    state.meId = to;
    changed = true;
  }
  if (Array.isArray(state.users)) {
    for (const u of state.users) {
      if (u && u.id === from) {
        u.id = to;
        changed = true;
      }
    }
  }
  if (Array.isArray(state.groupMembers)) {
    for (const m of state.groupMembers) {
      if (m && m.userId === from) {
        m.userId = to;
        changed = true;
      }
    }
  }
  if (Array.isArray(state.sessions)) {
    for (const s of state.sessions) {
      if (!s || !Array.isArray(s.leaders)) continue;
      for (const l of s.leaders) {
        if (l && l.userId === from) {
          l.userId = to;
          changed = true;
        }
      }
    }
  }
  return { changed };
}

export default async function handler(req, res) {
  try {
    const a = requireUserId(req);
    if (!a.ok) return res.status(401).json({ error: "Unauthorized" });
    if (!isSuperAdminUserId(a.userId)) return res.status(403).json({ error: "forbidden" });

    const action = String(req.query?.action || "").trim();
    if (!action) return res.status(400).json({ error: "action required" });

    const supabase = getSupabaseAdmin();

    if (action === "state_get") {
      if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
      const userId = String(req.query?.userId || "").trim();
      if (!userId) return res.status(400).json({ error: "userId required" });

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
    }

    if (action === "migrate_me") {
      if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
      const userId = String(req.query?.userId || "").trim();
      const from = String(req.query?.from || "").trim();
      if (!userId) return res.status(400).json({ error: "userId required" });
      if (!from) return res.status(400).json({ error: "from required" });
      if (from === userId) return res.status(400).json({ error: "from must differ" });

      const { data, error } = await supabase.from("app_state").select("id,state,updated_at").eq("id", userId).maybeSingle();
      if (error) throw error;
      if (!data?.state) return res.status(404).json({ error: "not_found" });

      const st = data.state;
      const before = { meId: st.meId };
      const r = migrateIdInState(st, from, userId);
      if (!r.changed) return res.status(200).json({ ok: true, changed: false, message: "no changes" });

      // ensure user exists
      if (Array.isArray(st.users) && !st.users.some((u) => u && u.id === userId)) {
        st.users.push({ id: userId, name: "Вы", profile: {} });
      }
      st.meId = userId;

      const err = validateState(st);
      if (err) return res.status(400).json({ error: err });

      const up = await supabase.from("app_state").upsert({ id: userId, state: st });
      if (up.error) throw up.error;

      return res.status(200).json({ ok: true, changed: true, before, after: { meId: st.meId } });
    }

    if (action === "lookup_email") {
      if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
      const email = normEmail(req.query?.email || "");
      if (!email || !email.includes("@")) return res.status(400).json({ error: "email required" });

      const { data, error } = await supabase.from("app_accounts").select("user_id,email,created_at").eq("email", email).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "not_found" });

      return res.status(200).json({ ok: true, userId: data.user_id, email: data.email, created_at: data.created_at });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

