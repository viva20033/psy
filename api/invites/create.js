import crypto from "crypto";
import { getSupabaseAdmin } from "../_lib/supabase.js";
import { requireUserId } from "../_lib/auth.js";

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function token() {
  return base64url(crypto.randomBytes(24));
}

async function loadStateForUser(supabase, userId) {
  const { data, error } = await supabase.from("app_state").select("state").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data?.state || null;
}

function isLeaderInGroup(state, groupId, userId) {
  return (state?.groupMembers || []).some((m) => m.groupId === groupId && m.userId === userId && m.isLeader);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const a = requireUserId(req);
    if (!a.ok) return res.status(401).json({ error: "Unauthorized" });

    const { groupId, role } = req.body || {};
    if (!groupId || typeof groupId !== "string") return res.status(400).json({ error: "groupId required" });
    const r = role === "leader" ? "leader" : "participant";

    const supabase = getSupabaseAdmin();
    const myState = await loadStateForUser(supabase, a.userId);
    if (!myState) return res.status(404).json({ error: "state_not_found" });
    if (!isLeaderInGroup(myState, groupId, a.userId)) return res.status(403).json({ error: "forbidden", message: "Только ведущий может создавать приглашения" });

    const t = token();
    const ins = await supabase.from("app_invites").insert({ token: t, created_by: a.userId, group_id: groupId, role: r });
    if (ins.error) throw ins.error;

    return res.status(200).json({ ok: true, token: t });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

