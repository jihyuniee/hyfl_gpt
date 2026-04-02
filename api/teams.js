export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;

  async function kvGet(key) {
    const r = await fetch(`${KV_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    const d = await r.json();
    if (!d.result) return [];
    try {
      const parsed = JSON.parse(d.result);
      return Array.isArray(parsed) ? parsed : [];
    } catch(e) {
      return [];
    }
  }

  async function kvSet(key, value) {
    await fetch(`${KV_URL}/set/${key}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: JSON.stringify(value) })
    });
  }

  try {
    if (req.method === 'GET') {
      const teams = await kvGet('teams');
      return res.json({ teams });
    }
    if (req.method === 'POST') {
      const { action, team } = req.body;
      let teams = await kvGet('teams');
      if (action === 'add') {
        teams.push(team);
      } else if (action === 'approve') {
        teams = teams.map(t => t.grade===team.grade && t.cls===team.cls && t.name===team.name ? {...t, status:'active'} : t);
      } else if (action === 'revoke') {
        teams = teams.map(t => t.grade===team.grade && t.cls===team.cls && t.name===team.name ? {...t, status:'inactive'} : t);
      } else if (action === 'remove') {
        teams = teams.filter(t => !(t.grade===team.grade && t.cls===team.cls && t.name===team.name));
      }
      await kvSet('teams', teams);
      return res.json({ teams });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
