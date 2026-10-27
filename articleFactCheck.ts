import { TRPCError } from '@trpc/server';
import type { FactCheckInput, FactCheckResult } from '../../shared/articleFactCheck';
import { extractArticleClaims, applyActual, parseContractAmount } from './articleClaims';
import { financialFactSource, articleCompanyNames, recentFilingsDart, articleDisclosureEntries } from './client';
import type { FinancialMetric } from './engine';

export async function factCheckArticle(input: FactCheckInput, requestKey?: string): Promise<FactCheckResult> {
  const names = await articleCompanyNames(input.article, input.company, requestKey);
  const claims = extractArticleClaims({...input,company:names[0]},names);
  if (claims.length > 100) throw new TRPCError({code:'BAD_REQUEST', message:'수치가 100개를 넘습니다. 기사를 나누어 확인해 주세요.'});
  const warnings: string[] = [];
  const sources = new Map<string,ReturnType<typeof financialFactSource>>();
  // 같은 회사·기간·회계 기준의 재무제표는 한 번만 조회합니다. 동시 호출은 최대 3개입니다.
  const jobs = claims.filter(c=>!c.message && c.metric && c.metric !== 'contract');
  for (let i=0; i<jobs.length; i+=3) await Promise.all(jobs.slice(i,i+3).map(async c=>{
    const fetchSource = (year:number) => {
      const cacheKey = `${c.company}:${year}:${c.period}:${c.mode}:${c.basis}:${c.metric}`;
      if (!sources.has(cacheKey)) sources.set(cacheKey, financialFactSource({company:c.company,year,kind:c.period,mode:c.mode,basis:c.basis,metric:c.metric as FinancialMetric},requestKey));
      return sources.get(cacheKey)!;
    };
    try {
      const source = await fetchSource(c.year);
      if (!source || source.value === null || !Number.isFinite(source.value)) { c.message='동일 기간·회계 기준의 DART 원천 계정을 확인하지 못했습니다.'; return; }
      let actual = source.value;
      c.sourceUrl=source.url; c.sourceLabel=source.citation;
      if (c.growth) {
        const prior=await fetchSource(c.year-1);
        if (!prior || prior.value === null || prior.value <= 0) { c.message='전년 동기 공시값이 없거나 0 이하이므로 증감률을 자동 판정하지 않았습니다.'; return; }
        if (!/전년|작년|지난해|동기/.test(c.sentence)) { c.message='증감률의 비교 기준(전년 동기 등)을 확인해 주세요.'; return; }
        actual=(actual/prior.value-1)*100*(c.growth==='decrease'?-1:1);
        c.sourceLabel+=` / 전년 동기 ${prior.citation}`;
      } else if (source.unit !== c.unit) { c.message=`기사 단위(${c.unit})와 공시 단위(${source.unit})가 달라 비교를 보류했습니다.`; return; }
      applyActual(c,actual);
    } catch { c.message='DART 조회에 실패했습니다. 인증키·호출 한도·네트워크를 확인해 주세요.'; }
  }));
  const contractClaims=claims.filter(c=>c.metric==='contract' && !c.message);
  let contractCandidates: FactCheckResult['contractCandidates']=[];
  if (contractClaims.length) {
    try {
      const end=new Date(`${input.articleDate}T00:00:00+09:00`);
      const from=new Date(end.getTime()-90*86400_000).toISOString().slice(0,10).replace(/-/g,'');
      const list=await recentFilingsDart([...new Set(contractClaims.map(c=>c.company))],from,requestKey,input.articleDate.replace(/-/g,''));
      warnings.push(...list.warnings);
      contractCandidates=list.rows.filter(r=>/단일판매|공급계약/.test(r.reportName)).slice(0,30);
      // 근거 공시는 금액의 유사성으로 선택하지 않습니다. 사용자가 고르거나 지역·전압이 유일하게 일치해야 합니다.
      const documents=new Map<string,Promise<{text:string;amount:ReturnType<typeof parseContractAmount>}>>();
      const document=(receipt:string)=>{
        if (!documents.has(receipt)) documents.set(receipt,articleDisclosureEntries(receipt,requestKey).then(entries=>({text:entries.map(e=>e.text.replace(/<[^>]+>/g,' ')).join(' '),amount:entries.map(e=>parseContractAmount(e.text)).find(Boolean)??null})));
        return documents.get(receipt)!;
      };
      for (const c of contractClaims) {
        const candidates=contractCandidates.filter(r=>r.company===c.company);
        let selected=candidates.find(r=>r.rceptNo===input.contractReceipt);
        if (!selected && !input.contractReceipt) {
          const anchors=[...new Set(c.sentence.match(/독일|덴마크|영국|싱가포르|미국|캐나다|호주|네덜란드|프랑스|\d{2,3}\s*kV/gi)??[])];
          const matches=[];
          if (anchors.length) for (const candidate of candidates.slice(0,5)) {
            const doc=await document(candidate.rceptNo);
            if (anchors.every(a=>doc.text.replace(/\s/g,'').toLowerCase().includes(a.replace(/\s/g,'').toLowerCase()))) matches.push(candidate);
          }
          // 후보가 잘렸다면 유일성 판단을 하지 않습니다.
          if (matches.length===1 && candidates.length<=5 && contractCandidates.length<30) selected=matches[0];
        }
        if (!selected) { c.message='동일 사업의 계약 공시를 특정하지 못했습니다. 아래 후보에서 해당 공시를 선택해 다시 확인해 주세요.'; continue; }
        const doc=await document(selected.rceptNo);
        const scopeAnchors=[...new Set(c.sentence.match(/독일|덴마크|영국|싱가포르|미국|캐나다|호주|네덜란드|프랑스|\d{2,3}\s*kV/gi)??[])];
        if(scopeAnchors.some(a=>!doc.text.replace(/\s/g,'').toLowerCase().includes(a.replace(/\s/g,'').toLowerCase()))) {c.message='기사의 사업 지역·전압과 선택한 계약 원문이 일치하지 않습니다. 해당 사업 공시를 선택해 주세요.';continue;}
        c.sourceUrl=selected.url; c.sourceLabel=`${selected.company} · ${selected.receiptDate} · ${selected.reportName}`;
        if (!doc.amount) { c.message='선택한 계약 원문에서 단위와 확정 금액이 명확한 행을 추출하지 못했습니다. 원문을 확인해 주세요.'; continue; }
        if (/전체|총사업|누적|잔고/.test(c.sentence)) { c.message='기사 금액과 개별 공시 계약금액의 범위가 같은지 확인이 필요합니다.'; continue; }
        c.basisLabel=`${selected.company} · 개별 계약 공시 · ${selected.receiptDate}`;
        applyActual(c,doc.amount.value);
        c.sourceLabel+=` · ${doc.amount.excerpt}`;
      }
    } catch { warnings.push('계약 공시 조회에 실패했습니다. 인증키·호출 한도·네트워크를 확인해 주세요.'); contractClaims.forEach(c=>{if(!c.message)c.message='계약 공시 원문을 확인하지 못했습니다.';}); }
  }
  return {article:input.article,claims,checkedAt:new Date().toISOString(),summary:{matched:claims.filter(c=>c.status==='MATCH').length,mismatched:claims.filter(c=>c.status==='MISMATCH').length,unverified:claims.filter(c=>c.status==='UNVERIFIED').length},contractCandidates,warnings};
}
