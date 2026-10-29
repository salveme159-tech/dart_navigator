export function metricSourceLinks(citation = "", rceptNo = "") {
  const links:Array<{label:string;url:string}>=[];
  for(const match of citation.matchAll(/https?:\/\/[^\s<>"')]+/g)) {
    const url=match[0].replace(/[.,;·]+$/g,"");
    try {
      const host=new URL(url).hostname;
      const label=host.endsWith("fss.or.kr")?"DART 원문":/naver\.com$/.test(host)?"네이버 금융":/fnguide\.com$/.test(host)?"FnGuide":"보조 출처";
      if(!links.some(item=>item.url===url))links.push({label,url});
    } catch { /* Invalid URL is plain citation text. */ }
  }
  for(const receipt of citation.match(/\b\d{14}\b/g) ?? []) {
    const url=`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receipt}`;
    if(!links.some(item=>item.url.includes(receipt)))links.push({label:`DART #${receipt}`,url});
  }
  if((!links.length || /DART/.test(citation)) && /^\d{14}$/.test(rceptNo) && !links.some(item=>item.url.includes(rceptNo)))links.push({label:"DART 원문",url:`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptNo}`});
  return links;
}
