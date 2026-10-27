import { factCheckArticle } from "./dart/articleFactCheck";
import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { askDart, buildDartSectionDeepLink, clearDartCaches, compareDart, historyDart, searchDartCompanies, snapshotDart, validateDartKey, recentFilingsDart } from "./dart/client";
import { METRIC_LABELS, type FinancialMetric, type Kind } from "./dart/engine";
import { COOKIE_NAME } from "@shared/const";

const metricEnum = z.enum(["revenue", "operatingProfit", "netIncome", "operatingMargin", "netMargin", "operatingCashFlow", "investmentCashFlow", "financingCashFlow", "capex", "freeCashFlow", "netDebt", "borrowings", "borrowingsRatio", "workingCapital", "payables", "debtRatio", "currentRatio", "interestCoverage", "roe", "roa", "eps", "ebitda", "per", "pbr"] satisfies [FinancialMetric, ...FinancialMetric[]]);
const periodEnum = z.enum(["latest", "annual", "half", "q1", "q3", "h2"] satisfies [Kind | "latest" | "h2", ...(Kind | "latest" | "h2")[]]);

// In production, never let anonymous public tRPC calls consume a server-owned DART key.
// Browser callers must send their own 40-character key; GPT Actions use /api/agent/query.
function requireDartKey(ctx: { req: { header: (name: string) => string | undefined } }) {
  const requestKey = ctx.req.header("x-opendart-key")?.trim();
  if (process.env.NODE_ENV === "production" && (!requestKey || !/^[A-Za-z0-9]{40}$/.test(requestKey) || /^(DEMO|VERIFIED)/i.test(requestKey))) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "실시간 DART 조회에는 본인이 발급받은 40자리 인증키가 필요합니다." });
  }
  return requestKey;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  dart: router({
    articleFactCheck: publicProcedure.input(z.object({
      article:z.string().min(10).max(30000), company:z.string().min(2).max(100),
      year:z.number().int().min(2015).max(2100), period:z.enum(["annual","half","q1","q3"]),
      mode:z.enum(["cum","qtr"]), basis:z.enum(["CFS","OFS"]),
      articleDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value,"올바른 기사 기준일을 입력하세요."),
      contractReceipt:z.string().regex(/^\d{14}$/).optional(),
    })).mutation(({input,ctx})=>factCheckArticle(input,requireDartKey(ctx))),
    validateKey: publicProcedure.query(({ ctx }) => validateDartKey(ctx.req.header("x-opendart-key"))),
    deepLink: publicProcedure.input(z.object({ rceptNo: z.string().regex(/^\d{14}$/), basis: z.enum(["CFS", "OFS"]), statement: z.enum(["BS", "IS", "CF"]).optional() })).query(({ input, ctx }) => buildDartSectionDeepLink(input.rceptNo, input.basis, requireDartKey(ctx), input.statement ?? "BS")),
    ask: publicProcedure.input(z.object({ question: z.string().min(2).max(300) })).query(({ input, ctx }) => askDart(input.question, requireDartKey(ctx))),
    searchCompanies: publicProcedure.input(z.object({ query: z.string().min(1).max(80), limit: z.number().min(1).max(20).optional() })).query(({ input, ctx }) => searchDartCompanies(input.query, input.limit ?? 12, requireDartKey(ctx))),
    recentFilings: publicProcedure.input(z.object({ companies: z.array(z.string().min(1).max(100)).min(1).max(20), fromDate: z.string().regex(/^\d{8}$/) })).query(({ input, ctx }) => recentFilingsDart(input.companies, input.fromDate, requireDartKey(ctx))),
    snapshot: publicProcedure.input(z.object({ company: z.string().min(2).max(100), force: z.boolean().optional(), includeHistory: z.boolean().optional(), basis: z.enum(["CFS", "OFS"]).optional() })).query(({ input, ctx }) => snapshotDart(input.company, Boolean(input.force), requireDartKey(ctx), input.includeHistory === true, input.basis ?? "CFS")),
    history: publicProcedure.input(z.object({ company: z.string().min(2).max(100) })).query(({ input, ctx }) => historyDart(input.company, requireDartKey(ctx))),
    compare: publicProcedure.input(z.object({
      companies: z.array(z.string().min(2).max(100)).min(2).max(8),
      metric: metricEnum,
      year: z.number().int().min(2000).max(2100).optional(),
      period: periodEnum,
      basis: z.enum(["CFS", "OFS"]),
      force: z.boolean().optional(),
    })).query(({ input, ctx }) => compareDart(input, requireDartKey(ctx))),
    refresh: publicProcedure.mutation(() => clearDartCaches()),
    metricLabels: publicProcedure.query(() => METRIC_LABELS),
  }),
});

export type AppRouter = typeof appRouter;
