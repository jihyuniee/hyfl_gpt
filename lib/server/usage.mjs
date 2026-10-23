import { randomUUID } from 'node:crypto';
import { AppError } from './common.mjs';
import { getTeams, teamId } from './accounts.mjs';
import { PREFIX, decodeStored } from './store.mjs';

export function dateKeys(now) { const date=new Date(now+9*3600000).toISOString().slice(0,10); return {date,month:date.slice(0,7)}; }
export function usageKeys(ctx,user,id) {
  const {date,month}=dateKeys(ctx.now());
  return [PREFIX+`usage:team:${date}:${user.id}`,PREFIX+`usage:school:${date}`,PREFIX+`usage:month:${month}`,PREFIX+`inflight:${user.id}`,PREFIX+`reservation:${id}`];
}
export function blankUsage() { return {requests:0,spentMicros:0,reservedMicros:0,inputTokens:0,outputTokens:0}; }
export async function teamLimit(ctx,user,settings) {
  if(user.role==='teacher') return settings.dailyRequests;
  const {teams}=await getTeams(ctx);
  const team=teams.find(t=>teamId(t)===user.id);
  return Number.isInteger(team?.dailyRequests)&&team.dailyRequests>=1&&team.dailyRequests<=100?team.dailyRequests:settings.dailyRequests;
}
const usd=n=>Math.round(n)/1000000;
export function summarizeUsage(raws,settings,dailyRequests,date) {
  const [t,d,m]=raws.map(raw=>({...blankUsage(),...(decodeStored(raw,{})||{})}));
  return {date,requests:t.requests,remaining:Math.max(0,dailyRequests-t.requests),dailyRequests,inputTokens:t.inputTokens,outputTokens:t.outputTokens,
    estimatedCostUsd:usd(t.spentMicros),reservedCostUsd:usd(t.reservedMicros),remainingBudgetUsd:Math.max(0,settings.teamDailyUsd-usd(t.spentMicros+t.reservedMicros)),costIsEstimate:true,
    school:{requests:d.requests,remaining:Math.max(0,settings.globalDailyRequests-d.requests),dailyRequests:settings.globalDailyRequests,estimatedCostUsd:usd(d.spentMicros),reservedCostUsd:usd(d.reservedMicros),remainingBudgetUsd:Math.max(0,settings.schoolDailyUsd-usd(d.spentMicros+d.reservedMicros)),monthlyEstimatedCostUsd:usd(m.spentMicros),monthlyReservedCostUsd:usd(m.reservedMicros),monthlyRemainingBudgetUsd:Math.max(0,settings.schoolMonthlyUsd-usd(m.spentMicros+m.reservedMicros))}};
}
export async function getUsage(ctx,user,settings) {
  const dailyRequests=await teamLimit(ctx,user,settings);
  const raws=await ctx.store.mget(usageKeys(ctx,user,'unused').slice(0,3));
  return summarizeUsage(raws,settings,dailyRequests,dateKeys(ctx.now()).date);
}
export async function reserveUsage(ctx,user,settings,estimatedInputTokens,provider) {
  if(!settings.aiEnabled) throw new AppError(403,'AI_PAUSED','선생님이 AI 사용을 잠시 멈췄습니다. 저장과 미리보기는 계속 사용할 수 있습니다.');
  const dailyRequests=await teamLimit(ctx,user,settings);
  const id=randomUUID(); const keys=usageKeys(ctx,user,id);
  // Rates are USD per million tokens; the arithmetic below yields micro-dollars.
  const amount=Math.ceil(estimatedInputTokens*provider.inputRate+settings.maxOutputTokens*provider.outputRate);
  const limits={teamRequests:dailyRequests,schoolRequests:settings.globalDailyRequests,teamMicros:Math.floor(settings.teamDailyUsd*1000000),dayMicros:Math.floor(settings.schoolDailyUsd*1000000),monthMicros:Math.floor(settings.schoolMonthlyUsd*1000000)};
  const result=await ctx.store.reserve(keys,limits,amount,id);
  if(!result.ok) {
    const messages={busy:'이 팀의 AI 요청이 진행 중입니다. 응답을 받은 뒤 다시 요청해주세요.',team_requests:'오늘 팀의 AI 요청 횟수를 모두 사용했습니다.',school_requests:'오늘 수업 전체의 AI 요청 횟수를 모두 사용했습니다.',team_budget:'이 요청을 위한 팀의 예상 비용 여유가 부족합니다. 교사에게 알려주세요.',school_budget:'오늘 수업 전체의 예상 비용 한도에 도달했습니다.',month_budget:'이번 달 수업의 예상 비용 한도에 도달했습니다.'};
    throw new AppError(429,result.reason==='busy'?'AI_BUSY':'QUOTA_EXCEEDED',messages[result.reason]||'사용량을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',{usage:await getUsage(ctx,user,settings)});
  }
  return {id,keys,amount};
}
export async function settleUsage(ctx,reservation,provider,usage=null) {
  // On a timeout/unknown provider outcome, keep the full conservative cost.
  // This prevents retries from spending unaccounted money.
  const inputTokens=usage?Math.max(0,Math.ceil(usage.inputTokens||0)):0;
  const outputTokens=usage?Math.max(0,Math.ceil(usage.outputTokens||0)):0;
  const micros=usage?Math.ceil(inputTokens*provider.inputRate+outputTokens*provider.outputRate):reservation.amount;
  await ctx.store.settle(reservation.keys,reservation.id,micros,inputTokens,outputTokens);
  return {inputTokens,outputTokens,estimatedCostUsd:usd(micros),costIsEstimate:true,conservativeEstimate:usage===null};
}
