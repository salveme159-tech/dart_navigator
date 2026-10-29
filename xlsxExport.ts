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