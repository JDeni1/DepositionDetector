import type { Candidate, ContradictionType, Finding, Statement, StatementView } from "../../shared/types";
import { classify, gatherEvidence } from "./classify";
import { scoreConfidence } from "./confidence";
import { analyzeLanguage, formatMinutes, verifyQuote } from "./normalize";

const TYPE_ORDER: Record<ContradictionType, number> = { DIRECT: 0, INFERENTIAL: 1, FALSE_POSITIVE: 2 };

/** Runs every candidate through the rules and the confidence formula. */
export function analyzeCandidates(candidates: Candidate[], transcriptA: string, transcriptB: string): Finding[] {
  const findings = candidates.map((c) => {
    const evidence = gatherEvidence(c, transcriptA, transcriptB);
    const { type, severity, rules, gateFired } = classify(c, evidence);
    const { confidence, factors } = scoreConfidence(c, evidence, gateFired);

    return {
      id: c.id,
      topic: c.topic,
      summary: c.summary,
      type,
      severity,
      confidence,
      rules,
      factors,
      a: toView(c.a, transcriptA),
      b: toView(c.b, transcriptB),
      modelNote: c.note,
      modelProposedType: c.proposedType,
    };
  });

  // Real contradictions first, strongest first.
  return findings.sort((x, y) => TYPE_ORDER[x.type] - TYPE_ORDER[y.type] || y.confidence - x.confidence);
}

function toView(s: Statement, transcript: string): StatementView {
  return {
    ...s,
    quoteMatch: verifyQuote(s.quote, transcript),
    timeLabel: s.time
      ? s.time.earliest === s.time.latest
        ? formatMinutes(s.time.earliest)
        : `${formatMinutes(s.time.earliest)} to ${formatMinutes(s.time.latest)}`
      : null,
    signals: analyzeLanguage(s.quote),
  };
}
