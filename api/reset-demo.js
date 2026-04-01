import { getSupabaseAdmin } from "./_lib/supabase.js";
import { buildDemoState } from "./_lib/demoState.js";
import { requireUserId } from "./_lib/auth.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const a = requireUserId(req);
    if (!a.ok) return res.status(401).json({ error: "Unauthorized" });
    const rowId = a.userId;

    const supabase = getSupabaseAdmin();
    const demo = buildDemoState();
    const up = await supabase.from("app_state").upsert({ id: rowId, state: demo });
    if (up.error) throw up.error;
    return res.status(200).json(demo);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

