// OpenDART 전자공시 본문 바로가기 URL 추출. 이 모듈은 네트워크/프레임워크 의존성이 없습니다.
export type ViewerDocumentArgs = {
  rcpNo: string;
  dcmNo: string;
  eleId: string;
  offset: string;
  length: string;
  dtd: string;
};

const DART_VIEWER = "https://dart.fss.or.kr/report/viewer.do";
const decodeHtml = (html: string) => html
  .replace(/&amp;/gi, "&")
  .replace(/&#38;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&nbsp;|&#160;/gi, " ");
const normalizeHeading = (value: string) => decodeHtml(value).replace(/[\s·ㆍ_\-〔〕()（）]/g, "").toLowerCase();


/** DART main.do가 node1/node2 객체의 속성 할당으로 생성하는 목차 항목. */
export type DartTocNode = ViewerDocumentArgs & {
  text: string;
  nodeName?: string;
  ancestors?: string[];
  depth?: number;
};

function decodeJsString(value: string): string {
  return value
    .replace(/\\u([0-9a-f]{4})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\r\\n|\\n|\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\([\\"'])/g, "$1");
}

/**
 * 신형 DART TOC 구조를 파싱합니다.
 * 예: var node2 = {}; node2['text'] = "2. 연결재무제표"; node2['dcmNo'] = "...";
 * 문자열 내 세미콜론이나 공백에 의존하지 않고 각 node 선언의 범위 안에서 속성을 읽습니다.
 */
export function extractTocNodesFromMainHtml(html: string, fallbackRcpNo: string): DartTocNode[] {
  const source = decodeHtml(html)
    .replace(/\\u([0-9a-f]{4})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
  const declarationRegex = /\b(?:var|let|const)\s+(node\d+)\s*=\s*\{\s*\}\s*;?/gi;
  const declarations = [...source.matchAll(declarationRegex)];
  const rawNodes = new Map<string, DartTocNode>();
  const parentByChild = new Map<string, string>();

  const unquote = (raw: string | undefined) => raw === undefined ? "" : decodeJsString(raw.trim());
  const getProp = (block: string, variable: string, key: string): string => {
    const escapedVariable = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `\\b${escapedVariable}\\s*(?:\\[\\s*['"]${escapedKey}['"]\\s*\\]|\\.\\s*${escapedKey})\\s*=\\s*(?:"((?:\\\\.|[^"\\\\])*)"|'((?:\\\\.|[^'\\\\])*)')`,
      "i",
    );
    const match = re.exec(block);
    return unquote(match?.[1] ?? match?.[2]);
  };

  for (let i = 0; i < declarations.length; i++) {
    const declaration = declarations[i];
    const variable = declaration[1];
    const start = declaration.index ?? 0;
    const end = i + 1 < declarations.length ? (declarations[i + 1].index ?? source.length) : source.length;
    const block = source.slice(start, end);
    const text = getProp(block, variable, "text");
    const dcmNo = getProp(block, variable, "dcmNo");
    const eleId = getProp(block, variable, "eleId") || getProp(block, variable, "id");
    const rcpNo = getProp(block, variable, "rcpNo") || fallbackRcpNo;
    if (!text || !/^\d{4,}$/.test(dcmNo) || !eleId || rcpNo !== fallbackRcpNo) continue;
    const offset = getProp(block, variable, "offset") || "0";
    const length = getProp(block, variable, "length") || "0";
    const dtd = getProp(block, variable, "dtd") || "dart4.xsd";
    const depthRaw = getProp(block, variable, "depth") || getProp(block, variable, "level") || getProp(block, variable, "lvl");
    const depth = /^\d+$/.test(depthRaw) ? Number(depthRaw) : undefined;
    rawNodes.set(variable, { nodeName: variable, text: text.trim(), rcpNo, dcmNo, eleId, offset, length, dtd, depth });
  }

  // `var nodeN = {}` 선언 방식이 아닌 객체 리터럴/JSON 형태의 목차(예: {text:"...", dcmNo:"...", eleId:"..."})도 읽습니다.
  if (rawNodes.size === 0) {
    const literalRegex = /\{[^{}]*?\bdcmNo\b[^{}]*?\}/gi;
    let seq = 0;
    for (const literal of source.matchAll(literalRegex)) {
      const body = literal[0];
      const read = (key: string) => {
        const m = new RegExp(`['"]?\\b${key}['"]?\\s*[:=]\\s*(?:"((?:\\\\.|[^"\\\\])*)"|'((?:\\\\.|[^'\\\\])*)'|(\\d+))`, "i").exec(body);
        return m ? decodeJsString((m[1] ?? m[2] ?? m[3] ?? "").trim()) : "";
      };
      const text = read("text") || read("title") || read("name");
      const dcmNo = read("dcmNo");
      const eleId = read("eleId") || read("id");
      const rcpNo = read("rcpNo") || fallbackRcpNo;
      if (!text || !/^\d{4,}$/.test(dcmNo) || !eleId || rcpNo !== fallbackRcpNo) continue;
      const depthRaw = read("depth") || read("level");
      rawNodes.set(`literal${seq++}`, { nodeName: `literal${seq}`, text: text.trim(), rcpNo, dcmNo, eleId, offset: read("offset") || "0", length: read("length") || "0", dtd: read("dtd") || "dart4.xsd", depth: /^\d+$/.test(depthRaw) ? Number(depthRaw) : undefined });
    }
  }

  // nodeParent['children'].push(nodeChild) 관계를 이용해 세부 제목만 있는 노드도 연결/별도 기준을 판별합니다.
  const childPush = /\b(node\d+)\s*(?:\[\s*['"]children['"]\s*\]|\.\s*children)\s*\.\s*push\s*\(\s*(node\d+)\s*\)/gi;
  for (const relation of source.matchAll(childPush)) parentByChild.set(relation[2], relation[1]);
  const getAncestors = (nodeName?: string): string[] => {
    const result: string[] = [];
    const visited = new Set<string>();
    let current = nodeName;
    while (current && parentByChild.has(current) && !visited.has(current)) {
      visited.add(current);
      current = parentByChild.get(current);
      const parent = current ? rawNodes.get(current) : undefined;
      if (parent?.text) result.unshift(parent.text);
    }
    return result;
  };
  const ordered = [...rawNodes.values()];
  // children.push 관계가 없고 depth 속성만 있는 평면 목차는 선언 순서와 depth로 상위 목차를 추정합니다.
  const depthAncestors = new Map<string, string[]>();
  if (parentByChild.size === 0 && ordered.some((node) => node.depth !== undefined)) {
    const stack: Array<{ depth: number; text: string }> = [];
    for (const node of ordered) {
      const depth = node.depth ?? 0;
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      depthAncestors.set(node.nodeName ?? node.text, stack.map((item) => item.text));
      stack.push({ depth, text: node.text });
    }
  }
  return ordered.map((node) => ({ ...node, ancestors: depthAncestors.get(node.nodeName ?? node.text) ?? getAncestors(node.nodeName) }));
}

export function selectBestFinancialStatementNode(
  nodes: DartTocNode[],
  fsDiv: "CFS" | "OFS",
  statementType: "BS" | "IS" | "CF" = "BS",
): { node: DartTocNode; matchType: "EXACT_TABLE" | "PARENT_FS_SECTION" | "BASIS_FALLBACK" | "FINANCIAL_SECTION" } | null {
  const normalize = (value: string) => normalizeHeading(value).replace(/^(?:[0-9]+|[ivxlcdm]+)\.?/i, "");
  const statementPatterns: Record<typeof statementType, RegExp> = {
    BS: /재무상태표|대차대조표/,
    IS: /포괄손익계산서|손익계산서/,
    CF: /현금흐름표/,
  };
  type FsCandidate = { node: DartTocNode; matchType: "EXACT_TABLE" | "PARENT_FS_SECTION"; score: number };
  const candidates = nodes.flatMap((node): FsCandidate[] => {
    const title = normalize(node.text);
    const ancestry = (node.ancestors ?? []).map(normalize);
    const lineage = [title, ...ancestry].join(" ");
    if (/주석|요약|감사보고서|검토보고서|내부회계|사업의내용/.test(lineage)) return [];
    const connected = /연결/.test(lineage);
    const separate = /별도|개별/.test(lineage);
    if (fsDiv === "CFS" && separate && !connected) return [];
    if (fsDiv === "OFS" && connected && !separate) return [];

    const exactTable = statementPatterns[statementType].test(title);
    const explicitParent = fsDiv === "CFS"
      ? /^(?:\d+)?연결재무제표$/.test(title)
      : /^(?:(?:\d+)?별도재무제표|(?:\d+)?재무제표)$/.test(title) && !connected;
    // 재무상태표/손익계산서/현금흐름표만 적힌 하위 항목은 상위 목차에서 기준이 명시된 경우에만 허용합니다.
    if (exactTable && !connected && !separate && fsDiv === "CFS" && !ancestry.some((a) => /연결재무제표/.test(a))) return [];
    if (exactTable && !connected && !separate && fsDiv === "OFS" && ancestry.some((a) => /연결재무제표/.test(a))) return [];
    if (!exactTable && !explicitParent) return [];
    if (exactTable) return [{ node, matchType: "EXACT_TABLE" as const, score: 100 + (connected && fsDiv === "CFS" ? 10 : 0) + (separate && fsDiv === "OFS" ? 10 : 0) }];
    return [{ node, matchType: "PARENT_FS_SECTION" as const, score: 50 }];
  });
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best) return { node: best.node, matchType: best.matchType };

  // 2순위: 연결재무제표가 없는 회사(연결 요청)는 '재무제표' 본문으로, 별도 재무제표가 없으면 연결재무제표 본문으로 이동합니다.
  // 표지로 보내는 것보다 수치가 실제로 실린 재무제표 본문으로 가는 편이 낫기 때문에 기준 차이는 matchType으로 표시합니다.
  const basisFallback = nodes.filter((node) => {
    const title = normalize(node.text);
    const lineage = [title, ...(node.ancestors ?? []).map(normalize)].join(" ");
    if (/주석|요약|감사보고서|검토보고서|내부회계|사업의내용/.test(lineage)) return false;
    return fsDiv === "CFS" ? /^(?:별도|개별)?재무제표$/.test(title) : /^연결재무제표$/.test(title);
  });
  if (basisFallback.length) return { node: basisFallback[0], matchType: "BASIS_FALLBACK" };

  // 3순위: 재무에 관한 사항(재무 정보 구간의 시작) — 그래도 공시 표지가 아니라 본문 구간입니다.
  const financialSection = nodes.find((node) => /^재무에관한사항$/.test(normalize(node.text)));
  return financialSection ? { node: financialSection, matchType: "FINANCIAL_SECTION" } : null;
}

export function buildViewerDoUrl(node: DartTocNode): string {
  const params = new URLSearchParams({
    rcpNo: node.rcpNo,
    dcmNo: node.dcmNo,
    eleId: node.eleId,
    offset: node.offset || "0",
    length: node.length || "0",
    dtd: node.dtd || "dart4.xsd",
  });
  return `${DART_VIEWER}?${params.toString()}`;
}

// DART는 공시 종류에 따라 인자 따옴표/공백/Tree 네임스페이스 표기가 달라집니다.
// eleId는 숫자뿐 아니라 영문·밑줄·하이픈을 포함할 수 있으므로 괄호/콤마/공백 전까지 허용합니다.
const VIEW_DOC_CALL = /viewDoc\s*\(\s*['"]?(\d{14})['"]?\s*,\s*['"]?(\d{4,})['"]?\s*,\s*['"]?([^,'"\)\s]+)['"]?\s*,\s*['"]?(\d*)['"]?\s*,\s*['"]?(\d*)['"]?\s*,\s*['"]?([^,'"\)\s]*)['"]?\s*\)/gi;

function buildViewerUrl(args: ViewerDocumentArgs) {
  return `${DART_VIEWER}?rcpNo=${encodeURIComponent(args.rcpNo)}&dcmNo=${encodeURIComponent(args.dcmNo)}&eleId=${encodeURIComponent(args.eleId)}&offset=${encodeURIComponent(args.offset)}&length=${encodeURIComponent(args.length)}&dtd=${encodeURIComponent(args.dtd || "dart3.xsd")}`;
}

/**
 * DART main.do 또는 포함 프레임에서 초기 뷰어 매개변수를 찾아냅니다.
 * 본문 위치 판별에 실패했을 때 표지로 우회하기 위한 용도가 아니라, 목차 HTML을 추가 조회하기 위한 값입니다.
 */
export function extractInitialViewerArgs(html: string, expectedRcpNo: string): ViewerDocumentArgs | null {
  const decoded = decodeHtml(html);
  for (const match of decoded.matchAll(VIEW_DOC_CALL)) {
    const [, rcpNo, dcmNo, eleId, offset, length, dtd] = match;
    if (rcpNo !== expectedRcpNo || !/^\d+$/.test(dcmNo) || !eleId) continue;
    return { rcpNo, dcmNo, eleId, offset, length, dtd: dtd || "dart3.xsd" };
  }

  // 서버가 목차 노드를 포함하지 않고 iframe src만 내려주는 응답 변형에 대응합니다.
  const frameSources = [...decoded.matchAll(/(?:src|href)\s*=\s*(["'])([^"']*viewer\.do\?[^"']+)\1/gi)].map((m) => m[2]);
  for (const source of frameSources) {
    try {
      const url = new URL(source, "https://dart.fss.or.kr");
      const rcpNo = url.searchParams.get("rcpNo") ?? expectedRcpNo;
      const dcmNo = url.searchParams.get("dcmNo") ?? "";
      const eleId = url.searchParams.get("eleId") ?? "1";
      if (rcpNo !== expectedRcpNo || !/^\d{4,}$/.test(dcmNo)) continue;
      return {
        rcpNo,
        dcmNo,
        eleId,
        offset: url.searchParams.get("offset") ?? "0",
        length: url.searchParams.get("length") ?? "0",
        dtd: url.searchParams.get("dtd") ?? "dart3.xsd",
      };
    } catch { /* 다른 frame URL 후보를 계속 확인합니다. */ }
  }
  return null;
}

export function parseViewerDeepLinkHtml(html: string, rceptNo: string, requestedSection: "CFS" | "OFS", statement: "BS" | "IS" | "CF" = "BS") {
  const decoded = decodeHtml(html)
    .replace(/\\u([0-9a-f]{4})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
  const requiredStatement: Record<typeof statement, RegExp> = {
    BS: /재무상태표|대차대조표/,
    IS: /손익계산서|포괄손익/,
    CF: /현금흐름표/,
  };
  const candidates: Array<{ at: number; url: string; score: number; title: string }> = [];
  // DART 일부 HTML은 TreeNode의 제목/id와 viewDoc 클릭 핸들러를 서로 다른 스크립트 블록에 둡니다.
  // 제목과 가장 가까운 호출을 고르면 이웃 목차의 dcmNo가 선택될 수 있으므로, TreeNode id == viewDoc eleId로 연결합니다.
  const nodeStartMatches = [...decoded.matchAll(/(?:treeNode\w*\s*=\s*)?new\s+(?:Tree\.)?TreeNode\s*\(/gi)];
  const calls = [...decoded.matchAll(VIEW_DOC_CALL)].filter((call) => call[1] === rceptNo && /^\d{4,}$/.test(call[2] ?? "") && Boolean(call[3]));
  const decodeJsText = (value: string) => value
    .replace(/\\u([0-9a-f]{4})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\[nrt]/g, " ");
  for (let i = 0; i < nodeStartMatches.length; i++) {
    const start = nodeStartMatches[i].index ?? 0;
    const end = i + 1 < nodeStartMatches.length ? (nodeStartMatches[i + 1].index ?? decoded.length) : decoded.length;
    const block = decoded.slice(start, end);
    const titleRaw = block.match(/\b(?:text|title|name|label)\s*:\s*(["'`])([\s\S]*?)\1/i)?.[2]
      ?? block.match(/new\s+(?:Tree\.)?TreeNode\s*\(\s*(["'`])([\s\S]*?)\1/i)?.[2]
      ?? "";
    const id = block.match(/\bid\s*:\s*(["']?)([A-Za-z0-9_-]+)\1/i)?.[2] ?? "";
    const title = decodeJsText(titleRaw).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const normalizedTitle = normalizeHeading(title);
    const strippedNumber = normalizedTitle.replace(/^\d+[.]?/, "");
    const genericFinancialSection = /^(?:연결|별도|개별)?재무제표$/.test(strippedNumber);
    if (!title || (!requiredStatement[statement].test(normalizedTitle) && !genericFinancialSection)) continue;
    // 세부 목차가 단순히 '재무상태표'로 표시되는 경우, 가장 가까운 상위 '연결재무제표/재무제표' 목차를 기준으로 구분합니다.
    const priorTitlePattern = /\b(?:text|title|name|label)\s*:\s*(["'`])([\s\S]*?)\1/gi;
    const priorTitles = [...decoded.slice(0, start).matchAll(priorTitlePattern)].map((m) => normalizeHeading(decodeJsText(m[2] ?? "").replace(/<[^>]+>/g, " ")));
    const parentGroup = [...priorTitles].reverse().find((heading) => /^(?:연결|별도|개별)?재무제표$/.test(heading.replace(/^\d+[.]?/, ""))) ?? "";
    const isConnected = /연결/.test(normalizedTitle) || (!/별도|개별/.test(normalizedTitle) && /연결/.test(parentGroup));
    const isSeparate = /별도|개별/.test(normalizedTitle) || (!/연결/.test(normalizedTitle) && /별도|개별/.test(parentGroup));
    if (requestedSection === "CFS" && isSeparate && !isConnected) continue;
    if (requestedSection === "OFS" && isConnected && !isSeparate) continue;
    if (genericFinancialSection && requestedSection === "CFS" && !isConnected) continue;
    if (genericFinancialSection && requestedSection === "OFS" && isConnected) continue;
    const matchingCalls = calls.filter((call) => String(call[3] ?? "").replace(/^['"]|['"]$/g, "") === id);
    for (const call of matchingCalls) {
      const [, realRcp, dcmNo, eleId, offset, length, dtdRaw] = call;
      const args: ViewerDocumentArgs = { rcpNo: realRcp, dcmNo, eleId, offset: /^\d+$/.test(offset) ? offset : "0", length: /^\d+$/.test(length) ? length : "0", dtd: (dtdRaw ?? "").replace(/[\s'"<>]/g, "") || "dart3.xsd" };
      const exactTitle = requiredStatement[statement].test(normalizedTitle);
      const score = (exactTitle ? 40 : 12) + (isConnected && requestedSection === "CFS" ? 20 : 0) + (isSeparate && requestedSection === "OFS" ? 20 : 0);
      candidates.push({ at: call.index ?? start, url: buildViewerUrl(args), score, title });
    }
  }
  // DART HTML은 treeNode1 변수를 여러 번 재사용할 수 있으므로, 각 viewDoc 호출의
  // 제목은 해당 노드 시작점부터 다음 노드 시작점까지만 읽습니다. 페이지 전체에서 마지막 text를
  // 가져오면 직후 노드의 제목으로 덮여 잘못된 문서/표지로 이동할 수 있습니다.
  const nodeStarts = [...decoded.matchAll(/(?:treeNode\w*\s*=\s*)?new\s+(?:Tree\.)?TreeNode\s*\(/gi)].map((m) => m.index ?? 0);
  for (const match of decoded.matchAll(VIEW_DOC_CALL)) {
    const at = match.index ?? 0;
    const [, realRcp, dcmNo, eleId, offset, length, dtdRaw] = match;
    if (realRcp !== rceptNo || !/^\d+$/.test(dcmNo) || !eleId) continue;
    let nodeIndex = -1;
    for (let i = nodeStarts.length - 1; i >= 0; i--) {
      if (nodeStarts[i] <= at) { nodeIndex = i; break; }
    }
    const nodeStart = nodeIndex >= 0 ? nodeStarts[nodeIndex] : Math.max(0, at - 1000);
    const nodeEnd = nodeIndex >= 0 && nodeIndex + 1 < nodeStarts.length ? nodeStarts[nodeIndex + 1] : Math.min(decoded.length, at + 500);
    const context = decoded.slice(nodeStart, Math.max(at + match[0].length, nodeEnd));
    // 보통은 { text: "제목" } 형태지만, 일부 공시는 TreeNode("제목", ...) 또는 title/name 키를 사용합니다.
    const titleMatch = context.match(/\b(?:text|title|name|label)\s*:\s*(["'`])([\s\S]*?)\1/i)
      ?? context.match(/new\s+(?:Tree\.)?TreeNode\s*\(\s*(["'`])([\s\S]*?)\1/i);
    const title = decodeHtml((titleMatch?.[2] ?? "").replace(/\\u([0-9a-f]{4})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16))))
      .replace(/<[^>]+>/g, " ").replace(/\\[nrt]/g, " ").replace(/\s+/g, " ").trim();
    const normalizedTitle = normalizeHeading(title);
    const normalizedContext = normalizeHeading(context.replace(/<[^>]+>/g, " "));
    const heading = requiredStatement[statement];
    const titleHasStatement = heading.test(normalizedTitle);
    // 상당수 DART 공시는 세부 BS/IS/CF를 각각 목차로 제공하지 않고
    // '2. 연결재무제표' 한 항목 아래에 모든 재무제표를 넣습니다. 이 경우 그 실제 항목의
    // dcmNo/eleId로 이동하는 것이 해당 숫자가 있는 재무제표 본문으로 가는 올바른 경로입니다.
    const strippedNumber = normalizedTitle.replace(/^\d+[.]?/, "");
    const genericFinancialSection = /^(?:연결|별도|개별)?재무제표$/.test(strippedNumber);
    if (!titleHasStatement && !genericFinancialSection) continue;
    const titleIsConnected = /연결/.test(normalizedTitle);
    const titleIsSeparate = /별도|개별/.test(normalizedTitle);
    const isConnected = titleIsConnected || (!titleIsSeparate && /연결/.test(normalizedContext));
    const isSeparate = titleIsSeparate || (!titleIsConnected && /별도|개별/.test(normalizedContext));
    if (requestedSection === "CFS" && isSeparate && !isConnected) continue;
    if (requestedSection === "OFS" && isConnected && !isSeparate) continue;
    // 연결 요청은 '연결재무제표'처럼 연결 기준이 명시된 묶음만 허용합니다.
    // 별도 요청의 '재무제표'는 연결 표시가 없는 경우에 한해 낮은 우선순위로 허용합니다.
    if (genericFinancialSection && requestedSection === "CFS" && !titleIsConnected) continue;
    if (genericFinancialSection && requestedSection === "OFS" && titleIsConnected) continue;
    let score = titleHasStatement ? 20 : 8;
    if (requestedSection === "CFS" && isConnected) score += 10;
    if (requestedSection === "OFS" && isSeparate) score += 10;
    // OFS 문서는 보고서에 따라 '재무상태표'처럼 기준명이 생략되기도 하므로
    // 명시적 연결 문서가 아닌 목차 항목도 후보로 남기되 명시적 OFS보다 낮은 점수를 줍니다.
    if (requestedSection === "OFS" && !isConnected && !isSeparate) score += 1;
    if (statement === "BS" && /재무상태표|대차대조표/.test(normalizedTitle)) score += 2;
    if (statement === "IS" && /손익계산서|포괄손익/.test(normalizedTitle)) score += 2;
    if (statement === "CF" && /현금흐름표/.test(normalizedTitle)) score += 2;
    const args: ViewerDocumentArgs = {
      rcpNo: realRcp,
      dcmNo,
      eleId,
      offset: /^\d+$/.test(offset) ? offset : "0",
      length: /^\d+$/.test(length) ? length : "0",
      dtd: dtdRaw.replace(/[\s'"<>]/g, "") || "dart3.xsd",
    };
    candidates.push({ at, url: buildViewerUrl(args), score, title: title || statement });
  }
  if (!candidates.length) {
    // HTML 변형 중에는 TreeNode 선언과 viewDoc 핸들러가 별도 블록에 배치됩니다.
    // 이때도 요구된 제목의 text 항목 다음, 다음 목차 제목 이전에 있는 viewDoc 호출만 연결합니다.
    const titlePattern = /\b(?:text|title|name|label)\s*:\s*(["'`])([\s\S]*?)\1/gi;
    const titleMarks = [...decoded.matchAll(titlePattern)].map((m) => ({ at: m.index ?? 0, title: (m[2] ?? "").replace(/\\u([0-9a-f]{4})/gi, (_x, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }));
    const allCalls = [...decoded.matchAll(VIEW_DOC_CALL)];
    for (let i = 0; i < titleMarks.length; i++) {
      const mark = titleMarks[i];
      const normalizedTitle = normalizeHeading(mark.title);
      const strippedNumber = normalizedTitle.replace(/^\d+[.]?/, "");
      const genericFinancialSection = /^(?:연결|별도|개별)?재무제표$/.test(strippedNumber);
      const parentFinancialSectionForCashFlow = statement === "CF" && /^(?:\d+[.]?)?연결재무제표$/.test(normalizedTitle);
      if (!requiredStatement[statement].test(normalizedTitle) && !genericFinancialSection && !parentFinancialSectionForCashFlow) continue;
      if ((genericFinancialSection || parentFinancialSectionForCashFlow) && requestedSection === "CFS" && !/연결/.test(normalizedTitle)) continue;
      if ((genericFinancialSection || parentFinancialSectionForCashFlow) && requestedSection === "OFS" && /연결/.test(normalizedTitle)) continue;
      const boundary = titleMarks[i + 1]?.at ?? Math.min(decoded.length, mark.at + 12_000);
      const relevantCalls = allCalls.filter((call) => (call.index ?? -1) > mark.at && (call.index ?? -1) < boundary);
      for (const call of relevantCalls) {
        const [, realRcp, dcmNo, eleId, offset, length, dtdRaw] = call;
        if (realRcp !== rceptNo || !/^\d{4,}$/.test(dcmNo) || !eleId) continue;
        const isConnected = /연결/.test(normalizedTitle);
        const isSeparate = /별도|개별/.test(normalizedTitle);
        if (requestedSection === "CFS" && isSeparate && !isConnected) continue;
        if (requestedSection === "OFS" && isConnected && !isSeparate) continue;
        const args: ViewerDocumentArgs = { rcpNo: realRcp, dcmNo, eleId, offset: /^\d+$/.test(offset) ? offset : "0", length: /^\d+$/.test(length) ? length : "0", dtd: (dtdRaw ?? "").replace(/[\s'"<>]/g, "") || "dart3.xsd" };
        const url = buildViewerUrl(args);
        const exactTitle = requiredStatement[statement].test(normalizedTitle);
        candidates.push({ at: call.index ?? mark.at, url, score: (exactTitle ? 20 : 6) + (isConnected && requestedSection === "CFS" ? 10 : 0) + (isSeparate && requestedSection === "OFS" ? 10 : 0), title: mark.title });
      }
    }
  }
  // 신형 DART main.do는 TOC 노드 속성에 dcmNo/eleId/offset/length/dtd를 직접 담고
  // 별도의 viewDoc 호출을 표지에 둘 수 있습니다. 이 구조에서는 호출과 제목의 거리로 연결하지 않고
  // 동일한 node 객체에서 추출한 문서 인자만 사용합니다.
  const assignedNodes = extractTocNodesFromMainHtml(decoded, rceptNo);
  const assignedSelection = selectBestFinancialStatementNode(assignedNodes, requestedSection, statement);
  if (assignedSelection) {
    return {
      url: buildViewerDoUrl(assignedSelection.node),
      deepLinked: true,
      sectionTitle: assignedSelection.node.text,
      matchType: assignedSelection.matchType,
      note: assignedSelection.matchType === "BASIS_FALLBACK"
        ? `요청한 ${requestedSection === "CFS" ? "연결" : "별도"} 기준 재무제표 목차가 없어 '${assignedSelection.node.text}' 본문으로 이동합니다. 기준이 다를 수 있습니다.`
        : assignedSelection.matchType === "FINANCIAL_SECTION"
          ? "재무제표 세부 목차를 찾지 못해 '재무에 관한 사항' 본문 구간으로 이동합니다. 해당 구간에서 재무제표 표를 확인하세요."
          : "",
    };
  }

  // 일부 공시에서는 TreeNode의 제목과 viewDoc 핸들러가 서로 다른 스크립트 블록에 있습니다.
  // 제목 바로 뒤에 호출이 없어도, 같은 접수번호의 실제 호출 중 가까운 항목만 제한적으로 연결합니다.
  // 표지/공시 첫 화면으로 이동시키는 대체 링크는 만들지 않습니다.
  if (!candidates.length) {
    const allCalls = [...decoded.matchAll(VIEW_DOC_CALL)].filter((call) => call[1] === rceptNo && /^\d{4,}$/.test(call[2] ?? "") && Boolean(call[3]));
    const titlePattern = /\b(?:text|title|name|label)\s*:\s*(["'`])([\s\S]*?)\1/gi;
    const titleMarks = [...decoded.matchAll(titlePattern)].map((m) => ({ at: m.index ?? 0, title: (m[2] ?? "").replace(/\\u([0-9a-f]{4})/gi, (_x, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }));
    for (const mark of titleMarks) {
      const normalizedTitle = normalizeHeading(mark.title);
      const strippedNumber = normalizedTitle.replace(/^\d+[.]?/, "");
      const genericFinancialSection = /^(?:연결|별도|개별)?재무제표$/.test(strippedNumber);
      if (!requiredStatement[statement].test(normalizedTitle) && !genericFinancialSection) continue;
      const isConnected = /연결/.test(normalizedTitle);
      const isSeparate = /별도|개별/.test(normalizedTitle);
      if (requestedSection === "CFS" && isSeparate && !isConnected) continue;
      if (requestedSection === "OFS" && isConnected && !isSeparate) continue;
      if (genericFinancialSection && requestedSection === "CFS" && !isConnected) continue;
      if (genericFinancialSection && requestedSection === "OFS" && isConnected) continue;
      const nearest = allCalls.map((call) => ({ call, distance: Math.abs((call.index ?? 0) - mark.at) }))
        .filter((item) => item.distance <= 25_000)
        .sort((a, b) => a.distance - b.distance)[0];
      if (!nearest) continue;
      const [, realRcp, dcmNo, eleId, offset, length, dtdRaw] = nearest.call;
      const args: ViewerDocumentArgs = { rcpNo: realRcp, dcmNo, eleId, offset: /^\d+$/.test(offset) ? offset : "0", length: /^\d+$/.test(length) ? length : "0", dtd: (dtdRaw ?? "").replace(/[\s'"<>]/g, "") || "dart3.xsd" };
      candidates.push({ at: nearest.call.index ?? mark.at, url: buildViewerUrl(args), score: (requiredStatement[statement].test(normalizedTitle) ? 18 : 5) + (isConnected && requestedSection === "CFS" ? 8 : 0) + (isSeparate && requestedSection === "OFS" ? 8 : 0), title: mark.title });
    }
  }
  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score || a.at - b.at);
    return { url: candidates[0].url, deepLinked: true, sectionTitle: candidates[0].title };
  }
  return { url: "", deepLinked: false, sectionTitle: "", message: "DART 목차에서 요청한 재무제표의 실제 dcmNo·eleId를 찾지 못했습니다. 관련 없는 목차나 표지 링크로 대체하지 않았습니다." };
}
