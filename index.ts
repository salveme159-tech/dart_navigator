import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { timingSafeEqual } from "node:crypto";
import { askDart } from "../dart/client";

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Cross-origin access is opt-in: list exact frontend origins in CORS_ALLOWED_ORIGINS.
  // Do not use wildcard origins with credentialed browser requests.
  const allowedOrigins = new Set(
    (process.env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
  app.use((req, res, next) => {
    const origin = req.header("origin");
    if (origin && allowedOrigins.has(origin.replace(/\/$/, ""))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-OpenDART-Key");
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });
  // Live disclosure responses must not be retained by browser or intermediary caches.
  app.use("/api/trpc", (_req, res, next) => { res.set("Cache-Control", "private, no-store, max-age=0"); res.set("Pragma", "no-cache"); next(); });
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  // Market-data endpoints keep all provider credentials on the server.
  const marketCache = new Map<string, { at: number; value: unknown }>();
  app.get("/api/market/status", (_req, res) => {
    res.set("Cache-Control", "no-store").json({
      dartConfigured: /^[A-Za-z0-9]{40}$/.test((process.env.OPENDART_API_KEY ?? "").trim()),
      ecosConfigured: Boolean((process.env.ECOS_API_KEY ?? "").trim()),
      exchangeConfigured: Boolean((process.env.EXIM_EXCHANGE_API_KEY ?? "").trim()),
      copperSource: "https://www.nonferrous.or.kr/stats/?act=sub3",
      copperMethod: "public-page-scrape",
    });
  });
  app.get("/api/market/ecos", async (req, res) => {
    const apiKey = (process.env.ECOS_API_KEY ?? "").trim();
    if (!apiKey) return res.status(503).json({ error: "ECOS_API_KEY가 설정되지 않았습니다." });
    const statCode = String(req.query.statCode ?? "").trim();
    const itemCode = String(req.query.itemCode ?? "").trim();
    const cycle = String(req.query.cycle ?? "M").trim().toUpperCase();
    const start = String(req.query.start ?? "").trim();
    const end = String(req.query.end ?? "").trim();
    if (!/^[A-Za-z0-9]{1,30}$/.test(statCode) || !/^[A-Za-z0-9]{1,30}$/.test(itemCode) || !["D", "M", "Q", "A"].includes(cycle) || !/^\d{4}(?:\d{2})?$/.test(start) || !/^\d{4}(?:\d{2})?$/.test(end)) {
      return res.status(400).json({ error: "statCode, itemCode, cycle(D/M/Q/A), start, end를 올바르게 입력하세요. 통계표·항목 코드는 ECOS 통계표 검색에서 확인해야 합니다." });
    }
    const cacheKey = `ecos:${statCode}:${itemCode}:${cycle}:${start}:${end}`;
    const cached = marketCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 30 * 60_000) return res.json(cached.value);
    try {
      const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(apiKey)}/json/kr/1/1000/${encodeURIComponent(statCode)}/${cycle}/${start}/${end}/${encodeURIComponent(itemCode)}`;
      const upstream = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!upstream.ok) return res.status(502).json({ error: `ECOS 응답 오류: HTTP ${upstream.status}` });
      const data = await upstream.json() as any;
      if (data?.RESULT) return res.status(502).json({ error: `ECOS ${data.RESULT.CODE}: ${data.RESULT.MESSAGE}` });
      const body = data?.StatisticSearch;
      const value = { source: "한국은행 ECOS", statCode, itemCode, cycle, start, end, list: body?.row ?? [], totalCount: Number(body?.list_total_count ?? 0), message: body?.row?.length ? "조회 성공" : "조회 결과가 없습니다. 통계표·항목 코드와 기간을 확인하세요." };
      marketCache.set(cacheKey, { at: Date.now(), value });
      return res.json(value);
    } catch (error) {
      console.error("[Market API] ECOS request failed:", error);
      return res.status(502).json({ error: "ECOS 연결에 실패했습니다. 인증키와 통계 코드, 네트워크를 확인하세요." });
    }
  });
  app.get("/api/market/exchange", async (req, res) => {
    const apiKey = (process.env.EXIM_EXCHANGE_API_KEY ?? "").trim();
    if (!apiKey) return res.status(503).json({ error: "EXIM_EXCHANGE_API_KEY가 설정되지 않았습니다." });
    const date = String(req.query.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, ""));
    if (!/^\d{8}$/.test(date)) return res.status(400).json({ error: "date는 YYYYMMDD 형식이어야 합니다." });
    const cacheKey = `exchange:${date}`;
    const cached = marketCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 60 * 60_000) return res.json(cached.value);
    try {
      const url = new URL("https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON");
      url.searchParams.set("authkey", apiKey);
      url.searchParams.set("searchdate", date);
      url.searchParams.set("data", "AP01");
      const upstream = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!upstream.ok) return res.status(502).json({ error: `환율 API 응답 오류: HTTP ${upstream.status}` });
      const rows = await upstream.json() as unknown;
      if (!Array.isArray(rows)) return res.status(502).json({ error: "환율 API 응답 형식이 예상과 다릅니다." });
      const value = { source: "한국수출입은행 환율 API", date, list: rows };
      marketCache.set(cacheKey, { at: Date.now(), value });
      return res.json(value);
    } catch (error) {
      console.error("[Market API] exchange request failed:", error);
      return res.status(502).json({ error: "환율 API 연결에 실패했습니다. 인증키, 이용 승인 및 네트워크를 확인하세요." });
    }
  });
  app.get("/api/market/copper", async (_req, res) => {
    const cacheKey = "copper:nonferrous";
    const cached = marketCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 15 * 60_000) return res.json(cached.value);
    const source = "https://www.nonferrous.or.kr/stats/?act=sub3";
    try {
      const upstream = await fetch(source, { headers: { "User-Agent": "DART-Navigator/1.0 (public statistics reader)", Accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(12000) });
      if (!upstream.ok) return res.status(502).json({ error: `한국비철금속협회 페이지 응답 오류: HTTP ${upstream.status}`, source });
      const html = await upstream.text();
      const decode = (text: string) => text.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).trim();
      const strip = (text: string) => decode(text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
      const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(match => {
        const rows = [...match[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => strip(cell[1]))).filter(row => row.length);
        return rows.filter(row => row.some(cell => cell));
      }).filter(table => table.length);
      const relevant = tables.filter(table => table.some(row => row.some(cell => /구리|동\b|전기동|가격|일자|날짜|평균|LME/i.test(cell))));
      const value = { source, fetchedAt: new Date().toISOString(), parsed: relevant.length > 0, tables: relevant.slice(0, 5), message: relevant.length ? "공개 페이지의 표를 읽었습니다. 단위·기준일을 확인한 뒤 분석에 사용하세요." : "페이지에서 정적 HTML 표를 찾지 못했습니다. 사이트가 스크립트로 표를 렌더링하거나 구조를 변경했을 수 있습니다. 이 경우 수집 방식을 별도로 조정해야 하며, 임의 가격은 사용하지 않습니다." };
      marketCache.set(cacheKey, { at: Date.now(), value });
      return res.json(value);
    } catch (error) {
      console.error("[Market API] copper scrape failed:", error);
      return res.status(502).json({ error: "한국비철금속협회 통계 페이지를 읽지 못했습니다. 사이트 접근 정책, 네트워크, 페이지 구조를 확인하세요.", source });
    }
  });

  // Readiness endpoint for deployment checks. It exposes configuration status only, never secrets.
  app.get("/api/agent/health", (_req, res) => {
    const agentKeyConfigured = (process.env.AGENT_API_KEY ?? "").trim().length >= 32;
    const openDartKeyConfigured = /^[A-Za-z0-9]{40}$/.test((process.env.OPENDART_API_KEY ?? "").trim());
    const ready = agentKeyConfigured && openDartKeyConfigured;
    res.status(ready ? 200 : 503).set("Cache-Control", "no-store").json({
      status: ready ? "ready" : "configuration_required",
      endpoint: "/api/agent/query",
      agentKeyConfigured,
      openDartKeyConfigured,
      message: ready
        ? "ChatGPT Action API 설정이 완료되었습니다. 인증 헤더를 사용해 질문을 테스트하세요."
        : "서버 환경변수 AGENT_API_KEY(32자 이상)와 OPENDART_API_KEY(영문·숫자 40자리)를 확인하세요.",
    });
  });

  // Stable REST surface for a ChatGPT GPT Action. It uses the server's OpenDART key,
  // never accepts an OpenDART key in the request body, and requires its own bearer secret.
  app.post("/api/agent/query", async (req, res) => {
    const expected = (process.env.AGENT_API_KEY ?? "").trim();
    if (expected.length < 32) {
      return res.status(503).json({ found: false, message: "Agent API가 설정되지 않았습니다. 32자 이상의 무작위 AGENT_API_KEY를 서버 환경변수에 설정하세요." });
    }
    const authorization = req.header("authorization") ?? "";
    const supplied = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
    const expectedBytes = Buffer.from(expected);
    const suppliedBytes = Buffer.from(supplied);
    const authorized = expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
    if (!authorized) {
      return res.status(401).json({ found: false, message: "인증되지 않은 Agent API 요청입니다." });
    }

    const question = req.body?.question;
    if (typeof question !== "string" || question.trim().length < 2 || question.trim().length > 300) {
      return res.status(400).json({ found: false, message: "question은 2~300자 문자열이어야 합니다." });
    }

    if (!/^[A-Za-z0-9]{40}$/.test((process.env.OPENDART_API_KEY ?? "").trim())) {
      return res.status(503).json({ found: false, message: "Agent API 조회용 서버 환경변수 OPENDART_API_KEY가 올바르게 설정되지 않았습니다." });
    }

    try {
      return res.json(await askDart(question.trim(), process.env.OPENDART_API_KEY?.trim()));
    } catch (error) {
      console.error("[Agent API] OpenDART query failed:", error);
      return res.status(502).json({ found: false, message: "OpenDART 조회 중 오류가 발생했습니다. API 키, 서버 연결, 기업·보고기간을 확인하세요." });
    }
  });

  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => { console.error(error); process.exit(1); });
