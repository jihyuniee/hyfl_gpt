export const config = { runtime: 'edge' };

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const { model, messages, system, maxTokens } = await req.json();
  const MAX = maxTokens || 1200;
  const systemPrompt = system || '당신은 한국 학생들을 돕는 교육용 AI 도우미입니다.';
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (text) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ t: text })}\n\n`));
      };

      try {
        if (model === 'gpt') {
          const key = process.env.OPENAI_KEY;
          if (!key) { send('[GPT API 키가 없습니다]'); controller.close(); return; }
          const r = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({
              model: 'gpt-4o', max_tokens: MAX, stream: true,
              messages: [
                { role: 'system', content: systemPrompt },
                ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
              ]
            })
          });
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                try {
                  const d = JSON.parse(line.slice(6));
                  const t = d.choices?.[0]?.delta?.content;
                  if (t) send(t);
                } catch {}
              }
            }
          }
        } else if (model === 'claude') {
          const key = process.env.CLAUDE_KEY;
          if (!key) { send('[Claude API 키가 없습니다]'); controller.close(); return; }
          const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514', max_tokens: MAX, stream: true,
              system: systemPrompt,
              messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
            })
          });
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const d = JSON.parse(line.slice(6));
                  if (d.type === 'content_block_delta' && d.delta?.text) send(d.delta.text);
                } catch {}
              }
            }
          }
        } else if (model === 'gemini') {
          const key = process.env.GEMINI_KEY;
          if (!key) { send('[Gemini API 키가 없습니다]'); controller.close(); return; }
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?key=${key}&alt=sse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt }] },
              contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
              generationConfig: { maxOutputTokens: MAX }
            })
          });
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const d = JSON.parse(line.slice(6));
                  const t = d.candidates?.[0]?.content?.parts?.[0]?.text;
                  if (t) send(t);
                } catch {}
              }
            }
          }
        } else if (model === 'grok' || model === 'perplexity') {
          const isGrok = model === 'grok';
          const key = isGrok ? process.env.XAI_KEY : process.env.PERPLEXITY_KEY;
          const baseUrl = isGrok
            ? 'https://api.x.ai/v1/chat/completions'
            : 'https://api.perplexity.ai/chat/completions';
          const modelId = isGrok ? 'grok-3-mini' : 'sonar-pro';
          const label = isGrok ? 'Grok(xAI)' : 'Perplexity';
          if (!key) { send(`[${label} API 키가 없습니다 — Vercel 환경변수에 ${isGrok?'XAI_KEY':'PERPLEXITY_KEY'} 를 추가해주세요]`); controller.close(); return; }
          const r = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({
              model: modelId, max_tokens: MAX, stream: true,
              messages: [
                { role: 'system', content: systemPrompt },
                ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
              ]
            })
          });
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                try {
                  const d = JSON.parse(line.slice(6));
                  const t = d.choices?.[0]?.delta?.content;
                  if (t) send(t);
                } catch {}
              }
            }
          }
        } else {
          send('[지원하지 않는 모델입니다]');
        }
      } catch (e) {
        send('[오류: ' + e.message + ']');
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    }
  });

  return new Response(stream, {
    headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
  });
}
