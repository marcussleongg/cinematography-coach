// POST /api/query — proxy to Overshoot /v1/chat/completions (keeps key server-side)
// Phase 0: stub returns 501. Phase 3+: real proxy.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const key = process.env.OVERSHOOT_API_KEY;
  if (!key) {
    return res.status(501).json({ error: "OVERSHOOT_API_KEY not set — use mock mode" });
  }

  const body = req.body;
  const r = await fetch("https://api.overshoot.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) return res.status(r.status).json({ error: await r.text() });
  const data = await r.json();
  res.status(200).json(data);
}
