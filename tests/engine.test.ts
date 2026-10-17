import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExtractionSchema, type Candidate, type Statement } from "../shared/types";
import { analyzeCandidates } from "../server/engine/analyze";
import {
  analyzeLanguage,
  formatMinutes,
  subjectSimilarity,
  timeGap,
  verifyQuote,
} from "../server/engine/normalize";

const MARCH = readFileSync("samples/webb-march.txt", "utf8");
const SEPTEMBER = readFileSync("samples/webb-september.txt", "utf8");

/** Builds a candidate with sensible defaults so each test only states what matters. */
function candidate(overrides: Partial<Candidate> & { a: Statement; b: Statement }): Candidate {
  return {
    id: "T",
    topic: "other",
    summary: "test",
    conflictKind: "fact",
    sameTimeFrame: true,
    proposedType: "DIRECT",
    note: "",
    ...overrides,
  };
}

function statement(quote: string, subject: string, extra: Partial<Statement> = {}): Statement {
  return { quote, subject, polarity: "affirms", time: null, ...extra };
}

function analyzeOne(c: Candidate, transcriptA: string, transcriptB: string) {
  return analyzeCandidates([c], transcriptA, transcriptB)[0];
}

describe("normalize helpers", () => {
  it("reads hedging, approximation and absolutes from the witness's words", () => {
    expect(analyzeLanguage("Around 10, maybe 10:30.")).toEqual({ approximate: true, uncertain: ["maybe"], absolute: [] });
    expect(analyzeLanguage("No, never.").absolute).toEqual(["never"]);
    expect(analyzeLanguage("We drove around town").approximate).toBe(false);
  });

  it("measures the gap between time ranges", () => {
    expect(timeGap({ earliest: 1320, latest: 1350 }, { earliest: 1440, latest: 1440 })).toBe(90);
    expect(timeGap({ earliest: 1320, latest: 1350 }, { earliest: 1330, latest: 1330 })).toBe(0);
  });

  it("formats minutes for display", () => {
    expect(formatMinutes(1140)).toBe("7:00 PM");
    expect(formatMinutes(1440)).toBe("12:00 AM");
  });

  it("verifies quotes against the transcript", () => {
    expect(verifyQuote("I was at home all evening.", MARCH)).toBe("exact");
    expect(verifyQuote("i was at HOME all   evening.", MARCH)).toBe("normalized");
    expect(verifyQuote("I was home all night.", MARCH)).toBe("missing");
    expect(verifyQuote("", MARCH)).toBe("missing");
  });

  it("scores subject similarity", () => {
    expect(subjectSimilarity("Daniel Cho", "daniel cho")).toBe(1);
    expect(subjectSimilarity("Hargrove Street warehouse", "Hargrove Street area")).toBe(0.5);
  });
});

