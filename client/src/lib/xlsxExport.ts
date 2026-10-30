export interface ExportTableRow {
  corpName: string;
  metricName: string;
  period: string;
  valueFormatted: string;
  rawUnitValue: string;
  formulaOrAccount: string;
  sourceReport: string;
  rceptNo: string;
  basis?: string;
  sourceUrls?: string;
}

export function exportRowsToCsvExcel(filename: string, rows: ExportTableRow[]) {
  const headers = [
    "기업명",
    "지표/계정명",
    "기준기간",
    "산출값(단위 포함)",
    "수치(표시 단위 포함)",
    "계산식/원문계정",
    "공시출처",
    "DART접수번호",
    "연결/별도 기준",
    "출처 URL",
  ];
  const escapeCsv = (val: string) => `"${String(val ?? "").replace(/^[=+@]/, "'$&").replace(/"/g, '""')}"`;
  const csvLines = [
    headers.map(escapeCsv).join(","),
    ...rows.map((r) =>
      [
        r.corpName,
        r.metricName,
        r.period,
        r.valueFormatted,
        r.rawUnitValue,
        r.formulaOrAccount,
        r.sourceReport,
        r.rceptNo,
        r.basis ?? "미확인",
        r.sourceUrls ?? "",
      ]
        .map(escapeCsv)
        .join(",")
    ),
  ];

  // UTF-8 BOM을 추가하여 엑셀에서 한글 및 표 구조가 깨지지 않고 즉시 열리도록 처리
  const bom = "\uFEFF";
  const blob = new Blob([bom + csvLines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename.endsWith(".csv") ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));

export function exportRowsToPrintablePdf(title: string, rows: ExportTableRow[]) {
  const win = window.open("", "_blank", "width=1024,height=768");
  if (!win) {
    window.print();
    return;
  }
  const tableRowsHtml = rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.corpName)}</td>
        <td><strong>${escapeHtml(r.metricName)}</strong></td>
        <td style="text-align:center;">${escapeHtml(r.period)}</td>
        <td style="text-align:right; font-weight:700; color:#0f5132;">${escapeHtml(r.valueFormatted)}</td>
        <td>${escapeHtml(r.formulaOrAccount)}</td>
        <td>${escapeHtml(r.sourceReport)} (${escapeHtml(r.rceptNo)})<br>${escapeHtml(r.basis)}<br>${escapeHtml(r.sourceUrls)}</td>
      </tr>`
    )
    .join("");

  win.document.write(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)}</title>
      <style>
        body { font-family: "Pretendard", -apple-system, BlinkMacSystemFont, sans-serif; padding: 32px; color: #1e293b; }
        h1 { font-size: 20px; margin-bottom: 6px; color: #0f172a; }
        p.sub { font-size: 12px; color: #64748b; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        th { background: #f1f5f9; color: #334155; font-weight: 700; text-align: left; padding: 10px 12px; border: 1px solid #cbd5e1; }
        td { padding: 10px 12px; border: 1px solid #cbd5e1; vertical-align: middle; }
        tr:nth-child(even) { background: #f8fafc; }
        @media print {
          body { padding: 10px; }
        }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(title)}</h1>
      <p class="sub">출력일시: ${new Date().toLocaleString("ko-KR")} | 지표별 표시 출처 기준</p>
      <table>
        <thead>
          <tr>
            <th>기업명</th>
            <th>지표 / 계정</th>
            <th style="text-align:center;">기준기간</th>
            <th style="text-align:right;">결과값</th>
            <th>산식 및 계정근거</th>
            <th>공시 출처 (접수번호)</th>
          </tr>
        </thead>
        <tbody>
          ${tableRowsHtml}
        </tbody>
      </table>
      <script>
        window.onload = function() {
          setTimeout(function() { window.print(); }, 250);
        };
      </script>
    </body>
    </html>
  `);
  win.document.close();
}
// The on-screen comparison is company x metric. Both exports use that same matrix.
export interface ComparisonExportMatrix {
  companies: string[];
  metrics: string[];
  cells: Record<string, Record<string, { text: string; verified: boolean }>>;
  sources: Record<string, { label: string; url: string }>;
}

