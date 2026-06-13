// GET  /api/stream-status?id={id}  → stream status (frame count, fps, state)
// DELETE /api/stream-status?id={id} → delete stream
export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "id required" });

  const key = process.env.OVERSHOOT_API_KEY;
  if (!key) return res.status(501).json({ error: "OVERSHOOT_API_KEY not set" });

  const r = await fetch(`https://api.overshoot.ai/v1/streams/${id}`, {
    method: req.method,
    headers: { Authorization: `Bearer ${key}` },
  });

  if (!r.ok) return res.status(r.status).json({ error: await r.text() });
  if (req.method === "DELETE") return res.status(204).end();
  res.status(200).json(await r.json());
}
