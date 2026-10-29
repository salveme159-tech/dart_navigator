import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { askDart, buildDartSectionDeepLink, clearDartCaches, compareDart, historyDart, searchDartCompanies, snapshotDart, validateDartKey, recentFilingsDart, type ComparisonMetric } from "./dart/client";
import { EXTRA_COMPARISON_METRIC_IDS } from "@shared/comparisonMetrics";
import { METRIC_LABELS, type FinancialMetric, type Kind } from "./dart/engine";
import { COOKIE_NAME } from "@shared/const";

const metricEnum = z.enum([...Object.keys(METRIC_LABELS), ...EXTRA_COMPARISON_METRIC_IDS] as [ComparisonMetric, ...ComparisonMetric[]]);
const periodEnum = z.enum(["latest", "annual", "half", "q1", "q3"] satisfies [Kind | "latest", ...(Kind | "latest")[]]);

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
    validateKey: publicProcedure.query(({ ctx }) => validateDartKey(ctx.req.header("x-opendart-key"))),
    deepLink: publicProcedure.input(z.object({ rceptNo: z.string().regex(/^\d{14}$/), basis: z.enum(["CFS", "OFS"]), statement: z.enum(["BS", "IS", "CF"]).optional() })).query(({ input, ctx }) => buildDartSectionDeepLink(input.rceptNo, input.basis, requireDartKey(ctx), input.statement ?? "BS")),
    ask: publicProcedure.input(z.object({ question: z.string().min(2).max(300) })).query(({ input, ctx }) => askDart(input.question, requireDartKey(ctx))),
    searchCompanies: publicProcedure.input(z.object({ query: z.string().min(1).max(80), limit: z.number().min(1).max(20).optional() })).query(({ input, ctx }) => searchDartCompanies(input.query, input.limit ?? 12, requireDartKey(ctx))),
    recentFilings: publicProcedure.input(z.object({ companies: z.array(z.string().min(1).max(100)).min(1).max(20), fromDate: z.string().regex(/^\d{8}$/) })).query(({ input, ctx }) => recentFilingsDart(input.companies, input.fromDate, requireDartKey(ctx))),
    snapshot: publicProcedure.input(z.object({ company: z.string().min(2).max(100), force: z.boolean().optional(), includeHistory: z.boolean().optional(), basis: z.enum(["CFS", "OFS"]).optional() })).query(({ input, ctx }) => snapshotDart(input.company, Boolean(input.force), requireDartKey(ctx), input.includeHistory === true, input.basis ?? "CFS")),
    history: publicProcedure.input(z.object({ company: z.string().min(2).max(100), basis:z.enum(["CFS","OFS"]).default("CFS"), startYear:z.number().int().min(2015).max(2100).optional(), endYear:z.number().int().min(2015).max(2100).optional() })).query(({ input, ctx }) => historyDart(input.company, requireDartKey(ctx),input.basis,input.startYear,input.endYear)),
    compare: publicProcedure.input(z.object({
      companies: z.array(z.string().min(2).max(100)).min(1).max(10),
      metric: metricEnum,
      year: z.number().int().min(2015).max(2100).optional(),
      period: periodEnum,
      basis: z.enum(["CFS", "OFS"]),
      force: z.boolean().optional(),
      includeValidation: z.boolean().optional(),
    })).query(({ input, ctx }) => compareDart(input, requireDartKey(ctx))),
    refresh: publicProcedure.mutation(() => clearDartCaches()),
    metricLabels: publicProcedure.query(() => METRIC_LABELS),
  }),
});

export type AppRouter = typeof appRouter;
