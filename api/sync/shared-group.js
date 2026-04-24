import { getSupabaseAdmin } from "../_lib/supabase.js";
import { validateState } from "../_lib/demoState.js";
import { requireUserId } from "../_lib/auth.js";

async function loadStateRow(supabase, rowId) {
  const { data, error } = await supabase.from("app_state").select("state").eq("id", rowId).maybeSingle();
  if (error) throw error;
  return data?.state || null;
}

function upsertUser(state, user) {
  if (!user?.id) return;
  state.users = Array.isArray(state.users) ? state.users : [];
  const idx = state.users.findIndex((u) => u.id === user.id);
  if (idx === -1) state.users.push(user);
  else state.users[idx] = { ...state.users[idx], ...user };
}

function upsertGroup(state, g) {
  state.groups = Array.isArray(state.groups) ? state.groups : [];
  const idx = state.groups.findIndex((x) => x.id === g.id);
  if (idx === -1) state.groups.push(g);
  else state.groups[idx] = { ...state.groups[idx], ...g };
}

function upsertGroupMember(state, m) {
  state.groupMembers = Array.isArray(state.groupMembers) ? state.groupMembers : [];
  const idx = state.groupMembers.findIndex((x) => x.groupId === m.groupId && x.userId === m.userId);
  if (idx === -1) state.groupMembers.push(m);
  else state.groupMembers[idx] = { ...state.groupMembers[idx], ...m };
}

function mergeUsers(joinerState, leaderState) {
  joinerState.users = Array.isArray(joinerState.users) ? joinerState.users : [];
  const leaderUsers = Array.isArray(leaderState.users) ? leaderState.users : [];
  for (const u of leaderUsers) {
    if (!u || !u.id) continue;
    upsertUser(joinerState, JSON.parse(JSON.stringify(u)));
  }
}

function mergeGroupMembersForGroup(joinerState, leaderState, groupId) {
  joinerState.groupMembers = Array.isArray(joinerState.groupMembers) ? joinerState.groupMembers : [];
  const leaderMembers = (leaderState.groupMembers || []).filter((m) => m && m.groupId === groupId);
  for (const m of leaderMembers) {
    upsertGroupMember(joinerState, JSON.parse(JSON.stringify(m)));
  }
}

function mergeSessionsForGroup(joinerState, leaderState, groupId) {
  joinerState.sessions = Array.isArray(joinerState.sessions) ? joinerState.sessions : [];
  const leaderSessions = (leaderState.sessions || []).filter((s) => s && s.groupId === groupId);
  for (const s of leaderSessions) {
    const copy = JSON.parse(JSON.stringify(s));
    const idx = joinerState.sessions.findIndex((x) => x && x.id === copy.id);
    if (idx === -1) joinerState.sessions.push(copy);
    else joinerState.sessions[idx] = copy;
  }
}

function inferOwnerLeaderId(joinerState, joinerId, groupId) {
  const g = (joinerState.groups || []).find((x) => x && x.id === groupId);
  if (g?.ownerLeaderId && typeof g.ownerLeaderId === "string") return g.ownerLeaderId;

  const leaders = (joinerState.groupMembers || []).filter((m) => m && m.groupId === groupId && m.isLeader).map((m) => m.userId);
  const candidates = leaders.filter((uid) => uid && uid !== joinerId);
  // если несколько ведущих — берём первого не-joiner (MVP)
  return candidates[0] || null;
}

function isMemberOfGroup(joinerState, joinerId, groupId) {
  return (joinerState.groupMembers || []).some((m) => m && m.groupId === groupId && m.userId === joinerId && (m.isLeader || m.isParticipant));
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const a = requireUserId(req);
    if (!a.ok) return res.status(401).json({ error: "Unauthorized" });

    const { groupId } = req.body || {};
    const gid = String(groupId || "").trim();
    if (!gid) return res.status(400).json({ error: "groupId required" });

    const supabase = getSupabaseAdmin();
    const joinerId = a.userId;
    const joinerState = await loadStateRow(supabase, joinerId);
    if (!joinerState) return res.status(404).json({ error: "state_not_found" });

    if (!isMemberOfGroup(joinerState, joinerId, gid)) {
      return res.status(403).json({ error: "forbidden", message: "Нет доступа к этой группе" });
    }

    const leaderId = inferOwnerLeaderId(joinerState, joinerId, gid);
    if (!leaderId) return res.status(400).json({ error: "owner_leader_unknown" });

    const leaderState = await loadStateRow(supabase, leaderId);
    if (!leaderState) return res.status(404).json({ error: "leader_state_not_found" });

    const g = (leaderState.groups || []).find((x) => x && x.id === gid);
    if (!g) return res.status(404).json({ error: "group_not_found_on_leader" });

    const gCopy = JSON.parse(JSON.stringify(g));
    gCopy.ownerLeaderId = leaderId;
    upsertGroup(joinerState, gCopy);

    mergeUsers(joinerState, leaderState);
    mergeGroupMembersForGroup(joinerState, leaderState, gid);
    mergeSessionsForGroup(joinerState, leaderState, gid);

    const err = validateState(joinerState);
    if (err) return res.status(400).json({ error: err });

    const up = await supabase.from("app_state").upsert({ id: joinerId, state: joinerState });
    if (up.error) throw up.error;

    return res.status(200).json({ ok: true, groupId: gid, leaderId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
