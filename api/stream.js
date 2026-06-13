// POST /api/stream — create Overshoot stream → { id, url, token }
// Phase 0: stub. Phase 2+: real Overshoot call.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const key = process.env.OVERSHOOT_API_KEY;
  if (!key) {
    // Return a mock response so the UI can test the flow
    return res.status(200).json({
      id: "mock_stream_" + Date.now(),
      state: "active",
      publish: { type: "mock", url: null, token: null },
      ttl_seconds: 300,
      mock: true,
    });
  }

  const r = await fetch("https://api.overshoot.ai/v1/streams", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`
    }
  });

  if (!r.ok) {
    const txt = await r.text();
    return res.status(r.status).json({ error: txt });
  }

  const data = await r.json();
  res.status(200).json(data);
}
