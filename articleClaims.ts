import type { FactCheckInput, FactClaim } from '../../shared/articleFactCheck';

const metrics: Array<[RegExp, string, string]> = [
  [/순차입금/g, 'netDebt', '순차입금'], [/총차입금|차입금(?!의존도)/g, 'borrowings', '차입금'],
  [/차입금\s*의존도/g, 'borrowingsRatio', '차입금의존도'], [/영업이익률|영업마진/g, 'operatingMargin', '영업이익률'],
  [/순이익률/g, 'netMargin', '순이익률'], [/영업이익(?!률)|영업익|영업손실/g, 'operatingProfit', '영업이익'],
  [/당기순이익(?!률)|순이익(?!률)|순익|당기순손실/g, 'netIncome', '순이익'],
  [/매출액|매출(?!채권|원가|총이익|비중|성장|대비)/g, 'revenue', '매출액'],
  [/부채비율/g, 'debtRatio', '부채비율'], [/유동비율/g, 'currentRatio', '유동비율'],
  [/영업(?:활동)?\s*현금흐름/g, 'operatingCashFlow', '영업현금흐름'], [/잉여현금흐름|FCF/gi, 'freeCashFlow', 'FCF'],
  [/설비투자|CAPEX/gi, 'capex', 'CAPEX'], [/EBITDA/gi, 'ebitda', 'EBITDA'],
  [/자산총계|총자산/g, '자산총계', '자산총계'], [/부채총계|총부채/g, '부채총계', '부채총계'],
  [/자본총계|총자본/g, '자본총계', '자본총계'], [/수주잔고/g, 'unsupported', '수주잔고'],
  [/수주(?:액|고|금액|규모)?|계약(?:금액|규모)|자재\s*공급(?:액|금액|규모)?/g, 'contract', '계약금액'],
];
const number = '[+-]?[\\d,]+(?:\\.\\d+)?';
const numericPattern = new RegExp(`(?=[+-]?\\d)(?:${number}\\s*조\\s*)?(?:${number}\\s*억\\s*)?(?:${number}\\s*만\\s*)?(?:${number}\\s*천\\s*)?(?:${number}\\s*)?원|${number}\\s*(?:%p|%|퍼센트|kV|km|GW|MW|명|척|개)`, 'gi');
export function koreanAmount(text: string): number | null {
  if (!/원\s*$/.test(text)) return null;
  const clean = text.replace(/,/g, '').replace(/\s/g, '');
  const unsigned = clean.replace(/^[+-]/, "");
  let value = 0;
  for (const m of unsigned.matchAll(/([+-]?\d+(?:\.\d+)?)(조|억|만|천|원)/g)) {
    value += Number(m[1]) * ({조: 1e12, 억: 1e8, 만: 1e4, 천: 1e3, 원: 1}[m[2]] ?? 1);
  }
  return Number.isFinite(value) ? (/^-/.test(clean) ? -Math.abs(value) : value) / 1e8 : null;
}
const periodNames = { annual: '연간', half: '상반기', q1: '1분기', q3: '3분기' };
export function claimBasis(c: Pick<FactClaim, 'company'|'year'|'period'|'mode'|'basis'>) {
  return `${c.company} · ${c.year}년 ${periodNames[c.period]} · ${c.mode === 'qtr' ? '당분기' : '누계/기말'} · ${c.basis === 'CFS' ? '연결' : '별도'}`;
}
export function extractArticleClaims(input: FactCheckInput, companyNames: string[]): FactClaim[] {
  const claims: FactClaim[] = [];
  let inheritedCompany = input.company, inheritedYear = input.year, inheritedPeriod = input.period, inheritedMode = input.mode, inheritedBasis = input.basis;
  // 문장 경계에서 소수점과 천 단위 쉼표를 보존합니다.
  const segments = input.article.matchAll(/[^\n!?。]+?(?:[!?。]|\n|(?<=[다요])\.(?=\s|$)|$)/g);
  for (const segment of segments) {
    const paragraph = segment[0];
    const base = segment.index!;
    const companyHits = companyNames.flatMap(name => [...paragraph.matchAll(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'g'))].map(m => ({at:m.index!, name})))
      .filter(hit => !companyNames.some(other => other.length > hit.name.length && paragraph.slice(hit.at).startsWith(other))).sort((a,b)=>a.at-b.at);
    const metricHits = metrics.flatMap(([pattern, metric, label]) => [...paragraph.matchAll(new RegExp(pattern))].map(m => ({at:m.index!, end:m.index!+m[0].length, metric, label, text:m[0]})))
      .filter(hit => !metrics.some(([pattern]) => [...paragraph.matchAll(new RegExp(pattern))].some(m => m.index! <= hit.at && m.index!+m[0].length > hit.end)))
      .sort((a,b)=>a.at-b.at);
    const nums = [...paragraph.matchAll(numericPattern)];
    for (const m of nums) {
      const pos = m.index!, raw = m[0];
      // 계약·매출 금액, 비율, 물리량을 모두 보존하되 지원하지 않는 항목은 확인 필요로 남깁니다.
      let hit = metricHits.filter(h => h.end <= pos).at(-1);
      if (!hit) hit = metricHits.find(h => h.at >= pos + raw.length && !nums.some(n => n.index! > pos && n.index! < h.at));
      const respectively = paragraph.indexOf('각각');
      let ambiguousParallel = false;
      if (respectively >= 0 && pos > respectively) {
        const ordered = metricHits.filter(h=>h.end<=respectively);
        const sameUnit = nums.filter(n=>n.index!>respectively && (/원$/.test(n[0]) === /원$/.test(raw)));
        if (ordered.length > 1) {
          if (ordered.length === sameUnit.length) hit=ordered[sameUnit.indexOf(m)];
          else ambiguousParallel=true;
        }
      }
      const prefix = paragraph.slice(0, pos);
      const localStart = 0;
      const local = paragraph.slice(localStart);
      const before = paragraph.slice(localStart, pos);
      const years = [...before.matchAll(/(20\d{2})\s*년|지난해(?!\s*(?:동기|대비))|작년(?!\s*(?:동기|대비))|올해/g)];
      const yearMatch = years.at(-1);
      const articleYear = Number(input.articleDate.slice(0,4));
      const year = yearMatch ? yearMatch[1] ? Number(yearMatch[1]) : /지난해|작년/.test(yearMatch[0]) ? articleYear-1 : articleYear : inheritedYear;
      const periods = [...before.matchAll(/연간|상반기|반기|[1234]\s*분기|[13]Q|하반기/gi)];
      const p = periods.at(-1)?.[0].replace(/\s/g,'');
      const period = p ? /연간/.test(p) ? 'annual' : /상반기|^반기$|2분기/.test(p) ? 'half' : /1분기|1Q/i.test(p) ? 'q1' : /3분기|3Q/i.test(p) ? 'q3' : inheritedPeriod : inheritedPeriod;
      const mode = /누적|누계/.test(before + paragraph.slice(pos+raw.length,pos+raw.length+12)) ? 'cum' : /2분기|3분기|3Q/i.test(p ?? '') ? 'qtr' : p ? 'cum' : inheritedMode;
      const basisHits = [...before.matchAll(/연결|별도|개별/g)];
      const basis = basisHits.length ? basisHits.at(-1)![0] === '연결' ? 'CFS' : 'OFS' : inheritedBasis;
      const company = companyHits.filter(h => h.at <= pos).at(-1)?.name ?? inheritedCompany;
      const money = /원$/.test(raw), percent = /%|퍼센트/.test(raw);
      const value = money ? koreanAmount(raw)! : Number(raw.match(/[+-]?[\d,]+(?:\.\d+)?/)![0].replace(/,/g,''));
      const unit = money ? '억원' : percent ? /%p/i.test(raw) ? '%p' : '%' : raw.replace(/[\d,.+\-\s]/g,'');
      const tail = paragraph.slice(pos+raw.length, pos+raw.length+25);
      const approximate = /(?:약|가량|대략)\s*$/.test(prefix) || /^(?:\s*)(?:가량|정도|안팎)/.test(tail);
      const growth = percent && /증가|감소|늘|줄|상승|하락|성장/.test(tail) && !/%p/i.test(raw) ? /감소|줄|하락/.test(tail) ? 'decrease' : 'increase' : undefined;
      const lastUnit = money ? [...raw.matchAll(/([\d,.]+)\s*(조|억|만|천|원)/g)].at(-1) : null;
      const digits = (money ? lastUnit?.[1] : raw.match(/[\d,.]+/)?.[0])?.split('.')[1]?.length ?? 0;
      const scale = money ? ({조:1e4,억:1,만:1e-4,천:1e-5,원:1e-8}[lastUnit?.[2] ?? '원'] ?? 1) : 1;
      let reason = !hit ? '비교할 재무 지표를 식별하지 못했습니다.' : '';
      if (!money && !percent) reason = '전압·거리·인원 등은 재무 API의 검증 대상이 아닙니다.';
      if (/%p/i.test(raw)) reason = '퍼센트포인트 변동은 확인이 필요합니다.';
      if (/전망|예상|추정|목표|컨센서스/.test(local)) reason = '전망·목표는 확정 공시 실적과 직접 비교할 수 없습니다.';
      if (/하반기|4분기/.test(p ?? '')) reason = '하반기·4분기는 연간 및 누계 공시의 별도 대조가 필요합니다.';
      if (hit?.metric === 'unsupported') reason = '수주잔고는 재무제표 표준계정으로 검증할 수 없습니다.';
      if (hit?.metric === 'contract' && /총수주|누적|잔고|전체|총사업|신규\s*수주고/.test(before)) reason = '총사업비·누적 수주액은 개별 계약 공시와 범위가 다를 수 있습니다.';
      if (hit?.metric === 'contract' && percent) reason = '계약 관련 비율은 재무비율과 별도로 확인해야 합니다.';
      if (hit?.metric && money && /Margin|Ratio/.test(hit.metric)) reason = '지표와 금액 단위의 연결을 확인해 주세요.';
      if (ambiguousParallel) reason = '각각 나열된 지표와 수치의 대응을 확정하지 못했습니다.';
      if (hit?.metric && percent && !growth && !/Margin|Ratio/.test(hit.metric)) reason = '증감률·구성비의 기준을 확인해 주세요.';
      const claim: FactClaim = {id:claims.length+1,start:base+pos,end:base+pos+raw.length,text:raw,sentence:paragraph.trim(),company,label:hit?.label ?? '기타 수치',metric:hit?.metric,value,unit,year,period,mode,basis,growth,approximate,tolerance:scale*Math.pow(10,-digits)/2,status:'UNVERIFIED',actual:null,actualText:'확인 필요',message:reason};
      if (hit && /손실/.test(hit.text) && money) claim.value = -Math.abs(value);
      claim.basisLabel = claimBasis(claim);
      claims.push(claim);
    }
    inheritedCompany = companyHits.at(-1)?.name ?? inheritedCompany;
    const last = claims.at(-1);
    if (last && last.start >= base) { inheritedYear=last.year; inheritedPeriod=last.period; inheritedMode=last.mode; inheritedBasis=last.basis; }
  }
  return claims;
}
export function applyActual(claim: FactClaim, actual: number) {
  claim.actual = actual;
  claim.actualText = `${actual.toLocaleString('ko-KR',{maximumFractionDigits:4})}${claim.unit}`;
  const allowance = claim.approximate ? Math.max(claim.tolerance, Math.abs(actual)*0.005) : claim.tolerance;
  claim.status = Math.abs(claim.value-actual) <= allowance + 1e-9 ? 'MATCH' : 'MISMATCH';
  claim.message = claim.status === 'MATCH' ? (claim.approximate ? '공시값과 일치합니다(약 표기: 반올림 또는 0.5% 오차 이내).' : '표기 자릿수의 반올림 범위에서 공시값과 일치합니다.') : `기사 수치와 공시값이 다릅니다. 차이: ${(claim.value-actual).toLocaleString('ko-KR',{maximumFractionDigits:4})}${claim.unit}.`;
}

/** 단일판매·공급계약 표의 확정/총 계약금액 행만 사용합니다. 원 단위가 명시된 행이어야 합니다. */
export function parseContractAmount(markup: string): {value:number; excerpt:string} | null {
  const strip = (s:string) => s.replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
  const rows = [...markup.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>strip(m[1]));
  for (const label of [/확정\s*계약금액/, /계약금액/, /계약\s*금액/]) {
    const candidates = rows.filter(row=>label.test(row) && !/조건부|최근\s*매출|비율|정정\s*전|변경\s*전/.test(row));
    for (const row of candidates) {
      // 단위가 없는 숫자, 백만원 표기, 정정 대비표 복수 금액은 추정하지 않습니다.
      if (!/\(\s*원\s*\)|금액\s*원/.test(row)) continue;
      const values = [...row.matchAll(/(?<![\d,.])\d{1,3}(?:,\d{3}){2,}(?![\d,.])|(?<![\d,.])\d{7,}(?![\d,.])/g)].map(m=>Number(m[0].replace(/,/g,'')));
      if (values.length === 1) return { value:values[0]/1e8, excerpt:row };
    }
  }
  return null;
}
