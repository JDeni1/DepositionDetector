import { useState } from "react";
import type { AnalyzeResponse, ContradictionType, Finding, StatementView } from "../shared/types";
import sampleA from "../samples/webb-march.txt?raw";
import sampleB from "../samples/webb-september.txt?raw";

const SECTIONS: { type: ContradictionType; title: string; blurb: string }[] = [
  { type: "DIRECT", title: "Direct contradictions", blurb: "One statement plainly denies the other." },
  {
    type: "INFERENTIAL",
    title: "Inferential contradictions",
    blurb: "Each statement sounds fine alone, but both cannot be true.",
  },
  {
    type: "FALSE_POSITIVE",
    title: "Ruled out",
    blurb: "Flagged, then dismissed by a rule. Shown so you can check the reasoning.",
  },
];

const QUOTE_LABEL: Record<StatementView["quoteMatch"], string> = {
  exact: "Quote found word for word",
  normalized: "Quote found (ignoring case/spacing)",
  missing: "Quote NOT found in transcript",
};

export default function App() {
  const [transcriptA, setTranscriptA] = useState(sampleA);
  const [transcriptB, setTranscriptB] = useState(sampleB);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcriptA, transcriptB }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `Request failed (${res.status}).`);
        return;
      }
      setResult(data as AnalyzeResponse);
    } catch {
      setError("Could not reach the server. Is it running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <header className="masthead">
        <h1>Deposition Contradiction Detector</h1>
        <p>
          Claude proposes where the witness's story changed. Rules in this app verify each one, label it, and
          compute the confidence.
        </p>
      </header>

      <section className="inputs" aria-label="Transcripts">
        <label className="transcript">
          <span>Deposition A (earlier)</span>
          <textarea value={transcriptA} onChange={(e) => setTranscriptA(e.target.value)} spellCheck={false} />
        </label>
        <label className="transcript">
          <span>Deposition B (later)</span>
          <textarea value={transcriptB} onChange={(e) => setTranscriptB(e.target.value)} spellCheck={false} />
        </label>
      </section>

      <div className="actions">
        <button type="button" onClick={analyze} disabled={loading}>
          {loading ? "Analyzing…" : "Find contradictions"}
        </button>
        {loading && <span className="muted">This takes 20 to 60 seconds with a live API key.</span>}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <>
          {result.mock && (
            <p className="banner">
              Demo mode: no API key is set, so this shows the recorded analysis of the Webb transcripts. Quotes are
              still checked against the text above.
            </p>
          )}
          {SECTIONS.map((section) => {
            const items = result.findings.filter((f) => f.type === section.type);
            return (
              <section key={section.type} className={`group group-${section.type.toLowerCase()}`}>
                <h2>
                  {section.title} <span className="count">{items.length}</span>
                </h2>
                <p className="muted">{section.blurb}</p>
                {items.length === 0 ? (
                  <p className="muted">None found.</p>
                ) : (
                  items.map((f) => <FindingCard key={f.id} finding={f} />)
                )}
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const percent = Math.round(finding.confidence * 100);
  return (
    <article className={`card card-${finding.type.toLowerCase()}`}>
      <div className="card-head">
        <span className={`badge badge-${finding.type.toLowerCase()}`}>{finding.type.replace("_", " ")}</span>
        {finding.type !== "FALSE_POSITIVE" && (
          <span className={`severity severity-${finding.severity.toLowerCase()}`}>{finding.severity} severity</span>
        )}
        <span className="topic">{finding.topic.replace("_", " ")}</span>
        <span className="confidence" title="Computed by this app, not by the model">
          <span className="meter" aria-hidden="true">
            <span style={{ width: `${percent}%` }} />
          </span>
          {percent}% confidence
        </span>
      </div>

      <h3>{finding.summary}</h3>

      <div className="quotes">
        <Quote label="Deposition A" statement={finding.a} />
        <Quote label="Deposition B" statement={finding.b} />
      </div>

      <div className="why">
        <div>
          <h4>Why this label</h4>
          <ul className="rules">
            {finding.rules.map((r) => (
              <li key={r.id}>
                <code>{r.id}</code> <strong>{r.name}</strong>: {r.detail}
              </li>
            ))}
          </ul>
        </div>
        <details>
          <summary>Confidence breakdown</summary>
          <ul className="factors">
            {finding.factors.map((factor, i) => (
              <li key={i}>
                <span>{factor.label}</span>
                <span className={factor.effect < 0 ? "minus" : "plus"}>
                  {i === 0 ? factor.effect.toFixed(2) : `${factor.effect >= 0 ? "+" : "−"}${Math.abs(factor.effect).toFixed(2)}`}
                </span>
              </li>
            ))}
            <li className="total">
              <span>Confidence (kept between 0.01 and 0.99)</span>
              <span>{finding.confidence.toFixed(2)}</span>
            </li>
          </ul>
        </details>
      </div>

      <p className="model-note">
        Claude's note (shown for context, never scored): {finding.modelNote} Proposed as{" "}
        {finding.modelProposedType.replace("_", " ")}.
      </p>
    </article>
  );
}

function Quote({ label, statement }: { label: string; statement: StatementView }) {
  return (
    <figure className="quote">
      <figcaption>
        {label}
        {statement.timeLabel && <span className="time"> · {statement.timeLabel}</span>}
      </figcaption>
      <blockquote>“{statement.quote}”</blockquote>
      <p className={`check check-${statement.quoteMatch}`}>
        {statement.quoteMatch === "missing" ? "✗" : "✓"} {QUOTE_LABEL[statement.quoteMatch]}
      </p>
    </figure>
  );
}
