export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  async function getTeams() {
    const r = await fetch(`${url}/get/teams`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const d = await r.json();
    if (!d.result) return [];
    try {
      let val = d.result;
      while (typeof val === 'string') val = JSON.parse(val);
      return Array.isArray(val) ? val : [];
    } catch { return []; }
  }

  async function setTeams(teams) {
    await fetch(`${url}/set/teams`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(teams))
    });
  }

  try {
    if (req.method === 'GET') {
      const teams = await getTeams();
      return res.json({ teams });
    }
    if (req.method === 'POST') {
      const { action, team } = req.body;
      let teams = await getTeams();
      if (action === 'add') {
        teams.push(team);
      } else if (action === 'approve') {
        teams = teams.map(t => t.grade===team.grade && t.cls===team.cls && t.name===team.name ? {...t, status:'active'} : t);
      } else if (action === 'revoke') {
        teams = teams.map(t => t.grade===team.grade && t.cls===team.cls && t.name===team.name ? {...t, status:'inactive'} : t);
      } else if (action === 'remove') {
        teams = teams.filter(t => !(t.grade===team.grade && t.cls===team.cls && t.name===team.name));
      }
      await setTeams(teams);
      const saved = await getTeams();
      return res.json({ teams: saved });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
