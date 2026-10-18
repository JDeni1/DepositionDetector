# Deposition Contradiction Detector

Compares two depositions from the same witness and sorts every change in their story into
**Direct**, **Inferential** or **False positive**, with a confidence score computed by this
app's own rules (never by the LLM).

## Run it (one command)

```
npm install && npm run dev
```

Open http://localhost:5173. With no API key the app runs in **demo mode** and replays a recorded
analysis of the sample (Marcus Webb) transcripts, so it works without any setup.

To use Claude live, create `.env` from `.env.example` and add your key:

```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-5-5
MOCK_LLM=false
```

Other commands: `npm test` (engine tests), `npm run build` (type-check + production build),
`npm run record` (re-record the demo fixture with a real API call).

## How it works

```
UI ── POST /api/analyze ──> extract.ts ──> Claude (structured output: candidate pairs only)
                                 │
                       zod validates every field
                                 │
              engine/ (our rules)  → type, severity, confidence + breakdown
```

**Claude proposes, the rules decide.** Claude returns candidate pairs of quotes with plain
facts (topic, times in minutes, affirms/denies, same time frame or not). It never returns a
confidence score. Every final label carries the ID of the rule that set it:

| Rule | Effect |
| --- | --- |
| G1 QUOTE_NOT_FOUND | A quote is not in its transcript → false positive |
| G2 DIFFERENT_TIME_FRAME | Statements cover different periods → false positive |
| G3 TIME_WITHIN_TOLERANCE | Time gap ≤ 10 min (30 if hedged) → false positive |
| G4 PROPOSED_AS_FALSE_POSITIVE | Extraction itself flagged it as harmless → false positive |
| T1 OPPOSITE_POLARITY | One affirms what the other denies, same subject → direct |
| T1b ABSOLUTE_CLAIM_BROKEN | One side is absolute ("all night", "never"), the other describes an exception → direct |
| T2 TIME_CONFLICT | Times differ beyond tolerance → inferential |
| T3 VERIFIED_PROPOSAL | Verified and no rule above applies → proposed label kept |
| S1 SEVERITY_BY_TOPIC | Alibi, companions, places, people = HIGH; activity, vehicle = MEDIUM; sleep, other = LOW |

**Confidence** starts at 0.50 and adds or subtracts named factors: quotes verified against the
transcript, hedging ("maybe", "I think") or absolutes ("never") in the witness's own words, time
gap beyond tolerance, opposite polarity, subject match, and rule penalties. It is kept between
0.01 and 0.99, and the UI shows the full breakdown.

## Project layout

| Path | Purpose |
| --- | --- |
| `shared/types.ts` | zod schemas and types shared by server and UI |
| `server/llm/extract.ts` | The only place Claude is called |
| `server/engine/` | Pure functions: normalize, classify, confidence, analyze |
| `server/index.ts` | Express API with input validation and error handling |
| `src/` | React UI |
| `tests/` | Vitest tests, including the Civic, Hargrove and "around 8 vs 8:05" traps |
| `samples/` | Webb transcripts and the recorded demo fixture |

## Known limits and next steps

- Keyword hedging doesn't understand negation ("I didn't say I'd never been" counts as absolute).
- Times are same-night minutes; real cases need full dates.
- Long transcripts need chunking; more than two depositions need pairwise comparison.
- Confidence weights are hand-set; next step is tuning them on a labelled set of real contradictions.
