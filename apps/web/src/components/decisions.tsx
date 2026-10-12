"use client";

import { useRef, useState } from "react";
import { Search, ArrowUpRight, BookOpen } from "lucide-react";
import type { Schema, Transport } from "@/lib/contracts";
import { docLabel } from "@/lib/contracts";
import { loadDetail } from "@/lib/api";
import { errorBody } from "@/lib/errors";
import { ErrorNotice, SourceLink } from "./common";

export function Decisions({ documents, snapshot, transport }: { documents: Schema<"Document">[]; snapshot: string; transport: Transport }) {
  const [selected, setSelected] = useState("pep-0386");
  const [filter, setFilter] = useState("");
  const [detail, setDetail] = useState<Schema<"DecisionDetail"> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Schema<"ErrorBody"> | null>(null);
  const [section, setSection] = useState(0);
  const token = useRef(0);
  const pinned = ["pep-0386", "pep-0440", "pep-0563"];
  const sorted = [...documents].sort((a, b) => (pinned.indexOf(a.doc_id) === -1 ? 99 : pinned.indexOf(a.doc_id)) - (pinned.indexOf(b.doc_id) === -1 ? 99 : pinned.indexOf(b.doc_id)));
  const visible = sorted.filter(doc => `${docLabel(doc.doc_id)} ${doc.title} ${doc.source_status}`.toLowerCase().includes(filter.toLowerCase()));
  const doc = documents.find(doc => doc.doc_id === selected);

  async function read(id: string) {
    const current = ++token.current;
    setLoading(true); setError(null);
    try {
      const value = await loadDetail(transport, snapshot, id);
      if (token.current === current) setDetail(value);
    } catch (caught) { if (token.current === current) setError(errorBody(caught)); }
    finally { if (token.current === current) setLoading(false); }
  }

  return <aside className="decision-library" aria-labelledby="decisions-title">
    <div className="library-heading"><h2 id="decisions-title">Decisions</h2><span>{documents.length}</span></div>
    <label className="library-search"><Search size={15} /><input aria-label="Filter decisions" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find a decision" /></label>
    <div className="decision-cards">{visible.map(item => <button className={`decision-card ${selected === item.doc_id ? "selected" : ""}`} key={item.doc_id} onClick={() => { token.current++; setSelected(item.doc_id); setDetail(null); setSection(0); setError(null); setLoading(false); }} aria-pressed={selected === item.doc_id}>
      <span className="decision-card-top"><span>{docLabel(item.doc_id)}</span><ArrowUpRight size={15} /></span>
      <strong>{item.title}</strong><span className="decision-status">Source status: {item.source_status}</span>
      {item.superseded_by.length > 0 && <span className="decision-relation">Superseded by {item.superseded_by.map(ref => docLabel(ref.doc_id)).join(", ")}</span>}
      {item.missing_successors.length > 0 && <span className="decision-gap">Missing successor: {item.missing_successors.map(docLabel).join(", ")}</span>}
    </button>)}</div>
    {!visible.length && <p className="empty-inline">No matching decisions. Try a title, PEP number, or source status.</p>}
    {doc && <div className="decision-detail"><SourceLink url={doc.source_url}>{docLabel(doc.doc_id)} source</SourceLink><h3>Recorded contacts</h3><ul>{doc.authors.map(author => <li key={author}>{author}</li>)}</ul><button className="text-button" onClick={() => void read(doc.doc_id)} disabled={loading}><BookOpen size={14} />{loading ? "Loading sections…" : "Read source sections"}</button>
      {error && <ErrorNotice error={error} />}
      {detail && <><label htmlFor="library-section" className="field-label">Source section</label><select id="library-section" value={section} onChange={e => setSection(Number(e.target.value))}>{detail.sections.map((value, i) => <option value={i} key={`${value.heading}-${i}`}>{value.heading}</option>)}</select><pre className="source-text">{detail.sections[section]?.text}</pre></>}
    </div>}
  </aside>;
}
