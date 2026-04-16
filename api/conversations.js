export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  function convKey(teamId) {
    return 'conv_' + String(teamId).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  async function getConv(teamId) {
    const r = await fetch(`${url}/get/${convKey(teamId)}`, {
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

  async function setConv(teamId, data) {
    await fetch(`${url}/set/${convKey(teamId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(data))
    });
  }

  try {
    if (req.method === 'GET') {
      const { teamId } = req.query;
      if (!teamId) return res.status(400).json({ error: 'teamId required' });
      const conv = await getConv(teamId);
      return res.json({ conversation: conv });
    }

    if (req.method === 'POST') {
      const { teamId, messages, append } = req.body;
      if (!teamId || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'teamId and messages array required' });
      }
      const now = new Date().toISOString();
      if (append) {
        const existing = await getConv(teamId) || {
          teamId,
          title: '프로젝트 대화',
          messages: [],
          updatedAt: now
        };
        const stamped = messages.map(m => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt || now
        }));
        existing.messages = [...existing.messages, ...stamped];
        existing.updatedAt = now;
        await setConv(teamId, existing);
      } else {
        const conv = {
          teamId,
          title: '프로젝트 대화',
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
            createdAt: m.createdAt || now
          })),
          updatedAt: now
        };
        await setConv(teamId, conv);
      }
      return res.json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const { teamId, title, summary } = req.body;
      if (!teamId) return res.status(400).json({ error: 'teamId required' });
      const existing = await getConv(teamId);
      if (!existing) return res.status(404).json({ error: 'conversation not found' });
      if (title !== undefined) existing.title = title;
      if (summary !== undefined) existing.summary = summary;
      existing.updatedAt = new Date().toISOString();
      await setConv(teamId, existing);
      return res.json({ ok: true });
    }

    return res.status(405).end();
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
