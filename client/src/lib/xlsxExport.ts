export type AnalysisExportData = {
  metric?: string;
  metricId?: string;
  valueKind?: string;
  value?: number | null;
  headline?: string;
  company?: string;
  period?: string;
  basis?: string;
  formula?: string | null;
  citation?: string;
  rceptNo?: string;
  query?: { question?: string } | string;
  calcInputs?: Array<{ label?: string; account?: string; accountId?: string; value?: number; sign?: string }>;
};

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[m]!));
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n: number) { return new Uint8Array([n & 255, (n >>> 8) & 255]); }
function u32(n: number) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }

function zipStored(entries: Array<{ name: string; content: string }>) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name); const data = encoder.encode(entry.content); const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    local.set(u32(0x04034b50), 0); local.set(u16(20), 4); local.set(u16(0), 6); local.set(u16(0), 8);
    local.set(u16(0), 10); local.set(u16(0), 12); local.set(u32(crc), 14); local.set(u32(data.length), 18); local.set(u32(data.length), 22);
    local.set(u16(name.length), 26); local.set(u16(0), 28); local.set(name, 30); local.set(data, 30 + name.length); chunks.push(local);
    const c = new Uint8Array(46 + name.length);
    c.set(u32(0x02014b50), 0); c.set(u16(20), 4); c.set(u16(20), 6); c.set(u16(0), 8); c.set(u16(0), 10); c.set(u16(0), 12); c.set(u16(0), 14);
    c.set(u32(crc), 16); c.set(u32(data.length), 20); c.set(u32(data.length), 24); c.set(u16(name.length), 28); c.set(u16(0), 30); c.set(u16(0), 32);
    c.set(u16(0), 34); c.set(u16(0), 36); c.set(u32(0), 38); c.set(u32(offset), 42); c.set(name, 46); central.push(c);
    offset += local.length;
  }
  const centralBytes = new Uint8Array(central.reduce((n, x) => n + x.length, 0)); let at = 0;
  for (const x of central) { centralBytes.set(x, at); at += x.length; }
  const end = new Uint8Array(22); end.set(u32(0x06054b50), 0); end.set(u16(0), 4); end.set(u16(0), 6); end.set(u16(entries.length), 8); end.set(u16(entries.length), 10); end.set(u32(centralBytes.length), 12); end.set(u32(offset), 16); end.set(u16(0), 20);
  const all = new Uint8Array(chunks.reduce((n, x) => n + x.length, 0) + centralBytes.length + end.length); at = 0;
  for (const x of chunks) { all.set(x, at); at += x.length; }
  all.set(centralBytes, at); at += centralBytes.length; all.set(end, at);
  return all;
}

function worksheetXml(rows: Array<any[]>, formulaCell?: { row: number; col: number; formula: string; cached: number }) {
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => { const ref = String.fromCharCode(65 + ci) + (ri + 1); if (formulaCell?.row === ri + 1 && formulaCell.col === ci + 1) return `<c r="${ref}"><f>${escapeXml(formulaCell.formula)}</f><v>${formulaCell.cached}</v></c>`; return typeof v === "number" ? `<c r="${ref}" t="n"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(v))}</t></is></c>`; }).join("")}</row>`).join("")}</sheetData></worksheet>`;
}

