import { getSupabaseAdmin } from "./_lib/supabase.js";
import { buildDemoState, validateState } from "./_lib/demoState.js";

const ROW_ID = "default";

async function ensureRow(supabase) {
  const { data, error } = await supabase
    .from("app_state")
    .select("id,state,updated_at")
    .eq("id", ROW_ID)
    .maybeSingle();

  if (error) throw error;
  if (data?.state && Object.keys(data.state).length > 0) return data.state;

  // Пусто — заливаем демо.
  const demo = buildDemoState();
  const up = await supabase.from("app_state").upsert({ id: ROW_ID, state: demo });
  if (up.error) throw up.error;
  return demo;
}

export default async function handler(req, res) {
  try {
    const supabase = getSupabaseAdmin();

    if (req.method === "GET") {
      const state = await ensureRow(supabase);
      return res.status(200).json(state);
    }

    if (req.method === "PUT") {
      const incoming = req.body;
      const err = validateState(incoming);
      if (err) return res.status(400).json({ error: err });

      const up = await supabase.from("app_state").upsert({ id: ROW_ID, state: incoming });
      if (up.error) throw up.error;
      return res.status(200).json(incoming);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}

