import type { Candidate, ConfidenceFactor, QuoteMatch } from "../../shared/types";
import type { Evidence } from "./classify";

/**
 * Confidence = how likely a finding is to be a real contradiction, from 0 to 1.
 * It is computed only from evidence our code measured. Claude is never asked
 * for a confidence number. Each factor is kept so the UI can show the breakdown.
 */

export const BASE_SCORE = 0.5;
export const MIN_SCORE = 0.01;
export const MAX_SCORE = 0.99;

const QUOTE_POINTS: Record<QuoteMatch, number> = {
  exact: 0.1,
  normalized: 0.05,
  missing: -0.25,
};

const HEDGE_PENALTY = -0.08;
const ABSOLUTE_BONUS = 0.05;
const OPPOSITE_POLARITY_BONUS = 0.1;
const GATE_PENALTY = -0.35;
const DIFFERENT_TIME_FRAME_PENALTY = -0.3;

export function scoreConfidence(
  c: Candidate,
  e: Evidence,
  gateFired: boolean,
): { confidence: number; factors: ConfidenceFactor[] } {
  const factors: ConfidenceFactor[] = [{ label: "Starting score", effect: BASE_SCORE }];

  // 1. Is the evidence real? Checked against the transcript.
  factors.push({ label: `Quote A ${describeMatch(e.quoteMatchA)}`, effect: QUOTE_POINTS[e.quoteMatchA] });
  factors.push({ label: `Quote B ${describeMatch(e.quoteMatchB)}`, effect: QUOTE_POINTS[e.quoteMatchB] });

  // 2. How sure did the witness sound? Read from the witness's own words.
  for (const [side, signals] of [["A", e.signalsA], ["B", e.signalsB]] as const) {
    if (signals.uncertain.length > 0) {
      factors.push({ label: `Quote ${side} is hedged ("${signals.uncertain.join('", "')}")`, effect: HEDGE_PENALTY });
    }
    if (signals.absolute.length > 0) {
      factors.push({ label: `Quote ${side} is absolute ("${signals.absolute.join('", "')}")`, effect: ABSOLUTE_BONUS });
    }
  }

  // 3. How far apart are the times, compared with the tolerance?
  if (c.conflictKind === "time" && e.gapMinutes !== null) {
    const margin = e.gapMinutes - e.toleranceMinutes;
    if (margin > 0) {
      factors.push({
        label: `Times differ by ${e.gapMinutes} min, ${margin} min beyond tolerance`,
        effect: Math.min(0.2, round(margin / 300)),
      });
    } else {
      factors.push({ label: `Time gap (${e.gapMinutes} min) is within tolerance`, effect: -0.2 });
    }
  }

  // 4. Does one statement flatly deny the other?
  if (e.oppositePolarity) {
    factors.push({ label: "One statement affirms what the other denies", effect: OPPOSITE_POLARITY_BONUS });
  }

  // 5. Are both statements about the same thing?
  if (e.subjectSimilarity >= 0.8) {
    factors.push({ label: "Both statements are about the same subject", effect: 0.05 });
  } else if (e.subjectSimilarity >= 0.4) {
    factors.push({
      label: `Subjects only partly match (${Math.round(e.subjectSimilarity * 100)}% shared words)`,
      effect: -0.2,
    });
  } else {
    factors.push({ label: "Statements are about different subjects", effect: -0.35 });
  }

  // 6. Penalties that come from the rules.
  if (!c.sameTimeFrame) {
    factors.push({ label: "Statements describe different time periods", effect: DIFFERENT_TIME_FRAME_PENALTY });
  }
  if (gateFired) {
    factors.push({ label: "A false-positive rule fired", effect: GATE_PENALTY });
  }

  const raw = factors.reduce((sum, f) => sum + f.effect, 0);
  const confidence = round(Math.min(MAX_SCORE, Math.max(MIN_SCORE, raw)));
  return { confidence, factors };
}

function describeMatch(match: QuoteMatch): string {
  if (match === "exact") return "found word for word";
  if (match === "normalized") return "found after ignoring case and spacing";
  return "not found in transcript";
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
