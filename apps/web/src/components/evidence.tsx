"use client";

import { useRef, useState } from "react";
import { ArrowRight, BookOpen, GitBranch, Link2, AlertTriangle } from "lucide-react";
import type { Schema, Terminal, Transport } from "@/lib/contracts";
import { docLabel, relationLabel } from "@/lib/contracts";
import { loadDetail } from "@/lib/api";
import { errorBody } from "@/lib/errors";
import { ErrorNotice, SourceLink } from "./common";

type Selection = { kind: "node"; id: string } | { kind: "edge"; edge: Schema<"EvidenceEdge"> } | { kind: "citation"; citation: Schema<"Citation"> };

export function Evidence({ result, documents, transport, cafe = false }: { result: Terminal; documents: Schema<"Document">[]; transport: Transport; cafe?: boolean }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detail, setDetail] = useState<Schema<"DecisionDetail"> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Schema<"ErrorBody"> | null>(null);
  const [sectionIndex, setSectionIndex] = useState(0);
  const generation = useRef(0);
  const lookup = (id: string) => documents.find(doc => doc.doc_id === id);
  const citations = result.type === "answer_completed" ? result.citations : result.findings;
  const missing = new Set(result.evidence_edges.filter(edge => !edge.target_in_corpus).map(edge => edge.target_doc_id));
  const nodes = [...new Set([...result.inspected_doc_ids, ...result.evidence_edges.flatMap(edge => edge.target_in_corpus ? [edge.source_doc_id, edge.target_doc_id] : [edge.source_doc_id])])].filter(id => !missing.has(id));

  async function selectNode(id: string) {
    const token = ++generation.current;
    setSelection({ kind: "node", id }); setDetail(null); setError(null); setLoading(false); setSectionIndex(0);
    if (missing.has(id) || id === "proposal" || id.startsWith("draft:") || citations.some(citation => citation.doc_id === id)) return;
    setLoading(true);
    try {
      const data = await loadDetail(transport, result.as_of, id);
      if (generation.current === token) setDetail(data);
    } catch (caught) {
      if (generation.current === token) setError(errorBody(caught));
    } finally { if (generation.current === token) setLoading(false); }
  }

  function select(next: Selection) {
    generation.current++; setSelection(next); setDetail(null); setError(null); setLoading(false);
  }

  const selectedDoc = selection?.kind === "node" ? lookup(selection.id) : null;
  const selectedQuotes: Schema<"EvidenceRef">[] = selection?.kind === "edge" ? selection.edge.supporting_evidence : selection?.kind === "citation" ? [selection.citation] : selection?.kind === "node" ? citations.filter(c => c.doc_id === selection.id) : [];
  const groups = [
    { heading: "Source-header relationships", description: "Recorded in the source, as of this snapshot.", edges: result.evidence_edges.filter(e => e.origin === "source_header" && e.target_in_corpus) },
    { heading: "Missing successors", description: "These targets are outside this corpus. Their contents cannot be cited here.", edges: result.evidence_edges.filter(e => !e.target_in_corpus) },
    { heading: "Inferred conflicts", description: "Model judgments, separate from accepted source history.", edges: result.evidence_edges.filter(e => e.origin === "inferred" && e.target_in_corpus) },
    { heading: "Proposal suggestions", description: "Suggestions only. Accepted documents and statuses stay unchanged.", edges: result.evidence_edges.filter(e => e.origin === "proposal" && e.target_in_corpus) },
  ];

  return <>
    {result.type === "answer_completed" && <section className="panel answer-panel" aria-labelledby="answer-title">
      <div className="section-heading"><div><span className="section-icon"><BookOpen size={16} /></span><h2 id="answer-title">{result.abstained ? "I can't answer that from the record" : "What the evidence says"}</h2></div><span className="state-label">{result.citations.length} citations</span></div>
      <p className="answer-copy">{result.abstained ? result.abstain_reason : result.answer}</p>
      <div className="citation-strip">{(result.abstained ? [] : result.citations).map((citation, index) => <button key={`${citation.doc_id}-${index}`} className="citation-button" onClick={() => select({ kind: "citation", citation })} aria-pressed={selection?.kind === "citation" && selection.citation === citation}><span>{index + 1}</span>{docLabel(citation.doc_id)}<small>{citation.locator}</small></button>)}</div>
      <p className="fine-print">Conclusions apply as of corpus snapshot {result.as_of}.</p>
    </section>}

    <section className="panel graph-panel" aria-labelledby="graph-title">
      <div className="section-heading"><div><span className="section-icon"><GitBranch size={16} /></span><h2 id="graph-title">Follow the evidence</h2></div><span className="fine-print">{result.inspected_doc_ids.length} inspected documents</span></div>
      <div className="graph-nodes" role="group" aria-label="Evidence graph documents">{nodes.map(id => {
        const doc = lookup(id);
        return <button key={id} className={`graph-node ${selection?.kind === "node" && selection.id === id ? "selected" : ""}`} onClick={() => void selectNode(id)} aria-pressed={selection?.kind === "node" && selection.id === id}>
          <span className="node-id">{docLabel(id)}</span>
          <span className="node-title">{doc?.title ?? (id === "proposal" ? "Under review" : "Referenced document")}</span>
          <span className="node-status">{doc ? `Source status: ${doc.source_status}` : id === "proposal" || id.startsWith("draft:") ? "PROPOSAL" : "Source metadata unavailable"}</span>
          {doc && !result.inspected_doc_ids.includes(id) && <small>Referenced, not inspected in this response</small>}
        </button>;
      })}</div>
      {!!missing.size && <div className="evidence-gaps" role="group" aria-label="Explicit evidence gaps">{[...missing].map(id => <button key={id} className="evidence-gap conflict" onClick={() => void selectNode(id)}><AlertTriangle size={14} /><strong>{docLabel(id)}</strong><span>Missing from corpus</span><span>Explicit evidence gap</span></button>)}</div>}
      <div className="relationship-groups">{groups.filter(group => group.edges.length).map(group => <div className="relationship-group" key={group.heading}><h3>{group.heading}</h3><p className="fine-print">{group.description}</p>{group.edges.map(edge => <button key={edge.edge_id} className={`edge-row ${edge.origin === "inferred" || !edge.target_in_corpus ? "conflict" : ""}`} onClick={() => select({ kind: "edge", edge })} aria-pressed={selection?.kind === "edge" && selection.edge.edge_id === edge.edge_id}>
        <span>{docLabel(edge.source_doc_id)}</span><ArrowRight size={16} /><span className="edge-label">{relationLabel[edge.relation]}</span><ArrowRight size={16} /><span>{docLabel(edge.target_doc_id)}</span>{!edge.target_in_corpus && <span className="state-label conflict">Missing from corpus</span>}
      </button>)}</div>)}</div>
      {!result.evidence_edges.length && <p className="empty-inline">No relationships were established by this response.</p>}
      <div className="evidence-inspector" aria-live="polite">
        {!selection ? <div className="inspector-empty"><Link2 size={18} /><p>Select a citation, document, or relationship to inspect its source evidence.</p></div> : <>
          <h3>{selection.kind === "edge" ? relationLabel[selection.edge.relation] : selection.kind === "citation" ? `${docLabel(selection.citation.doc_id)} — ${selection.citation.locator}` : `${docLabel(selection.id)}${selectedDoc ? ` — ${selectedDoc.title}` : ""}`}</h3>
          {selectedDoc && <div className="inspector-meta"><span>Source status: <strong>{selectedDoc.source_status}</strong></span><SourceLink url={selectedDoc.source_url}>{cafe ? "Read source file" : "Read source"}</SourceLink></div>}
          {selection.kind === "citation" && <SourceLink url={selection.citation.source_url}>{cafe ? "Read source file" : "Read source"}</SourceLink>}
          {selection.kind === "edge" && <><p className="fine-print">Origin: {selection.edge.origin.replaceAll("_", " ")}{selection.edge.uncertainty ? ` · Uncertainty: ${selection.edge.uncertainty}` : ""}</p>{selection.edge.explanation && <p>{selection.edge.explanation}</p>}</>}
          {selection.kind === "node" && missing.has(selection.id) && <p className="gap-note">This successor is missing from the corpus snapshot. No quote or source content is available here.</p>}
          {selection.kind === "node" && selection.id === "proposal" && <p>This is a PROPOSAL under review. It is not an accepted decision.</p>}
          {selectedQuotes.map((quote, index) => <figure key={index}><blockquote>{quote.quote}</blockquote><figcaption>{docLabel(quote.doc_id)} · {quote.locator}</figcaption></figure>)}
          {loading && <p role="status">Loading source sections…</p>}
          {error && <ErrorNotice error={error} />}
          {detail && <><label className="field-label" htmlFor="source-section">Source section</label><select id="source-section" onChange={event => setSectionIndex(Number(event.target.value))} value={sectionIndex}>{detail.sections.map((section, i) => <option key={`${section.locator}-${i}`} value={i}>{section.heading}</option>)}</select><pre className="source-text">{detail.sections[sectionIndex]?.text}</pre></>}
          {selectedDoc && <div className="contacts"><h3>Recorded contacts</h3><ul>{selectedDoc.authors.map(author => <li key={author}>{author}</li>)}</ul></div>}
        </>}
      </div>
    </section>
  </>;
}
