import type { Principal } from "@/modules/identity";
import { operationalLocalDate } from "@/modules/ordering/calendar/domain";
import { readOperationalPurchaseCalendar } from "@/modules/ordering/calendar/service";
import { appliedSellingPrice } from "../financial";
import { buildPricingAnalysis } from "./domain";
import { persistPricingReview, readPricingAnalysisSources, readPricingReviewDecisions } from "./repository";

async function pricingOperationalDate(now: Date) {
  const calendar = await readOperationalPurchaseCalendar();
  return operationalLocalDate(now, calendar.timezone);
}

export async function loadPricingAnalyses(principal: Principal, now = new Date()) {
  const operationalDate = await pricingOperationalDate(now);
  return (await readPricingAnalysisSources(principal, operationalDate)).map(buildPricingAnalysis);
}

export async function loadPricingAnalysis(principal: Principal, productId: string, now = new Date()) {
  return (await loadPricingAnalyses(principal, now)).find((analysis) => analysis.id === productId) ?? null;
}

export async function reviewPricingProduct(
  principal: Principal,
  input: { productId: string; expectedFingerprint: string; decidedPrice: string },
  now = new Date(),
) {
  return persistPricingReview(principal, {
    ...input,
    decidedPrice: appliedSellingPrice(input.decidedPrice),
    operationalDate: await pricingOperationalDate(now),
  });
}

export async function loadPricingReviewDecisions(principal: Principal, ids: string[]) {
  return readPricingReviewDecisions(principal, ids);
}
