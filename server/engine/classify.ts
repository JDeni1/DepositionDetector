import type {
  Candidate,
  ContradictionType,
  LanguageSignals,
  QuoteMatch,
  RuleHit,
  Severity,
  Topic,
} from "../../shared/types";
import { analyzeLanguage, formatMinutes, subjectSimilarity, timeGap, timeTolerance, verifyQuote } from "./normalize";

/**
 * Everything the rules look at, measured by our own code.
 * Claude supplies the candidate; nothing here is Claude's opinion.
 */
export interface Evidence {
  quoteMatchA: QuoteMatch;
  quoteMatchB: QuoteMatch;
  signalsA: LanguageSignals;
  signalsB: LanguageSignals;
  gapMinutes: number | null;      // null unless both statements have a time
  toleranceMinutes: number;
  subjectSimilarity: number;      // 0 to 1
  oppositePolarity: boolean;
}

export interface Classification {
  type: ContradictionType;
  severity: Severity;
  rules: RuleHit[];
  gateFired: boolean; // true if a G rule turned this into a false positive
}

/** Thresholds, named so they are easy to find, test and explain. */
export const SAME_SUBJECT_THRESHOLD = 0.5;

export function gatherEvidence(c: Candidate, transcriptA: string, transcriptB: string): Evidence {
  const signalsA = analyzeLanguage(c.a.quote);
  const signalsB = analyzeLanguage(c.b.quote);
  return {
    quoteMatchA: verifyQuote(c.a.quote, transcriptA),
    quoteMatchB: verifyQuote(c.b.quote, transcriptB),
    signalsA,
    signalsB,
    gapMinutes: c.a.time && c.b.time ? timeGap(c.a.time, c.b.time) : null,
    toleranceMinutes: timeTolerance(signalsA, signalsB),
    subjectSimilarity: subjectSimilarity(c.a.subject, c.b.subject),
    oppositePolarity: c.a.polarity !== c.b.polarity,
  };
}

// ---------- Severity rule (S1): materiality of the topic ----------

export const SEVERITY_BY_TOPIC: Record<Topic, Severity> = {
  whereabouts: "HIGH",   // the alibi itself
  companions: "HIGH",    // who can confirm the alibi
  place_visited: "HIGH", // ties the witness to a scene
  relationship: "HIGH",  // ties the witness to a person
  activity: "MEDIUM",
  vehicle: "MEDIUM",
  sleep: "LOW",
  other: "LOW",
};

/**
 * The rules, in order. The first G (gate) rule that fires makes the pair a
 * FALSE_POSITIVE. If none fires, the first T (type) rule that fires sets the type.
 * Every decision is recorded as a RuleHit, so the UI can show why.
 */
export function classify(c: Candidate, e: Evidence): Classification {
  const severity = SEVERITY_BY_TOPIC[c.topic];
  const severityRule: RuleHit = {
    id: "S1",
    name: "SEVERITY_BY_TOPIC",
    detail: `Topic "${c.topic}" is rated ${severity}.`,
  };

  const gate = firstGate(c, e);
  if (gate) {
    return { type: "FALSE_POSITIVE", severity, rules: [gate, severityRule], gateFired: true };
  }

  const typeRule = decideType(c, e);
  return { type: typeRule.type, severity, rules: [typeRule.hit, severityRule], gateFired: false };
}

// ---------- G rules: reasons a candidate is NOT a real contradiction ----------

function firstGate(c: Candidate, e: Evidence): RuleHit | null {
  // G1: evidence we can't find in the transcript can't be shown to a lawyer.
  if (e.quoteMatchA === "missing" || e.quoteMatchB === "missing") {
    const side = e.quoteMatchA === "missing" ? "A" : "B";
    return {
      id: "G1",
      name: "QUOTE_NOT_FOUND",
      detail: `The quote for transcript ${side} does not appear in that transcript, so it may be invented.`,
    };
  }

  // G2: statements about different periods can both be true.
  if (!c.sameTimeFrame) {
    return {
      id: "G2",
      name: "DIFFERENT_TIME_FRAME",
      detail: "The two statements describe different moments or periods, so both can be true.",
    };
  }

  // G3: a time difference inside the tolerance is imprecise language, not a lie.
  if (c.conflictKind === "time" && e.gapMinutes !== null && e.gapMinutes <= e.toleranceMinutes) {
    return {
      id: "G3",
      name: "TIME_WITHIN_TOLERANCE",
      detail: `The times are ${e.gapMinutes} min apart, within the ${e.toleranceMinutes}-min tolerance.`,
    };
  }

  // G4: if Claude itself only offers it as a likely false positive, we agree.
  if (c.proposedType === "FALSE_POSITIVE") {
    return {
      id: "G4",
      name: "PROPOSED_AS_FALSE_POSITIVE",
      detail: "The extraction step flagged this pair as likely harmless; no rule promotes it.",
    };
  }

  return null;
}

// ---------- T rules: which kind of real contradiction ----------

function decideType(c: Candidate, e: Evidence): { type: ContradictionType; hit: RuleHit } {
  // T1b: an absolute claim ("all night", "never") broken by a specific exception.
  const absoluteA = e.signalsA.absolute.length > 0;
  const absoluteB = e.signalsB.absolute.length > 0;
  if (c.conflictKind === "fact" && absoluteA !== absoluteB && e.subjectSimilarity >= SAME_SUBJECT_THRESHOLD) {
    const words = absoluteA ? e.signalsA.absolute : e.signalsB.absolute;
    return {
      type: "DIRECT",
      hit: {
        id: "T1b",
        name: "ABSOLUTE_CLAIM_BROKEN",
        detail: `One statement is absolute ("${words.join('", "')}") and the other describes an exception.`,
      },
    };
  }

  // T2: two times that can't both be true, beyond the tolerance.
  if (c.conflictKind === "time" && e.gapMinutes !== null && c.a.time && c.b.time) {
    return {
      type: "INFERENTIAL",
      hit: {
        id: "T2",
        name: "TIME_CONFLICT",
        detail:
          `${formatMinutes(c.a.time.earliest)} vs ${formatMinutes(c.b.time.earliest)}: ` +
          `${e.gapMinutes} min apart, beyond the ${e.toleranceMinutes}-min tolerance.`,
      },
    };
  }

  // T3: verified, nothing above applies, so keep the proposed DIRECT or INFERENTIAL.
  const type = c.proposedType === "INFERENTIAL" ? "INFERENTIAL" : "DIRECT";
  return {
    type,
    hit: {
      id: "T3",
      name: "VERIFIED_PROPOSAL",
      detail: `Both quotes verified and no other rule applies, so the proposed ${type} label is kept.`,
    },
  };
}