function formulaFor(data: AnalysisExportData, rows: Array<any[]>) {
  const metric = data.metricId ?? data.metric;
  const find = (needle: string) => rows.findIndex((r) => String(r[0]).includes(needle) || String(r[1]).includes(needle));
  if (metric === "netDebt") {
    const refs = rows.slice(1).map((r, i) => ({ sign: r[3], ref: `C${i + 2}` }));
    return refs.map((x) => `${x.sign === "−" ? "-" : "+"}${x.ref}`).join("").replace(/^\+/, "");
  }
  if (metric === "operatingMargin") { const op = find("영업이익"), rev = find("매출"); if (op >= 0 && rev >= 0) return `C${op + 1}/C${rev + 1}*100`; }
  if (metric === "debtRatio") { const a = find("부채총계"), b = find("자본총계"); if (a >= 0 && b >= 0) return `C${a + 1}/C${b + 1}*100`; }
  if (metric === "currentRatio") { const a = find("유동자산"), b = find("유동부채"); if (a >= 0 && b >= 0) return `C${a + 1}/C${b + 1}*100`; }
  if (metric === "interestCoverage") { const a = find("영업이익"), b = find("이자"); if (a >= 0 && b >= 0) return `C${a + 1}/ABS(C${b + 1})`; }
  if (metric === "capex") {
    const capexRows = rows.map((r, i) => ({ i, label: String(r[0]), account: String(r[1]) })).filter((x) => x.i > 0 && (x.label.includes("CAPEX") || /유형자산|무형자산|투자부동산/.test(x.account)));
    if (capexRows.length) return capexRows.map((x) => `C${x.i + 1}`).join("+");
  }
  if (metric === "freeCashFlow") {
    const a = find("영업활동");
    const capexRows = rows.map((r, i) => ({ i, label: String(r[0]), account: String(r[1]) })).filter((x) => x.i > 0 && String(rows[x.i]?.[3] ?? "").includes("−"));
    if (a >= 0 && capexRows.length) return `C${a + 1}-(${capexRows.map((x) => `C${x.i + 1}`).join("+")})`;
  }
  if (metric === "netWorkingCapital") { const a = find("유동자산"), b = find("유동부채"); if (a >= 0 && b >= 0) return `C${a + 1}-C${b + 1}`; }
  if (metric === "ebitda") { const a = find("영업이익"), b = find("감가상각비"), c = find("무형자산상각비"); if (a >= 0 && b >= 0 && c >= 0) return `C${a + 1}+C${b + 1}+C${c + 1}`; }
  if (metric === "roe" || metric === "roa") { const p = find("분자"), c = find("당기말"), pr = find("전기말"); if (p >= 0 && c >= 0 && pr >= 0) return `C${p + 1}/AVERAGE(C${c + 1}:C${pr + 1})*100`; }
  return null;
}

export function buildAnalysisXlsx(data: AnalysisExportData): Uint8Array {
  const inputs = Array.isArray(data.calcInputs) ? data.calcInputs : [];
  const rows: Array<any[]> = [["항목", "공시 계정", "값", "부호"], ...inputs.map((x) => [x.label ?? "입력값", x.account ?? "", Number(x.value ?? 0), x.sign ?? "+"])];
  const formula = data.valueKind === "calculated" || data.formula ? formulaFor(data, rows) : null;
  const cached = Number(data.value ?? 0);
  rows.push([formula ? "DERIVED" : "REPORTED_VALUE", data.formula ?? "DART 공시값", cached, formula ? "= Formula" : "= Source"]);
  const question = typeof data.query === "string" ? data.query : data.query?.question ?? "";
  const summary = [["질문", question], ["회사", data.company ?? ""], ["지표", data.metric ?? ""], ["값 종류", formula ? "DERIVED" : "REPORTED"], ["결과", data.headline ?? ""], ["보고기간", data.period ?? ""], ["기준", data.basis ?? ""], ["산식", data.formula ?? "원천 공시값"]];
  const sources = [["출처", data.citation ?? ""], ["접수번호", data.rceptNo ?? ""]];
  const files = [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Calculation" sheetId="2" r:id="rId2"/><sheet name="Sources" sheetId="3" r:id="rId3"/></sheets><calcPr calcMode="auto" fullCalcOnLoad="1"/></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", content: worksheetXml(summary) },
    { name: "xl/worksheets/sheet2.xml", content: worksheetXml(rows, formula ? { row: rows.length, col: 3, formula, cached } : undefined) },
    { name: "xl/worksheets/sheet3.xml", content: worksheetXml(sources) },
  ];
  return zipStored(files);
}
