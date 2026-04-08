export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { model, messages, system, maxTokens } = req.body;
  const MAX = maxTokens || 2048;
  const systemPrompt = system || '당신은 한국 학생들의 공공교육데이터 AI 활용 대회를 돕는 교육용 AI 도우미입니다.';

  try {
    if (model === 'claude') {
      const key = process.env.CLAUDE_KEY;
      if (!key) return res.status(500).json({ error: 'Claude API 키가 없습니다.' });
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: MAX,
          system: systemPrompt,
          messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
        })
      });
      const data = await r.json();
      if (data.error) return res.status(400).json({ error: data.error.message });
      return res.json({ reply: data.content[0].text });
    }
    if (model === 'gpt') {
      const key = process.env.OPENAI_KEY;
      if (!key) return res.status(500).json({ error: 'OpenAI API 키가 없습니다.' });
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: 'gpt-4o', max_tokens: MAX,
          messages: [{ role: 'system', content: systemPrompt }, ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))]
        })
      });
      const data = await r.json();
      if (data.error) return res.status(400).json({ error: data.error.message });
      return res.json({ reply: data.choices[0].message.content });
    }
    if (model === 'gemini') {
      const key = process.env.GEMINI_KEY;
      if (!key) return res.status(500).json({ error: 'Gemini API 키가 없습니다.' });
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { maxOutputTokens: 2048 }
        })
      });
      const data = await r.json();
      if (data.error) return res.status(400).json({ error: data.error.message });
      return res.json({ reply: data.candidates[0].content.parts[0].text });
    }
    return res.status(400).json({ error: '지원하지 않는 모델입니다.' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}