const xml = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const utf8 = (v: string) => new TextEncoder().encode(v);
const column = (n: number) => { let s = ""; for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes: Uint8Array) => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const u16 = (n: number) => [n & 255, (n >>> 8) & 255];
const u32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
function zipStored(files: Array<[string, string]>): Blob {
  const parts: Uint8Array[] = []; const directory: Uint8Array[] = []; let offset = 0;
  for (const [name, body] of files) {
    const n = utf8(name), data = utf8(body), crc = crc32(data);
    const local = new Uint8Array([80,75,3,4,20,0,0,0,0,0,0,0,0,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(n.length),0,0,...n]);
    parts.push(local, data);
    directory.push(new Uint8Array([80,75,1,2,20,0,20,0,0,0,0,0,0,0,0,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(n.length),0,0,0,0,0,0,0,0,0,0,0,0,...u32(offset),...n]));
    offset += local.length + data.length;
  }
  const centralSize = directory.reduce((sum, p) => sum + p.length, 0);
  const end = new Uint8Array([80,75,5,6,0,0,0,0,...u16(files.length),...u16(files.length),...u32(centralSize),...u32(offset),0,0]);
  const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  };
  return new Blob([...parts, ...directory, end].map(asArrayBuffer), {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
const save = (blob: Blob, filename: string) => { const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
export function exportComparisonExcel(matrix: ComparisonExportMatrix) {
  const headers = ["기업", ...matrix.metrics, "출처"];
  const data = matrix.companies.map(name => [name, ...matrix.metrics.map(metric => matrix.cells[name]?.[metric]?.text ?? "수치 미검증"), matrix.sources[name]?.label ?? "출처 미확인"]);
  const all = [headers, ...data];
  const sheetRows = all.map((row, r) => `<row r="${r+1}" ht="${r === 0 ? 30 : 46}" customHeight="1">${row.map((value,c) => `<c r="${column(c)}${r+1}" s="${r === 0 ? 1 : c === 0 ? 2 : c === row.length-1 ? 4 : 3}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join("")}</row>`).join("");
  const widths = headers.map((_, c) => `<col min="${c+1}" max="${c+1}" width="${c===0?23:c===headers.length-1?24:19}" customWidth="1"/>`).join("");
  const links = matrix.companies.flatMap((name, i) => matrix.sources[name]?.url ? [{cell:`${column(headers.length-1)}${i+2}`, url:matrix.sources[name].url}] : []);
  const hyperlinkXml = links.length ? `<hyperlinks>${links.map((item,i)=>`<hyperlink ref="${item.cell}" r:id="rId${i+1}"/>`).join("")}</hyperlinks>` : "";
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${widths}</cols><sheetData>${sheetRows}</sheetData>${hyperlinkXml}<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="맑은 고딕"/><color rgb="FF0F172A"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/><color rgb="FF334155"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/><color rgb="FF0F172A"/></font><font><u/><sz val="10"/><name val="맑은 고딕"/><color rgb="FF047857"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFE2E8F0"/></left><right style="thin"><color rgb="FFE2E8F0"/></right><top style="thin"><color rgb="FFE2E8F0"/></top><bottom style="thin"><color rgb="FFE2E8F0"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map((item,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(item.url)}" TargetMode="External"/>`).join("")}</Relationships>`;
  const files: Array<[string,string]> = [
    ["[Content_Types].xml",`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels",`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml",`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="결과값 비교" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels",`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml",sheet], ["xl/worksheets/_rels/sheet1.xml.rels",rels], ["xl/styles.xml",styles],
  ];
  save(zipStored(files),"기업별_결과값_비교.xlsx");
}

export function exportComparisonPdf(matrix: ComparisonExportMatrix) {
  const win = window.open("", "_blank", "width=1200,height=850");
  if (!win) { alert("PDF 인쇄 창이 차단되었습니다. 팝업을 허용한 뒤 다시 시도하세요."); return; }
  const heads = ["기업", ...matrix.metrics, "출처"];
  const rows = matrix.companies.map(name => `<tr><td class="company">${xml(name)}</td>${matrix.metrics.map(metric=>`<td class="number">${xml(matrix.cells[name]?.[metric]?.text ?? "수치 미검증")}</td>`).join("")}<td class="source">${matrix.sources[name]?.url ? `<a href="${xml(matrix.sources[name].url)}">${xml(matrix.sources[name].label)}</a>` : "출처 미확인"}</td></tr>`).join("");
  win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>결과값 비교</title><style>@page{size:landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Pretendard,'Malgun Gothic',Arial,sans-serif;color:#0f172a;margin:0;padding:12px}h2{font-size:18px;margin:0 0 18px;font-weight:800}table{border-collapse:collapse;width:100%;table-layout:auto;font-size:14.67px}th,td{border:1px solid #e2e8f0;padding:12px 13px;vertical-align:middle}th{background:#f1f5f9;color:#334155;text-align:center;font-weight:700}td.company{text-align:center;font-weight:800}td.number{text-align:right;font-weight:700;white-space:nowrap}td.source{font-size:12px;white-space:nowrap}a{color:#047857;text-decoration:underline}tr{break-inside:avoid}@media print{body{padding:0}thead{display:table-header-group}a{color:#047857}}</style></head><body><h2>결과값 비교</h2><table><thead><tr>${heads.map(h=>`<th>${xml(h)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print();<\/script></body></html>`);
  win.document.close();
}
