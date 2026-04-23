import { getSupabaseAdmin } from "../_lib/supabase.js";
import { buildEmptyState, validateState } from "../_lib/demoState.js";
import { requireUserId } from "../_lib/auth.js";

async function ensureRow(supabase, rowId) {
  const { data, error } = await supabase.from("app_state").select("id,state,updated_at").eq("id", rowId).maybeSingle();
  if (error) throw error;
  if (data?.state && Object.keys(data.state).length > 0) return data.state;
  const empty = buildEmptyState({ userId: rowId, displayName: "Вы" });
  const up = await supabase.from("app_state").upsert({ id: rowId, state: empty });
  if (up.error) throw up.error;
  return empty;
}

function getUserName(state, userId) {
  return (state?.users || []).find((u) => u.id === userId)?.name || null;
}

function upsertUser(state, user) {
  if (!user?.id) return;
  const idx = (state.users || []).findIndex((u) => u.id === user.id);
  if (idx === -1) state.users.push(user);
  else state.users[idx] = { ...state.users[idx], ...user };
}

function upsertGroup(state, g) {
  const idx = (state.groups || []).findIndex((x) => x.id === g.id);
  if (idx === -1) state.groups.push(g);
  else state.groups[idx] = { ...state.groups[idx], ...g };
}

function upsertGroupMember(state, m) {
  const idx = (state.groupMembers || []).findIndex((x) => x.groupId === m.groupId && x.userId === m.userId);
  if (idx === -1) state.groupMembers.push(m);
  else state.groupMembers[idx] = { ...state.groupMembers[idx], ...m };
}

function copySessionsForGroup(leaderState, groupId) {
  return (leaderState.sessions || []).filter((s) => s.groupId === groupId).map((s) => JSON.parse(JSON.stringify(s)));
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const a = requireUserId(req);
    if (!a.ok) return res.status(401).json({ error: "Unauthorized" });
    if (!a.userId.startsWith("tg:")) {
      return res.status(400).json({ error: "only_telegram", message: "Присоединиться можно только после входа через Telegram" });
    }

    const { token } = req.body || {};
    const t = String(token || "").trim();
    if (!t) return res.status(400).json({ error: "token required" });

    const supabase = getSupabaseAdmin();
    const inv = await supabase.from("app_invites").select("*").eq("token", t).maybeSingle();
    if (inv.error) throw inv.error;
    if (!inv.data) return res.status(404).json({ error: "invite_not_found" });
    if (inv.data.used_at || inv.data.used_by) return res.status(409).json({ error: "invite_used" });

    const leaderId = String(inv.data.created_by || "");
    const groupId = String(inv.data.group_id || "");
    const role = inv.data.role === "leader" ? "leader" : "participant";

    const leaderRow = await supabase.from("app_state").select("state").eq("id", leaderId).maybeSingle();
    if (leaderRow.error) throw leaderRow.error;
    const leaderState = leaderRow.data?.state || null;
    if (!leaderState) return res.status(404).json({ error: "leader_state_not_found" });
    const g = (leaderState.groups || []).find((x) => x.id === groupId);
    if (!g) return res.status(404).json({ error: "group_not_found" });

    const joinerState = await ensureRow(supabase, a.userId);

    // Мини-MVP: копируем группу и её встречи к участнику (без дальнейшей синхронизации).
    joinerState.users = Array.isArray(joinerState.users) ? joinerState.users : [];
    joinerState.groups = Array.isArray(joinerState.groups) ? joinerState.groups : [];
    joinerState.groupMembers = Array.isArray(joinerState.groupMembers) ? joinerState.groupMembers : [];
    joinerState.sessions = Array.isArray(joinerState.sessions) ? joinerState.sessions : [];

    const leaderName = getUserName(leaderState, leaderId) || "Тренер";
    upsertUser(joinerState, { id: leaderId, name: leaderName, profile: {} });
    upsertGroup(joinerState, JSON.parse(JSON.stringify(g)));
    for (const s of copySessionsForGroup(leaderState, groupId)) {
      if (!joinerState.sessions.some((x) => x.id === s.id)) joinerState.sessions.push(s);
    }

    // Лидер всегда есть как ведущий, присоединившийся — как participant/leader.
    upsertGroupMember(joinerState, { groupId, userId: leaderId, isLeader: true, isParticipant: false });
    upsertGroupMember(joinerState, {
      groupId,
      userId: a.userId,
      isLeader: role === "leader",
      isParticipant: role !== "leader",
    });

    const err = validateState(joinerState);
    if (err) return res.status(400).json({ error: err });

    const up = await supabase.from("app_state").upsert({ id: a.userId, state: joinerState });
    if (up.error) throw up.error;

    const mark = await supabase
      .from("app_invites")
      .update({ used_by: a.userId, used_at: new Date().toISOString() })
      .eq("token", t);
    if (mark.error) throw mark.error;

    return res.status(200).json({ ok: true, groupId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

