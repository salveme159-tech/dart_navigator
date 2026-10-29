import { amountOf, findRevenueRow, findRowLike, metricConfig, type Row } from "./engine.ts";

export type StatementScope = { year:number; report:string; basis:"CFS"|"OFS"; receipt?:string; corpCode?:string };
export type MajorAccountResponse = { status:string; list?:Row[] };
export const coreStatementMissing = (rows:Row[]) => {
  const candidates = [findRevenueRow(rows),findRowLike(rows,["CIS","IS"],metricConfig.operatingProfit.names),findRowLike(rows,["CIS","IS"],metricConfig.netIncome.names), ...["자산총계","부채총계","자본총계","유동자산","유동부채"].map(name=>findRowLike(rows,["BS"],[name]))];
  return candidates.some(row => !row || (amountOf(row)===null && amountOf(row,0,true)===null));
};

/** Recover only missing primary accounts, never another period, basis or amendment. */
export async function recoverStatementRows(primary:Row[], scope:StatementScope, loadMajor:()=>Promise<MajorAccountResponse>):Promise<{rows:Row[]; status:"complete"|"recovered"|"unavailable"|"failed"; note:string}> {
  if (!coreStatementMissing(primary)) return {rows:primary,status:"complete",note:""};
  const mark = (rows:Row[],status:"recovered"|"unavailable"|"failed",note:string) => ({rows:rows.map((row,i)=>i===0 ? {...row,recovery_note:note}:row),status,note});
  let response:MajorAccountResponse;
  try { response=await loadMajor(); } catch { return mark(primary,"failed","DART 주요계정 추가 조회에 실패했습니다. 잠시 후 새로고침해 주세요."); }
  if (response.status!=="000") return mark(primary,"unavailable",`DART 주요계정 추가 조회 상태 ${/^\d{3}$/.test(response.status)?response.status:"미확인"}: 같은 보고서의 보완값을 확인하지 못했습니다.`);
  const matches=(response.list ?? []).filter(row => row.fs_div===scope.basis && String(row.bsns_year)===String(scope.year) && row.reprt_code===scope.report && /^\d{14}$/.test(row.rcept_no ?? "") && (!scope.receipt || row.rcept_no===scope.receipt) && (!row.corp_code || !scope.corpCode || row.corp_code===scope.corpCode) && ["IS","CIS","BS"].includes(row.sj_div ?? "") && (amountOf(row)!==null || amountOf(row,0,true)!==null));
  // Missing primary receipt: avoid mixing multiple amendments even within one response.
  const receipt=scope.receipt || matches.map(row=>row.rcept_no!).sort().at(-1);
  const sameReceipt=matches.filter(row=>row.rcept_no===receipt);
  const additions:Row[]=[];
  const groups=[
    {find:(rows:Row[])=>findRevenueRow(rows)},
    ...[metricConfig.operatingProfit.names,metricConfig.netIncome.names].map(names=>({find:(rows:Row[])=>findRowLike(rows,["CIS","IS"],names)})),
    ...["자산총계","부채총계","자본총계","유동자산","유동부채"].map(name=>({find:(rows:Row[])=>findRowLike(rows,["BS"],[name])})),
  ];
  for (const group of groups) {
    const existing=group.find(primary);
    if (existing && (amountOf(existing)!==null || amountOf(existing,0,true)!==null)) continue;
    const row=group.find(sameReceipt);
    if (row && !additions.some(item => item.account_nm === row.account_nm && item.sj_div === row.sj_div)) additions.push({...row, source_type:"MAJOR"});
  }
  if (!additions.length) return mark(primary,"unavailable","DART 전체 재무제표와 주요계정을 확인했지만 같은 보고서·회계기준의 필요한 계정/금액을 찾지 못했습니다.");
  const combined=[...primary,...additions];
  const incomeMissing = [findRevenueRow(combined),findRowLike(combined,["CIS","IS"],metricConfig.operatingProfit.names),findRowLike(combined,["CIS","IS"],metricConfig.netIncome.names)].some(row=>!row || (amountOf(row)===null && amountOf(row,0,true)===null));
  return incomeMissing
    ? mark(combined,"unavailable","DART 주요계정으로 일부 계정을 보완했지만 같은 보고서의 손익계정/금액을 모두 확인하지 못했습니다.")
    : mark(combined,"recovered",coreStatementMissing(combined) ? "동일 보고서 주요계정으로 손익을 보완했지만 일부 재무상태표 지표가 미확인입니다. 지표별 조회 사유를 확인하세요." : "DART 전체 재무제표의 누락 계정을 동일 연도·보고서·접수번호·회계기준의 주요계정 API로 보완했습니다.");
}
