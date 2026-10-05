import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { askDart, clearDartCaches, compareDart, searchDartCompanies, snapshotDart } from "./dart/client";
import { METRIC_LABELS, type FinancialMetric, type Kind } from "./dart/engine";
import { COOKIE_NAME } from "@shared/const";

const metricEnum = z.enum(["revenue", "operatingProfit", "netIncome", "operatingMargin", "operatingCashFlow", "investmentCashFlow", "financingCashFlow", "capex", "netDebt", "debtRatio", "currentRatio", "interestCoverage", "roe", "roa", "eps", "ebitda", "per", "pbr"] satisfies [FinancialMetric, ...FinancialMetric[]]);
const periodEnum = z.enum(["latest", "annual", "half", "q1", "q3"] satisfies [Kind | "latest", ...(Kind | "latest")[]]);

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
    ask: publicProcedure.input(z.object({ question: z.string().min(2).max(300) })).query(({ input }) => askDart(input.question)),
    searchCompanies: publicProcedure.input(z.object({ query: z.string().min(1).max(80), limit: z.number().min(1).max(20).optional() })).query(({ input }) => searchDartCompanies(input.query, input.limit ?? 12)),
    snapshot: publicProcedure.input(z.object({ company: z.string().min(2).max(100), force: z.boolean().optional() })).query(({ input }) => snapshotDart(input.company, Boolean(input.force))),
    compare: publicProcedure.input(z.object({
      companies: z.array(z.string().min(2).max(100)).min(2).max(8),
      metric: metricEnum,
      year: z.number().int().min(2000).max(2100).optional(),
      period: periodEnum,
      basis: z.enum(["CFS", "OFS"]),
      force: z.boolean().optional(),
    })).query(({ input }) => compareDart(input)),
    refresh: publicProcedure.mutation(() => clearDartCaches()),
    metricLabels: publicProcedure.query(() => METRIC_LABELS),
  }),
});

export type AppRouter = typeof appRouter;
