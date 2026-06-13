// POST /api/renew — renew Overshoot stream lease
// ⚠ Exact upstream path unverified — confirm before Phase 4
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "id required" });

  const key = process.env.OVERSHOOT_API_KEY;
  if (!key || id.startsWith("mock_")) {
    return res.status(200).json({ renewed: true, mock: true });
  }

  // TODO: confirm exact renew endpoint from Overshoot docs
  const r = await fetch(`https://api.overshoot.ai/v1/streams/${id}/renew`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
  });

  if (!r.ok) return res.status(r.status).json({ error: await r.text() });
  res.status(200).json(await r.json());
}
