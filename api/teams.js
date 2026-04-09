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

  function progressKey(teamId) {
    return 'progress_' + String(teamId).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  async function getProgress(teamId) {
    const r = await fetch(`${url}/get/${progressKey(teamId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const d = await r.json();
    if (!d.result) return null;
    try {
      let val = d.result;
      while (typeof val === 'string') val = JSON.parse(val);
      return val;
    } catch { return null; }
  }

  async function setProgress(teamId, data) {
    await fetch(`${url}/set/${progressKey(teamId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(data))
    });
  }

  try {
    if (req.method === 'GET') {
      // GET /api/teams?action=getProgress&teamId=xxx
      if (req.query.action === 'getProgress' && req.query.teamId) {
        const progress = await getProgress(req.query.teamId);
        return res.json({ progress });
      }
      const teams = await getTeams();
      return res.json({ teams });
    }
    if (req.method === 'POST') {
      const { action, team, teamId, progress } = req.body;

      // ── 팀 진행 기록 저장 ──
      if (action === 'saveProgress') {
        if (!teamId) return res.status(400).json({ error: 'teamId required' });
        await setProgress(teamId, { ...progress, updatedAt: new Date().toISOString() });
        return res.json({ ok: true });
      }
      if (action === 'getProgress') {
        if (!teamId) return res.status(400).json({ error: 'teamId required' });
        const data = await getProgress(teamId);
        return res.json({ progress: data });
      }

      // ── 기존 팀 관리 액션 ──
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
