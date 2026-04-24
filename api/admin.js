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

    if (action === "v2_import_leader") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

      const userId = String(req.query?.userId || a.userId || "").trim();
      if (!userId) return res.status(400).json({ error: "userId required" });

      const { data, error } = await supabase.from("app_state").select("state").eq("id", userId).maybeSingle();
      if (error) throw error;
      const st = data?.state;
      if (!st) return res.status(404).json({ error: "state_not_found" });

      const users = Array.isArray(st.users) ? st.users : [];
      const groups = Array.isArray(st.groups) ? st.groups : [];
      const members = Array.isArray(st.groupMembers) ? st.groupMembers : [];
      const sessions = Array.isArray(st.sessions) ? st.sessions : [];

      // groups where user is leader (old model: isLeader boolean)
      const leaderGroupIds = new Set(
        members.filter((m) => m && m.userId === userId && m.isLeader).map((m) => String(m.groupId))
      );

      const tgUserIdsInScope = new Set([userId]);
      for (const m of members) {
        if (!m || !leaderGroupIds.has(String(m.groupId))) continue;
        const uid = String(m.userId || "");
        if (uid.startsWith("tg:") || uid.startsWith("email:")) tgUserIdsInScope.add(uid);
      }

      // 1) app_users upsert (minimal)
      for (const uid of tgUserIdsInScope) {
        const u = users.find((x) => x && x.id === uid);
        const row = { id: uid, display_name: u?.name || null };
        const up = await supabase.from("app_users").upsert(row);
        if (up.error) throw up.error;
      }

      // 2) app_groups + app_group_members
      let importedGroups = 0;
      let importedMembers = 0;
      for (const g of groups) {
        if (!g || !leaderGroupIds.has(String(g.id))) continue;
        const gRow = {
          id: String(g.id),
          name: String(g.name || "Группа"),
          type: String(g.type || "другое"),
          color: String(g.color || "#7aa7ff"),
          created_by: userId,
        };
        const gi = await supabase.from("app_groups").upsert(gRow);
        if (gi.error) throw gi.error;
        importedGroups++;

        const scopeMembers = members.filter((m) => m && String(m.groupId) === String(g.id));
        for (const m of scopeMembers) {
          const uid = String(m.userId || "");
          if (!(uid.startsWith("tg:") || uid.startsWith("email:"))) continue; // skip local contacts for now
          const role = m.isLeader ? "leader" : "participant";
          const mi = await supabase.from("app_group_members").upsert({ group_id: String(g.id), user_id: uid, role });
          if (mi.error) throw mi.error;
          importedMembers++;
        }
      }

      // 3) seminars + blocks + leaders
      let importedSeminars = 0;
      let importedBlocks = 0;
      let importedLeaders = 0;
      const sessionsInScope = sessions.filter((s) => s && leaderGroupIds.has(String(s.groupId)));
      for (const s of sessionsInScope) {
        const semRow = {
          id: String(s.id),
          group_id: String(s.groupId),
          status: String(s.status || "предварительно"),
          title: null,
          note: s.note != null ? String(s.note) : null,
          theme: s.theme != null ? String(s.theme) : null,
          summary: s.summary != null ? String(s.summary) : null,
          private_notes: s.privateNotes != null ? String(s.privateNotes) : null,
          created_by: userId,
        };
        const si = await supabase.from("app_seminars").upsert(semRow);
        if (si.error) throw si.error;
        importedSeminars++;

        const blocks = Array.isArray(s.blocks) ? s.blocks : [];
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i] || {};
          const day = String(b.date || "").trim();
          if (!day) continue;
          const id = b.id ? String(b.id) : `${String(s.id)}_${day}_${i}`;
          const bi = await supabase.from("app_seminar_blocks").upsert({
            id,
            seminar_id: String(s.id),
            day,
            start_time: String(b.startTime || ""),
            end_time: String(b.endTime || ""),
            sort_order: i,
          });
          if (bi.error) throw bi.error;
          importedBlocks++;
        }

        const leaders = Array.isArray(s.leaders) ? s.leaders : [];
        for (const l of leaders) {
          const uid = String(l?.userId || "");
          if (!(uid.startsWith("tg:") || uid.startsWith("email:"))) continue;
          if (!tgUserIdsInScope.has(uid)) {
            // ensure leader exists in app_users
            const u = users.find((x) => x && x.id === uid);
            const up = await supabase.from("app_users").upsert({ id: uid, display_name: u?.name || null });
            if (up.error) throw up.error;
            tgUserIdsInScope.add(uid);
          }
          const li = await supabase.from("app_seminar_leaders").upsert({
            seminar_id: String(s.id),
            user_id: uid,
            days: l.days === "all" ? "all" : Array.isArray(l.days) ? l.days : "all",
          });
          if (li.error) throw li.error;
          importedLeaders++;
        }
      }

      return res.status(200).json({
        ok: true,
        scope: { userId, leaderGroups: leaderGroupIds.size },
        imported: {
          groups: importedGroups,
          members: importedMembers,
          seminars: importedSeminars,
          blocks: importedBlocks,
          seminarLeaders: importedLeaders,
        },
        note: "Контакты без tg:/email: пока не импортируются (появятся после входа или отдельной модели contacts).",
      });
    }

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

