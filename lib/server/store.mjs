// Dependency-free Upstash/Vercel KV adapter. No credentials leave the server.
export const PREFIX = 'hyfl:studio:v2:';

export const CAS_SCRIPT = `-- HYFL_CAS_V1
local current = redis.call('GET', KEYS[1])
if (not current and ARGV[1] ~= '__HYFL_MISSING__') or (current and current ~= ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1`;

export const THROTTLE_SCRIPT = `-- HYFL_THROTTLE_V1
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return count`;

export const RESERVE_SCRIPT = `-- HYFL_RESERVE_V1
local function load(key)
  local raw = redis.call('GET', key)
  if raw then return cjson.decode(raw) end
  return {requests=0,spentMicros=0,reservedMicros=0,inputTokens=0,outputTokens=0}
end
local t = load(KEYS[1]); local d = load(KEYS[2]); local m = load(KEYS[3])
local limits = cjson.decode(ARGV[1]); local amount = tonumber(ARGV[2])
if redis.call('EXISTS', KEYS[4]) == 1 then return cjson.encode({ok=false,reason='busy'}) end
if t.requests >= limits.teamRequests then return cjson.encode({ok=false,reason='team_requests'}) end
if d.requests >= limits.schoolRequests then return cjson.encode({ok=false,reason='school_requests'}) end
if t.spentMicros + t.reservedMicros + amount > limits.teamMicros then return cjson.encode({ok=false,reason='team_budget'}) end
if d.spentMicros + d.reservedMicros + amount > limits.dayMicros then return cjson.encode({ok=false,reason='school_budget'}) end
if m.spentMicros + m.reservedMicros + amount > limits.monthMicros then return cjson.encode({ok=false,reason='month_budget'}) end
for _, v in ipairs({t,d,m}) do v.requests=v.requests+1; v.reservedMicros=v.reservedMicros+amount end
redis.call('SET', KEYS[1], cjson.encode(t), 'EX', 172800)
redis.call('SET', KEYS[2], cjson.encode(d), 'EX', 172800)
redis.call('SET', KEYS[3], cjson.encode(m), 'EX', 3888000)
redis.call('SET', KEYS[4], ARGV[3], 'EX', 180)
redis.call('SET', KEYS[5], cjson.encode({id=ARGV[3],amount=amount,settled=false}), 'EX', 172800)
return cjson.encode({ok=true})`;

export const SETTLE_SCRIPT = `-- HYFL_SETTLE_V1
local raw = redis.call('GET', KEYS[5])
if not raw then return 0 end
local r = cjson.decode(raw)
if r.id ~= ARGV[1] or r.settled then return 0 end
for i=1,3 do
  local current = redis.call('GET', KEYS[i])
  if current then
    local v = cjson.decode(current)
    v.reservedMicros=math.max(0,v.reservedMicros-r.amount)
    v.spentMicros=v.spentMicros+tonumber(ARGV[2])
    v.inputTokens=v.inputTokens+tonumber(ARGV[3])
    v.outputTokens=v.outputTokens+tonumber(ARGV[4])
    redis.call('SET', KEYS[i], cjson.encode(v), 'KEEPTTL')
  end
end
if redis.call('GET', KEYS[4]) == ARGV[1] then redis.call('DEL', KEYS[4]) end
r.settled=true
redis.call('SET', KEYS[5], cjson.encode(r), 'KEEPTTL')
return 1`;

export function decodeStored(raw, fallback = null) {
  if (raw === null || raw === undefined) return fallback;
  let value = raw;
  try {
    for (let i = 0; typeof value === 'string' && i < 5; i++) value = JSON.parse(value);
    return value;
  } catch { return fallback; }
}

export class RedisStore {
  constructor({ url, token, fetchImpl = globalThis.fetch }) {
    this.url = (url || '').replace(/\/$/, '');
    this.token = token;
    this.fetch = fetchImpl;
  }
  get configured() { return Boolean(this.url && this.token); }
  async command(...args) {
    if (!this.configured) {
      const error = new Error('저장소가 아직 연결되지 않았습니다. 교사에게 알려주세요.');
      error.status = 503; error.code = 'STORAGE_NOT_CONFIGURED'; throw error;
    }
    let response;
    try {
      response = await this.fetch(this.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args), signal: AbortSignal.timeout(10000),
      });
    } catch {
      const error = new Error('저장소 연결이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
      error.status = 503; error.code = 'STORAGE_UNAVAILABLE'; throw error;
    }
    let data;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok || !data || typeof data!=='object' || Array.isArray(data) || data.error || !Object.hasOwn(data,'result') || data.result===undefined) {
      const error = new Error('저장소 요청을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.');
      error.status = 503; error.code = 'STORAGE_UNAVAILABLE'; throw error;
    }
    return data.result;
  }
  invalidResult() {
    const error=new Error('저장소 응답을 확인할 수 없습니다. 잠시 후 다시 시도해주세요.');
    error.status=503;error.code='STORAGE_UNAVAILABLE';return error;
  }
  async get(key) {
    const result=await this.command('GET',key);
    if(result!==null&&typeof result!=='string') throw this.invalidResult();
    return result;
  }
  async mget(keys) {
    if(!keys.length)return [];
    const result=await this.command('MGET',...keys);
    if(!Array.isArray(result)||result.length!==keys.length||result.some(v=>v!==null&&typeof v!=='string')) throw this.invalidResult();
    return result;
  }
  async set(key, value) {
    const result=await this.command('SET',key,JSON.stringify(value));
    if(result!=='OK') throw this.invalidResult();
    return result;
  }
  async cas(key, expectedRaw, value) {
    const result = await this.command('EVAL', CAS_SCRIPT, 1, key,
      expectedRaw === null || expectedRaw === undefined ? '__HYFL_MISSING__' : expectedRaw,
      JSON.stringify(value));
    if(result!==0&&result!==1)throw this.invalidResult();
    return result === 1;
  }
  async throttle(key, seconds) {
    const result=await this.command('EVAL', THROTTLE_SCRIPT, 1, key, seconds);
    if(!Number.isSafeInteger(result)||result<1)throw this.invalidResult();
    return result;
  }
  async reserve(keys, limits, amount, id) {
    const result=decodeStored(await this.command('EVAL', RESERVE_SCRIPT, 5, ...keys, JSON.stringify(limits), amount, id),null);
    if(!result||typeof result!=='object'||typeof result.ok!=='boolean'||(!result.ok&&typeof result.reason!=='string'))throw this.invalidResult();
    return result;
  }
  async settle(keys, id, micros, inputTokens, outputTokens) {
    const result=await this.command('EVAL', SETTLE_SCRIPT, 5, ...keys, id, micros, inputTokens, outputTokens);
    if(result!==0&&result!==1)throw this.invalidResult();
    return result;
  }
}
