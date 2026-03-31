import { getSupabaseAdmin } from "./_lib/supabase.js";
import { buildDemoState } from "./_lib/demoState.js";

const ROW_ID = "default";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const supabase = getSupabaseAdmin();
    const demo = buildDemoState();
    const up = await supabase.from("app_state").upsert({ id: ROW_ID, state: demo });
    if (up.error) throw up.error;
    return res.status(200).json(demo);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

