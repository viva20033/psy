import crypto from "crypto";
import { getSupabaseAdmin } from "./_lib/supabase.js";
import { buildEmptyState, validateState } from "./_lib/demoState.js";
import { requireUserId } from "./_lib/auth.js";

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function newToken() {
  return base64url(crypto.randomBytes(24));
}

async function loadStateRow(supabase, rowId) {
  const { data, error } = await supabase.from("app_state").select("state").eq("id", rowId).maybeSingle();
  if (error) throw error;
  return data?.state || null;
}

async function ensureRow(supabase, rowId) {
  const state = await loadStateRow(supabase, rowId);
  if (state && Object.keys(state).length > 0) return state;
  const empty = buildEmptyState({ userId: rowId, displayName: "Вы" });
  const up = await supabase.from("app_state").upsert({ id: rowId, state: empty });
  if (up.error) throw up.error;
  return empty;
}

function isLeaderInGroup(state, groupId, userId) {
  return (state?.groupMembers || []).some((m) => m && m.groupId === groupId && m.userId === userId && m.isLeader);
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
  const leaderUsers = Array.isArray(leaderState.users) ? leaderState.users : [];
  for (const u of leaderUsers) {
    if (!u || !u.id) continue;
    upsertUser(joinerState, JSON.parse(JSON.stringify(u)));
  }
}

function mergeGroupMembersForGroup(joinerState, leaderState, groupId) {
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

export default async function handler(req, res) {
  try {
    const a = requireUserId(req);
    if (!a.ok) return res.status(401).json({ error: "Unauthorized" });

    const action = String(req.query?.action || "").trim();
    if (!action) return res.status(400).json({ error: "action required" });

    const supabase = getSupabaseAdmin();

    if (action === "create") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const { groupId, role } = req.body || {};
      if (!groupId || typeof groupId !== "string") return res.status(400).json({ error: "groupId required" });
      const r = role === "leader" ? "leader" : "participant";

      const myState = await loadStateRow(supabase, a.userId);
      if (!myState) return res.status(404).json({ error: "state_not_found" });
      if (!isLeaderInGroup(myState, groupId, a.userId)) {
        return res.status(403).json({ error: "forbidden", message: "Только ведущий может создавать приглашения" });
      }

      const token = newToken();
      const ins = await supabase.from("app_invites").insert({ token, created_by: a.userId, group_id: groupId, role: r });
      if (ins.error) throw ins.error;
      return res.status(200).json({ ok: true, token });
    }

    if (action === "accept") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      if (!a.userId.startsWith("tg:")) {
        return res.status(400).json({ error: "only_telegram", message: "Присоединиться можно только после входа через Telegram" });
      }
      const { token } = req.body || {};
      const t = String(token || "").trim();
      if (!t) return res.status(400).json({ error: "token required" });

      const inv = await supabase.from("app_invites").select("*").eq("token", t).maybeSingle();
      if (inv.error) throw inv.error;
      if (!inv.data) return res.status(404).json({ error: "invite_not_found" });
      if (inv.data.used_at || inv.data.used_by) return res.status(409).json({ error: "invite_used" });

      const leaderId = String(inv.data.created_by || "");
      const groupId = String(inv.data.group_id || "");
      const role = inv.data.role === "leader" ? "leader" : "participant";

      const leaderState = await loadStateRow(supabase, leaderId);
      if (!leaderState) return res.status(404).json({ error: "leader_state_not_found" });
      const g = (leaderState.groups || []).find((x) => x && x.id === groupId);
      if (!g) return res.status(404).json({ error: "group_not_found" });

      const joinerState = await ensureRow(supabase, a.userId);
      joinerState.users = Array.isArray(joinerState.users) ? joinerState.users : [];
      joinerState.groups = Array.isArray(joinerState.groups) ? joinerState.groups : [];
      joinerState.groupMembers = Array.isArray(joinerState.groupMembers) ? joinerState.groupMembers : [];
      joinerState.sessions = Array.isArray(joinerState.sessions) ? joinerState.sessions : [];

      const gCopy = JSON.parse(JSON.stringify(g));
      gCopy.ownerLeaderId = leaderId;
      upsertGroup(joinerState, gCopy);

      mergeUsers(joinerState, leaderState);
      mergeGroupMembersForGroup(joinerState, leaderState, groupId);
      mergeSessionsForGroup(joinerState, leaderState, groupId);

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

      const mark = await supabase.from("app_invites").update({ used_by: a.userId, used_at: new Date().toISOString() }).eq("token", t);
      if (mark.error) throw mark.error;

      return res.status(200).json({ ok: true, groupId });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

