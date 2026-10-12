"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, BrainCircuit, Files, MessageCircle, FilePenLine, ChartNoAxesColumn, ArrowRight, Square, Check, GitBranch, Link2, AlertTriangle, Fingerprint } from "lucide-react";
import type { Schema, Transport } from "@/lib/contracts";
import { loadCorpus } from "@/lib/api";
import { errorBody } from "@/lib/errors";
import { scenarios, exampleProposal } from "@/lib/scenarios";
import { useStream } from "./use-stream";
import { Decisions } from "./decisions";
import { Evidence } from "./evidence";
import { ErrorNotice } from "./common";
import { Proposal } from "./proposal";

type View = "Decisions" | "Ask Why" | "Review Proposal" | "Evaluation";
const navigation = [{ name: "Decisions", icon: Files }, { name: "Ask Why", icon: MessageCircle }, { name: "Review Proposal", icon: FilePenLine }, { name: "Evaluation", icon: ChartNoAxesColumn }] as const;

export function Workspace({ initialList, initialHealth, initialAnswer, snapshotDate, configuredApi }: { initialList: Schema<"DecisionList">; initialHealth: Schema<"HealthResponse">; initialAnswer: Schema<"AnswerCompleted">; snapshotDate: string; configuredApi: boolean }) {
  const [view, setView] = useState<View>("Ask Why");
  const [corpusVersion, setCorpusVersion] = useState(0);
  const [source, setSource] = useState(configuredApi ? "api" : "mock");
  const transport: Transport = source === "mock" ? "mock" : "api";
  const mode_preference = source === "replay" ? "REPLAY" as const : "AUTO" as const;
  const [list, setList] = useState<Schema<"DecisionList"> | null>(configuredApi ? null : initialList);
  const [health, setHealth] = useState<Schema<"HealthResponse"> | null>(configuredApi ? null : initialHealth);
  const [corpusError, setCorpusError] = useState<Schema<"ErrorBody"> | null>(null);
  const [loading, setLoading] = useState(configuredApi);
  const [question, setQuestion] = useState<string>(scenarios[0].question);
  const [draftFixture, setDraftFixture] = useState(false);
  const [proposal, setProposal] = useState(exampleProposal);
  const ask = useStream(configuredApi ? null : initialAnswer);
  const review = useStream(null);
  const corpusAbort = useRef<AbortController | null>(null);
  useEffect(() => () => corpusAbort.current?.abort(), []);
  const visible = view === "Review Proposal" ? review : ask;
  const mock = transport === "mock" || ask.fixture || review.fixture || draftFixture;
  const date = list?.snapshot_id === initialList.snapshot_id ? snapshotDate : "Date not provided by API";

  function changeSource(value: string) {
    ask.reset(); review.reset(); setDraftFixture(false); setSource(value); setCorpusVersion(version => version + 1); setList(null); setHealth(null); setCorpusError(null); setLoading(true);
  }

  useEffect(() => {
    const abort = new AbortController(); corpusAbort.current = abort;
    const timeout = setTimeout(() => abort.abort(), 15000);
    void loadCorpus(source === "mock" ? "mock" : "api", abort.signal).then(data => {
      if (!abort.signal.aborted) { setList(data.list); setHealth(data.health); }
    }).catch(caught => {
      if (corpusAbort.current === abort) setCorpusError(errorBody(caught));
    }).finally(() => {
      clearTimeout(timeout);
      if (corpusAbort.current === abort) setLoading(false);
    });
    return () => { corpusAbort.current = null; abort.abort(); clearTimeout(timeout); };
  }, [source, corpusVersion]);

  function askQuestion(value = question) {
    setView("Ask Why"); setQuestion(value);
    void ask.run(transport, "ask", { question: value.trim(), mode_preference });
  }

  return <div className="app-shell">
    <a href="#workspace-content" className="skip-link">Skip to workspace</a>
    <aside className="sidebar"><Link href="/" className="brand"><span className="brand-mark"><BrainCircuit size={24} strokeWidth={1.5} /></span><span>yBrain<small>Decision workspace</small></span></Link>
      <div className="workspace-name"><span className="workspace-avatar">Py</span><div>Python decisions<small>Public PEP corpus</small></div></div>
      <nav aria-label="Workspace navigation">{navigation.map(({ name, icon: Icon }) => <button key={name} className={view === name ? "active" : ""} onClick={() => setView(name)} aria-current={view === name ? "page" : undefined}><Icon size={18} strokeWidth={1.6} />{name}{view === name && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-note"><GitBranch size={20} strokeWidth={1.5} /><p>A decision is only part of the story.</p><small>Follow its sources, rationale, and replacements.</small></div>
      <div className="sidebar-footer"><span className="avatar">JL</span><div>Josh&apos;s workspace<small>Company Brain Hackathon</small></div></div>
    </aside>
    <main id="workspace-content" className="workspace">
      <header className="workspace-top"><div>Workspace <span>/</span> <strong>{view}</strong></div><div className="snapshot"><span>Snapshot</span><strong>{date}</strong></div></header>
      <div className="workspace-body">
        <div className="page-heading"><div><h1>{view === "Review Proposal" ? "Before the next decision." : view === "Evaluation" ? "Evidence, measured." : view === "Decisions" ? "The decision library." : "Why did we decide that?"}</h1><p>{view === "Review Proposal" ? "Review a proposal against the reasoning already on record." : view === "Evaluation" ? "Corpus facts and recorded evaluation results." : "Follow the sources. Understand the rationale. See what changed."}</p></div><div className="mode-controls">
          {mock && <span className="mock-badge">Mock data</span>}
          <span className="mode-indicator" role="status">{visible.terminal ? `${visible.fixture ? "Recorded " : ""}${visible.terminal.provenance.mode_used}` : "Awaiting response"}</span>
          <label className="sr-only" htmlFor="data-source">Data source</label><select id="data-source" value={source} onChange={e => void changeSource(e.target.value)}><option value="mock">Mock playback</option><option value="api">Connected API</option><option value="replay">API replay</option></select>
        </div></div>
        {list && health && <section className="corpus-stat-strip" aria-label="Corpus statistics"><dl>
          <div><dt><Files size={14} aria-hidden="true" />Documents</dt><dd>{list.documents.length}</dd></div>
          <div><dt><Link2 size={14} aria-hidden="true" />Source-header links</dt><dd>{health.corpus.source_header_edges}</dd></div>
          <div><dt><AlertTriangle size={14} aria-hidden="true" />Missing successors</dt><dd>{health.corpus.missing_successors}</dd></div>
          <div className="snapshot-stat"><dt><Fingerprint size={14} aria-hidden="true" />Snapshot id</dt><dd>{list.snapshot_id}</dd></div>
        </dl>{health.corpus.documents !== list.documents.length && <p className="fine-print">The corpus reports {health.corpus.documents} documents; {list.documents.length} are listed.</p>}</section>}
        {view !== "Review Proposal" && view !== "Evaluation" && <section className="question-panel" aria-label="Ask about a decision"><form onSubmit={e => { e.preventDefault(); askQuestion(); }}><label className="sr-only" htmlFor="question">Ask a question</label><MessageCircle size={21} strokeWidth={1.5} /><input id="question" value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask why a decision was made…" required disabled={ask.busy} /><button type="submit" className="ask-button" disabled={ask.busy || !question.trim()} aria-label="Ask why"><ArrowUp size={20} /></button></form><div className="example-questions"><span>{transport === "mock" ? "Recorded examples" : "Try a question"}</span>{scenarios.slice(0, 3).map(scenario => <button key={scenario.id} onClick={() => askQuestion(scenario.question)} disabled={ask.busy}>{scenario.label}<ArrowRight size={12} /></button>)}{transport === "mock" && <button onClick={() => askQuestion(scenarios[3].question)} disabled={ask.busy}>Error example</button>}</div></section>}
        {loading && <p className="loading-message" role="status">Loading corpus from {transport === "mock" ? "mock fixtures" : "the API"}…</p>}
        {corpusError && <><ErrorNotice error={corpusError} /><button className="text-button" onClick={() => void changeSource(source)}>Retry connection</button></>}
        {view === "Evaluation" ? <section className="panel evaluation-panel"><h2>Corpus snapshot</h2>{health ? <dl className="corpus-counts"><div><dt>Documents</dt><dd>{health.corpus.documents}</dd></div><div><dt>Source-header edges</dt><dd>{health.corpus.source_header_edges}</dd></div><div><dt>Missing successors</dt><dd>{health.corpus.missing_successors}</dd></div></dl> : <p>Corpus counts are unavailable until the health endpoint responds.</p>}<p className="fine-print">{transport === "mock" ? "Counts from the committed /api/health fixture." : "Counts returned by /api/health."} {health?.snapshot_id}</p><div className="evaluation-empty"><ChartNoAxesColumn size={32} strokeWidth={1.2} /><h3>not run yet</h3><p>No evaluation results have been supplied. Results appear here only after a real evaluation run.</p></div></section> : view === "Review Proposal" ? <>
          <section className="panel proposal-input"><div className="section-heading"><h2>Review a proposal</h2><span className="state-label">PROPOSAL</span></div><label className="field-label" htmlFor="proposal">Proposed change</label><textarea id="proposal" value={proposal} onChange={e => setProposal(e.target.value)} rows={4} disabled={review.busy} /><div className="proposal-input-footer"><p className="fine-print">{transport === "mock" ? "Recorded example. Switch to Connected API to review your own text." : "A review suggests changes; it never changes accepted history."}</p><button className="primary-button" onClick={() => void review.run(transport, "review", { proposal_text: proposal.trim(), mode_preference })} disabled={review.busy || !proposal.trim()}>Review proposal<ArrowRight size={15} /></button></div></section>
          <StreamProgress stream={review} />
        </> : <div className="workspace-columns">{list && <Decisions key={`${transport}-${list.snapshot_id}`} documents={list.documents} snapshot={list.snapshot_id} transport={transport} />}<div className="evidence-column"><StreamProgress stream={ask} />{ask.terminal && <Evidence key={ask.terminal.request_id} result={ask.terminal} documents={list?.documents ?? []} transport={transport} />}{!ask.terminal && !ask.busy && !ask.error && <section className="panel empty-evidence"><BookEmpty /><h2>Start with a question</h2><p>Choose an example or ask about a decision. Its evidence and relationships will appear here.</p></section>}</div></div>}
        {review.terminal?.type === "review_completed" && <div hidden={view !== "Review Proposal"}><Proposal key={`${transport}-${review.terminal.request_id}`} result={review.terminal} documents={list?.documents ?? []} transport={transport} onFixture={setDraftFixture} /></div>}
        <footer className="workspace-footer"><span>Python Enhancement Proposals</span><span>{list?.snapshot_id ?? "Corpus unavailable"}</span><span>Statuses are recorded as of the snapshot.</span></footer>
      </div>
    </main>
  </div>;
}

function BookEmpty() { return <Files size={30} strokeWidth={1.2} />; }
function StreamProgress({ stream }: { stream: ReturnType<typeof useStream> }) {
  return <>
    {stream.error && <ErrorNotice error={stream.error} />}
    {stream.cancelled && <p className="cancel-notice" role="status">Request cancelled. You can ask again when you&apos;re ready.</p>}
    {(stream.busy || stream.events.length > 0) && <details className="stream-progress" open={stream.busy}><summary>{stream.busy ? "Following the evidence…" : stream.error ? "Request trace" : "Evidence trace"}<span>{stream.events.filter(e => e.type === "tool_completed").length} completed tool calls</span></summary><ol>{stream.events.filter(e => e.type === "tool_started" || e.type === "tool_completed").map(event => <li key={event.seq}>{event.type === "tool_completed" ? <Check size={14} /> : <GitBranch size={14} />}<span>{event.type === "tool_completed" ? event.summary : event.type === "tool_started" ? event.tool.replaceAll("_", " ") : ""}</span></li>)}</ol>{stream.busy && <button className="text-button" onClick={stream.cancel}><Square size={12} />Cancel request</button>}</details>}
  </>;
}
