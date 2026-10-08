import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { askDart, calculateMetric, compareDart, getDartEvidence, searchDartCompanies, snapshotDart, validateDartApiKey, withDartApiKey } from "./dart/client";
import { METRIC_LABELS, type FinancialMetric, type Kind } from "./dart/engine";

const metricEnum = z.enum(["revenue", "operatingProfit", "netIncome", "operatingMargin", "operatingCashFlow", "investmentCashFlow", "financingCashFlow", "capex", "freeCashFlow", "netWorkingCapital", "assetTurnover", "netDebt", "debtRatio", "currentRatio", "interestCoverage", "roe", "roa", "eps", "ebitda", "per", "pbr"] satisfies [FinancialMetric, ...FinancialMetric[]]);
const periodEnum = z.enum(["latest", "annual", "half", "q1", "q3"] satisfies [Kind | "latest", ...(Kind | "latest")[]]);

export const appRouter = router({
  dart: router({
    ask: publicProcedure.input(z.object({ question: z.string().min(2).max(300) })).query(({ input, ctx }) =>
      withDartApiKey(ctx.req.header("x-opendart-key") ?? null, () => askDart(input.question))),
    calculateMetric: publicProcedure.input(z.object({
      company: z.string().min(2).max(100),
      year: z.number().int().min(2015).max(2100),
      period: z.enum(["annual", "half", "q1", "q3"]),
      basis: z.enum(["CFS", "OFS"]),
      metric: metricEnum,
    })).query(({ input, ctx }) =>
      withDartApiKey(ctx.req.header("x-opendart-key") ?? null, () => calculateMetric(input))),
    validateKey: publicProcedure.query(({ ctx }) =>
      withDartApiKey(ctx.req.header("x-opendart-key") ?? null, () => validateDartApiKey())),
    evidence: publicProcedure.input(z.object({ rceptNo: z.string().regex(/^\d{14}$/), heading: z.string().max(200).optional() })).query(({ input }) => getDartEvidence(input.rceptNo, input.heading ?? "재무제표")),
    searchCompanies: publicProcedure.input(z.object({ query: z.string().min(1).max(80), limit: z.number().min(1).max(20).optional() })).query(({ input, ctx }) =>
      withDartApiKey(ctx.req.header("x-opendart-key") ?? null, () => searchDartCompanies(input.query, input.limit ?? 12))),
    snapshot: publicProcedure.input(z.object({ company: z.string().min(2).max(100), force: z.boolean().optional() })).query(({ input, ctx }) =>
      withDartApiKey(ctx.req.header("x-opendart-key") ?? null, () => snapshotDart(input.company, Boolean(input.force)))),
    compare: publicProcedure.input(z.object({
      companies: z.array(z.string().min(2).max(100)).min(2).max(8),
      metric: metricEnum,
      year: z.number().int().min(2000).max(2100).optional(),
      period: periodEnum,
      basis: z.enum(["CFS", "OFS"]),
      force: z.boolean().optional(),
    })).query(({ input, ctx }) =>
      withDartApiKey(ctx.req.header("x-opendart-key") ?? null, () => compareDart(input))),
    refresh: publicProcedure.input(z.object({ company: z.string().min(2).max(100) })).mutation(({ input, ctx }) => withDartApiKey(ctx.req.header("x-opendart-key") ?? null, () => snapshotDart(input.company, true))),
    metricLabels: publicProcedure.query(() => METRIC_LABELS),
  }),
});

export type AppRouter = typeof appRouter;
