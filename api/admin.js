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

function stateCounts(state) {
  return state
    ? {
        users: Array.isArray(state.users) ? state.users.length : 0,
        groups: Array.isArray(state.groups) ? state.groups.length : 0,
        groupMembers: Array.isArray(state.groupMembers) ? state.groupMembers.length : 0,
        sessions: Array.isArray(state.sessions) ? state.sessions.length : 0,
      }
    : { users: 0, groups: 0, groupMembers: 0, sessions: 0 };
}

export default async function handler(req, res) {
  try {
    const a = requireUserId(req);
    if (!a.ok) return res.status(401).json({ error: "Unauthorized" });
    if (!isSuperAdminUserId(a.userId)) return res.status(403).json({ error: "forbidden" });

    const action = String(req.query?.action || "").trim();
    if (!action) return res.status(400).json({ error: "action required" });

    const supabase = getSupabaseAdmin();

    if (action === "overview") {
      if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

      const legacyRows = await supabase
        .from("app_state")
        .select("id,updated_at,state")
        .order("updated_at", { ascending: false })
        .limit(25);
      if (legacyRows.error) throw legacyRows.error;

      const legacy = (legacyRows.data || []).map((row) => ({
        id: row.id,
        updated_at: row.updated_at,
        counts: stateCounts(row.state),
      }));

      const countTable = async (table) => {
        const r = await supabase.from(table).select("*", { count: "exact", head: true });
        if (r.error) return { table, count: null, error: r.error.message || String(r.error) };
        return { table, count: r.count || 0 };
      };

      const [usersCount, groupsCount, membersCount, seminarsCount, blocksCount, invitesCount, oldInvitesCount] = await Promise.all([
        countTable("app_users"),
        countTable("app_groups"),
        countTable("app_group_members"),
        countTable("app_seminars"),
        countTable("app_seminar_blocks"),
        countTable("app_group_invites"),
        countTable("app_invites"),
      ]);

      const groups = await supabase
        .from("app_groups")
        .select("id,name,type,color,created_by,created_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (groups.error) throw groups.error;

      const members = await supabase
        .from("app_group_members")
        .select("group_id,user_id,role,created_at,app_groups(id,name),app_users(id,display_name,tg_username)")
        .order("created_at", { ascending: false })
        .limit(80);
      if (members.error) throw members.error;

      const seminars = await supabase
        .from("app_seminars")
        .select("id,group_id,status,title,theme,created_by,created_at,updated_at,app_groups(id,name)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (seminars.error) throw seminars.error;

      const blocks = await supabase
        .from("app_seminar_blocks")
        .select("id,seminar_id,day,start_time,end_time,sort_order,app_seminars(id,group_id,title,app_groups(id,name))")
        .order("day", { ascending: true })
        .limit(80);
      if (blocks.error) throw blocks.error;

      const invites = await supabase
        .from("app_group_invites")
        .select("token,group_id,role,created_by,created_at,used_by,used_at,app_groups(id,name)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (invites.error) throw invites.error;

      return res.status(200).json({
        ok: true,
        admin: { userId: a.userId },
        legacy,
        stats: {
          legacyRows: legacy.length,
          v2: {
            users: usersCount,
            groups: groupsCount,
            members: membersCount,
            seminars: seminarsCount,
            blocks: blocksCount,
            invites: invitesCount,
            legacyInvites: oldInvitesCount,
          },
        },
        v2: {
          groups: groups.data || [],
          members: members.data || [],
          seminars: seminars.data || [],
          blocks: blocks.data || [],
          invites: invites.data || [],
        },
      });
    }

    if (action === "people_overview") {
      if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

      const usersRes = await supabase
        .from("app_users")
        .select("id,display_name,tg_username,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (usersRes.error) throw usersRes.error;

      const accountsRes = await supabase.from("app_accounts").select("user_id,email,created_at").limit(500);
      if (accountsRes.error) throw accountsRes.error;
      const emailByUser = new Map((accountsRes.data || []).map((x) => [x.user_id, x.email]));

      const membersRes = await supabase
        .from("app_group_members")
        .select("group_id,user_id,role,created_at,app_groups(id,name,type,color)")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (membersRes.error) throw membersRes.error;

      const today = new Date();
      const yyyy = today.getUTCFullYear();
      const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(today.getUTCDate()).padStart(2, "0");
      const todayIso = `${yyyy}-${mm}-${dd}`;

      const blocksRes = await supabase
        .from("app_seminar_blocks")
        .select("id,seminar_id,day,start_time,end_time,app_seminars(id,group_id,status,title,theme,app_groups(id,name,type,color))")
        .gte("day", todayIso)
        .order("day", { ascending: true })
        .limit(500);
      if (blocksRes.error) throw blocksRes.error;

      const membershipsByUser = new Map();
      for (const m of membersRes.data || []) {
        const arr = membershipsByUser.get(m.user_id) || [];
        arr.push({
          groupId: m.group_id,
          role: m.role,
          group: m.app_groups || null,
        });
        membershipsByUser.set(m.user_id, arr);
      }

      const nextBlocksByGroup = new Map();
      for (const b of blocksRes.data || []) {
        const gid = b.app_seminars?.group_id;
        if (!gid) continue;
        const arr = nextBlocksByGroup.get(gid) || [];
        if (arr.length < 5) {
          arr.push({
            id: b.id,
            day: b.day,
            start_time: b.start_time,
            end_time: b.end_time,
            seminarId: b.seminar_id,
            seminar: b.app_seminars || null,
          });
        }
        nextBlocksByGroup.set(gid, arr);
      }

      const people = (usersRes.data || []).map((u) => {
        const memberships = membershipsByUser.get(u.id) || [];
        const roleCounts = memberships.reduce(
          (acc, m) => {
            if (m.role === "leader") acc.leader += 1;
            else acc.participant += 1;
            return acc;
          },
          { leader: 0, participant: 0 }
        );
        const next = [];
        for (const m of memberships) {
          for (const b of nextBlocksByGroup.get(m.groupId) || []) {
            next.push({ ...b, group: m.group, role: m.role });
          }
        }
        next.sort((a, b) => String(a.day || "").localeCompare(String(b.day || "")));
        return {
          id: u.id,
          type: "user",
          display_name: u.display_name || "",
          tg_username: u.tg_username || "",
          email: emailByUser.get(u.id) || null,
          created_at: u.created_at,
          updated_at: u.updated_at,
          roleCounts,
          memberships,
          nextBlocks: next.slice(0, 5),
        };
      });

      // Legacy contacts without account, useful during migration.
      const legacyRows = await supabase.from("app_state").select("id,state,updated_at").order("updated_at", { ascending: false }).limit(50);
      if (legacyRows.error) throw legacyRows.error;
      const contacts = [];
      const seenContacts = new Set();
      for (const row of legacyRows.data || []) {
        const st = row.state || {};
        const users = Array.isArray(st.users) ? st.users : [];
        const members = Array.isArray(st.groupMembers) ? st.groupMembers : [];
        const groups = Array.isArray(st.groups) ? st.groups : [];
        for (const u of users) {
          if (!u || !String(u.id || "").startsWith("u_")) continue;
          const key = `${row.id}:${u.id}`;
          if (seenContacts.has(key)) continue;
          seenContacts.add(key);
          const ms = members
            .filter((m) => m && m.userId === u.id)
            .map((m) => ({
              groupId: m.groupId,
              role: m.isLeader ? "leader" : "participant",
              group: groups.find((g) => g && g.id === m.groupId) || null,
            }));
          contacts.push({
            id: u.id,
            type: "legacy_contact",
            display_name: u.name || "",
            ownerUserId: row.id,
            updated_at: row.updated_at,
            memberships: ms,
            roleCounts: {
              leader: ms.filter((m) => m.role === "leader").length,
              participant: ms.filter((m) => m.role !== "leader").length,
            },
          });
        }
      }

      return res.status(200).json({
        ok: true,
        people,
        legacyContacts: contacts.slice(0, 300),
        totals: {
          users: people.length,
          legacyContacts: contacts.length,
          memberships: (membersRes.data || []).length,
          upcomingBlocks: (blocksRes.data || []).length,
        },
      });
    }

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
      const counts = stateCounts(state);

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