describe("classification rules", () => {
  it("T2: a bedtime gap beyond tolerance is INFERENTIAL", () => {
    const f = analyzeOne(
      candidate({
        topic: "sleep",
        conflictKind: "time",
        proposedType: "INFERENTIAL",
        a: statement("Around 10, maybe 10:30.", "bedtime", { time: { earliest: 1320, latest: 1350 } }),
        b: statement("It was late. Midnight maybe.", "bedtime", { time: { earliest: 1440, latest: 1440 } }),
      }),
      MARCH,
      SEPTEMBER,
    );
    expect(f.type).toBe("INFERENTIAL");
    expect(f.rules[0].id).toBe("T2");
    expect(f.severity).toBe("LOW");
  });

  it("G3: 'around 8' vs '8:05' is a FALSE_POSITIVE, even if Claude calls it DIRECT", () => {
    const f = analyzeOne(
      candidate({
        conflictKind: "time",
        proposedType: "DIRECT",
        a: statement("I got there around 8.", "arrival", { time: { earliest: 1200, latest: 1200 } }),
        b: statement("I got there at 8:05.", "arrival", { time: { earliest: 1205, latest: 1205 } }),
      }),
      "A: I got there around 8.",
      "A: I got there at 8:05.",
    );
    expect(f.type).toBe("FALSE_POSITIVE");
    expect(f.rules[0].id).toBe("G3");
    expect(f.confidence).toBeLessThan(0.4);
  });

  it("G2: the Civic trap (owned it then, sold it later) is a FALSE_POSITIVE", () => {
    const f = analyzeOne(
      candidate({
        topic: "vehicle",
        sameTimeFrame: false,
        a: statement("I did at the time, yes.", "grey Honda Civic"),
        b: statement("I sold it in January.", "grey Honda Civic", { polarity: "denies" }),
      }),
      MARCH,
      MARCH,
    );
    expect(f.type).toBe("FALSE_POSITIVE");
    expect(f.rules[0].id).toBe("G2");
  });

  it("G1: an invented quote is a FALSE_POSITIVE", () => {
    const f = analyzeOne(
      candidate({
        a: statement("I was home all night.", "whereabouts"),
        b: statement("I knew of him.", "whereabouts", { polarity: "denies" }),
      }),
      MARCH,
      SEPTEMBER,
    );
    expect(f.type).toBe("FALSE_POSITIVE");
    expect(f.rules[0].id).toBe("G1");
  });

  it("T1: Hargrove is DIRECT but less confident than Daniel Cho (subjects only partly match)", () => {
    const hargrove = analyzeOne(
      candidate({
        topic: "place_visited",
        proposedType: "INFERENTIAL",
        a: statement("No, never. I don't even know where that is.", "Hargrove Street warehouse", { polarity: "denies" }),
        b: statement("I mean, I've driven through that part of town.", "Hargrove Street area"),
      }),
      MARCH,
      SEPTEMBER,
    );
    const cho = analyzeOne(
      candidate({
        topic: "relationship",
        a: statement("I'd never heard of him before this whole thing started.", "Daniel Cho", { polarity: "denies" }),
        b: statement("I knew of him. We had mutual friends.", "Daniel Cho"),
      }),
      MARCH,
      SEPTEMBER,
    );
    expect(hargrove.type).toBe("DIRECT");
    expect(hargrove.rules[0].id).toBe("T1b");
    expect(cho.type).toBe("DIRECT");
    expect(hargrove.confidence).toBeLessThan(cho.confidence);
  });

  it("T1b: 'home all evening' vs 'went out' is DIRECT by our rule", () => {
    const f = analyzeOne(
      candidate({
        topic: "whereabouts",
        proposedType: "INFERENTIAL",
        a: statement("I was at home all evening.", "whereabouts that evening"),
        b: statement("I think I went out briefly to get some groceries", "whereabouts that evening"),
      }),
      MARCH,
      SEPTEMBER,
    );
    expect(f.type).toBe("DIRECT");
    expect(f.rules[0].id).toBe("T1b");
    expect(f.severity).toBe("HIGH");
  });

  it("T3: a verified proposal with no other rule keeps its proposed type", () => {
    const f = analyzeOne(
      candidate({
        topic: "activity",
        proposedType: "INFERENTIAL",
        a: statement("I ordered pizza around 7pm and watched TV.", "what he did that evening"),
        b: statement("I think I went out briefly to get some groceries", "what he did that evening"),
      }),
      MARCH,
      SEPTEMBER,
    );
    expect(f.type).toBe("INFERENTIAL");
    expect(f.rules[0].id).toBe("T3");
  });
});

describe("Edward's three examples, decided by our own rules", () => {
  const A = "A: I was home all night. I went to sleep at 10. I got there around 8.";
  const B = "A: I stepped out around 7. I was up until midnight. I got there at 8:05.";

  it("DIRECT: 'home all night' vs 'stepped out around 7' (T1b), even if Claude guesses INFERENTIAL", () => {
    const f = analyzeOne(
      candidate({
        topic: "whereabouts",
        proposedType: "INFERENTIAL",
        a: statement("I was home all night.", "whereabouts that night"),
        b: statement("I stepped out around 7.", "whereabouts that night", { time: { earliest: 1140, latest: 1140 } }),
      }),
      A,
      B,
    );
    expect(f.type).toBe("DIRECT");
    expect(f.rules[0].id).toBe("T1b");
  });

  it("INFERENTIAL: 'went to sleep at 10' vs 'up until midnight' (T2), even if Claude guesses DIRECT", () => {
    const f = analyzeOne(
      candidate({
        topic: "sleep",
        conflictKind: "time",
        proposedType: "DIRECT",
        a: statement("I went to sleep at 10.", "bedtime", { time: { earliest: 1320, latest: 1320 } }),
        b: statement("I was up until midnight.", "bedtime", { time: { earliest: 1440, latest: 1440 } }),
      }),
      A,
      B,
    );
    expect(f.type).toBe("INFERENTIAL");
    expect(f.rules[0].id).toBe("T2");
  });

  it("FALSE_POSITIVE: 'around 8' vs '8:05' (G3)", () => {
    const f = analyzeOne(
      candidate({
        conflictKind: "time",
        a: statement("I got there around 8.", "arrival", { time: { earliest: 1200, latest: 1200 } }),
        b: statement("I got there at 8:05.", "arrival", { time: { earliest: 1205, latest: 1205 } }),
      }),
      A,
      B,
    );
    expect(f.type).toBe("FALSE_POSITIVE");
    expect(f.rules[0].id).toBe("G3");
  });
});

describe("confidence", () => {
  it("is always between 0 and 1 and equals the sum of its factors (before clamping)", () => {
    const fixture = ExtractionSchema.parse(JSON.parse(readFileSync("samples/webb-extraction.json", "utf8")));
    for (const f of analyzeCandidates(fixture.candidates, MARCH, SEPTEMBER)) {
      const sum = f.factors.reduce((total, factor) => total + factor.effect, 0);
      expect(f.confidence).toBeGreaterThan(0);
      expect(f.confidence).toBeLessThan(1);
      expect(f.confidence).toBeCloseTo(Math.min(0.99, Math.max(0.01, sum)), 1);
      expect(f.rules.length).toBeGreaterThan(0);
    }
  });
});