import crypto from "crypto";
import { getSupabaseAdmin } from "./_lib/supabase.js";
import { requireUserId } from "./_lib/auth.js";

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function ok(res, obj) {
  return res.status(200).json({ ok: true, ...obj });
}

function bad(res, status, obj) {
  return res.status(status).json({ ok: false, ...obj });
}

function requireTgUser(a, res) {
  if (!a.userId.startsWith("tg:")) {
    bad(res, 400, { error: "only_telegram", message: "Доступно только при входе через Telegram" });
    return false;
  }
  return true;
}

async function upsertAppUser(supabase, userId) {
  // Minimal: ensure row exists. display_name can be filled later from profile.
  const up = await supabase.from("app_users").upsert({ id: userId });
  if (up.error) throw up.error;
}

export default async function handler(req, res) {
  try {
    const a = requireUserId(req);
    if (!a.ok) return res.status(401).json({ error: "Unauthorized" });
    if (!requireTgUser(a, res)) return;

    const action = String(req.query?.action || "").trim();
    if (!action) return bad(res, 400, { error: "action_required" });

    const supabase = getSupabaseAdmin();
    await upsertAppUser(supabase, a.userId);

    // --- Groups ---
    if (action === "groups_list" && req.method === "GET") {
      const { data, error } = await supabase
        .from("app_group_members")
        .select("group_id,role,app_groups(id,name,type,color,created_by,created_at,updated_at)")
        .eq("user_id", a.userId);
      if (error) throw error;
      const groups = (data || []).map((row) => ({
        groupId: row.group_id,
        role: row.role,
        group: row.app_groups,
      }));
      return ok(res, { groups });
    }

    if (action === "group_create" && req.method === "POST") {
      const { name, type, color } = req.body || {};
      const nm = String(name || "").trim();
      if (!nm) return bad(res, 400, { error: "name_required" });
      const g = {
        id: uid("g"),
        name: nm,
        type: String(type || "другое"),
        color: String(color || "#7aa7ff"),
        created_by: a.userId,
      };
      const ins = await supabase.from("app_groups").insert(g);
      if (ins.error) throw ins.error;
      const mem = await supabase.from("app_group_members").insert({ group_id: g.id, user_id: a.userId, role: "leader" });
      if (mem.error) throw mem.error;
      return ok(res, { group: g });
    }

    // --- Invites ---
    if (action === "invite_create" && req.method === "POST") {
      const { groupId, role } = req.body || {};
      const gid = String(groupId || "").trim();
      if (!gid) return bad(res, 400, { error: "groupId_required" });
      const r = role === "leader" ? "leader" : "participant";

      const me = await supabase.from("app_group_members").select("role").eq("group_id", gid).eq("user_id", a.userId).maybeSingle();
      if (me.error) throw me.error;
      if (!me.data || me.data.role !== "leader") return bad(res, 403, { error: "forbidden" });

      const token = crypto.randomBytes(24).toString("hex");
      const ins = await supabase.from("app_group_invites").insert({ token, group_id: gid, role: r, created_by: a.userId });
      if (ins.error) throw ins.error;
      return ok(res, { token });
    }

    if (action === "invite_accept" && req.method === "POST") {
      const { token } = req.body || {};
      const t = String(token || "").trim();
      if (!t) return bad(res, 400, { error: "token_required" });

      const inv = await supabase.from("app_group_invites").select("*").eq("token", t).maybeSingle();
      if (inv.error) throw inv.error;
      if (!inv.data) return bad(res, 404, { error: "invite_not_found" });
      if (inv.data.used_at || inv.data.used_by) return bad(res, 409, { error: "invite_used" });

      const gid = String(inv.data.group_id);
      const r = inv.data.role === "leader" ? "leader" : "participant";

      const upMem = await supabase.from("app_group_members").upsert({ group_id: gid, user_id: a.userId, role: r });
      if (upMem.error) throw upMem.error;

      const mark = await supabase
        .from("app_group_invites")
        .update({ used_by: a.userId, used_at: new Date().toISOString() })
        .eq("token", t);
      if (mark.error) throw mark.error;

      return ok(res, { groupId: gid, role: r });
    }

    // --- Seminars ---
    if (action === "seminar_create" && req.method === "POST") {
      const { groupId, status, title, note, theme, blocks } = req.body || {};
      const gid = String(groupId || "").trim();
      if (!gid) return bad(res, 400, { error: "groupId_required" });

      const me = await supabase.from("app_group_members").select("role").eq("group_id", gid).eq("user_id", a.userId).maybeSingle();
      if (me.error) throw me.error;
      if (!me.data || me.data.role !== "leader") return bad(res, 403, { error: "forbidden" });

      const sem = {
        id: uid("sem"),
        group_id: gid,
        status: String(status || "предварительно"),
        title: title != null ? String(title) : null,
        note: note != null ? String(note) : null,
        theme: theme != null ? String(theme) : null,
        created_by: a.userId,
      };
      const ins = await supabase.from("app_seminars").insert(sem);
      if (ins.error) throw ins.error;

      const bl = Array.isArray(blocks) ? blocks : [];
      for (let i = 0; i < bl.length; i++) {
        const b = bl[i] || {};
        const day = String(b.day || "").trim();
        if (!day) continue;
        const row = {
          id: uid("blk"),
          seminar_id: sem.id,
          day,
          start_time: String(b.startTime || ""),
          end_time: String(b.endTime || ""),
          sort_order: Number.isFinite(b.sortOrder) ? b.sortOrder : i,
        };
        const bi = await supabase.from("app_seminar_blocks").insert(row);
        if (bi.error) throw bi.error;
      }

      return ok(res, { seminar: sem });
    }

    if (action === "upcoming" && req.method === "GET") {
      // MVP: ближайшие блоки по членству в группах
      const today = new Date();
      const yyyy = today.getUTCFullYear();
      const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(today.getUTCDate()).padStart(2, "0");
      const day = `${yyyy}-${mm}-${dd}`;

      const mem = await supabase.from("app_group_members").select("group_id").eq("user_id", a.userId);
      if (mem.error) throw mem.error;
      const groupIds = Array.from(new Set((mem.data || []).map((x) => x.group_id).filter(Boolean)));
      if (!groupIds.length) return ok(res, { blocks: [] });

      const { data, error } = await supabase
        .from("app_seminar_blocks")
        .select("id,day,start_time,end_time,sort_order,app_seminars!inner(id,group_id,status,title,note,theme,app_groups!inner(id,name,type,color))")
        .gte("day", day)
        .in("app_seminars.group_id", groupIds)
        .order("day", { ascending: true })
        .limit(40);

      if (error) throw error;
      return ok(res, { blocks: data || [] });
    }

    return bad(res, 404, { error: "unknown_action" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

