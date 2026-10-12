"use client";

import { useEffect, useRef, useState } from "react";
import { FilePenLine, Save, Plus, RotateCw } from "lucide-react";
import type { Schema, Transport } from "@/lib/contracts";
import { docLabel, findingLabel } from "@/lib/contracts";
import { readDraft, saveDraft } from "@/lib/api";
import { ApiError, errorBody } from "@/lib/errors";
import { ErrorNotice, SourceLink, StateLabel } from "./common";
import { Evidence } from "./evidence";

export function Proposal({ result, documents, transport, onFixture }: { result: Schema<"ReviewCompleted">; documents: Schema<"Document">[]; transport: Transport; onFixture: (fixture: boolean) => void }) {
  const [body, setBody] = useState(result.draft_md);
  const [title, setTitle] = useState(result.draft_md.split("\n")[0].replace(/^#\s*(Proposal:\s*)?/i, ""));
  const [id, setId] = useState(() => crypto.randomUUID());
  const [record, setRecord] = useState<Schema<"DraftRecord"> | null>(null);
  const [error, setError] = useState<Schema<"ErrorBody"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<"indexed" | "failed">("indexed");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const pending = busy || record?.status === "pending";
  const replacementIds = [...new Set(result.evidence_edges.filter(edge => edge.relation === "proposes_to_replace").map(edge => edge.target_doc_id))];

  function accept(value: Schema<"DraftRecord">, expectedId: string) {
    if (value.draft_id !== expectedId) throw new ApiError({ code: "internal_error", message: "The API returned a different draft ID.", request_id: null, retryable: false });
    if (value.status === "indexed" && (value.provider_indexing !== "completed" || value.retrieval_verification !== "verified" || !value.verified_via)) throw new ApiError({ code: "internal_error", message: "The draft is marked indexed without verified retrieval. Check its status again.", request_id: null, retryable: true });
    if (mounted.current) { setRecord(value); if (value.fixture) onFixture(true); }
    return value;
  }

  async function persist(newDraft = false, refreshOnly = false) {
    if (controller.current) return;
    const draftId = newDraft ? crypto.randomUUID() : id;
    if (newDraft) { setId(draftId); setRecord(null); }
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(null);
    const timeout = setTimeout(() => abort.abort(), 60000);
    try {
      let value = accept(refreshOnly ? await readDraft(transport, draftId, abort.signal) : await saveDraft(transport, { draft_id: draftId, title, body_md: body, proposes_to_replace: replacementIds }, abort.signal, outcome), draftId);
      while (value.status === "pending") {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { abort.signal.removeEventListener("abort", cancel); resolve(); }, 900);
          const cancel = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
          abort.signal.addEventListener("abort", cancel, { once: true });
          if (abort.signal.aborted) cancel();
        });
        value = accept(await readDraft(transport, draftId, abort.signal), draftId);
      }
    } catch (caught) {
      if (mounted.current) setError(abort.signal.aborted ? { code: "timeout", message: "Draft processing is still pending. Use Check draft status to resume verification.", retryable: true, request_id: null } : errorBody(caught));
    } finally {
      clearTimeout(timeout); controller.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  return <div className="proposal-results">
    <div className="review-evidence"><section className="panel findings-panel"><div className="section-heading"><h2>What needs attention</h2><span className="state-label">{result.findings.length} findings</span></div>{!result.findings.length && <p>No conflicts were identified in the inspected evidence. This is not an approval.</p>}{result.findings.map(finding => <article className={`finding ${finding.relation === "may_contradict" ? "conflict" : ""}`} key={finding.finding_id}><div className="finding-heading"><span className={`state-label ${finding.relation === "may_contradict" ? "conflict" : ""}`}>{findingLabel[finding.relation]}</span><small>Uncertainty: {finding.uncertainty}</small></div><h3>{finding.claim}</h3><blockquote>{finding.quote}</blockquote><SourceLink url={finding.source_url}>{docLabel(finding.doc_id)} · {finding.locator}</SourceLink><p>{finding.explanation}</p></article>)}<div className="contacts"><h3>Recorded contacts</h3><ul>{result.recorded_contacts.map(contact => <li key={contact}>{contact}</li>)}</ul></div></section><Evidence result={result} documents={documents} transport={transport} /></div>
    <section className="panel draft-editor" aria-labelledby="draft-title"><div className="section-heading"><div><FilePenLine size={17} /><h2 id="draft-title">Working draft</h2></div><span className="state-label proposal-label">PROPOSAL</span></div><p className="fine-print">Suggested replacement (not an accepted change). Saving preserves the proposal separately from accepted decisions.</p>
      <label className="field-label" htmlFor="draft-name">Draft title</label><input id="draft-name" value={title} onChange={e => setTitle(e.target.value)} disabled={pending} />
      <label className="field-label" htmlFor="draft-body">Draft text</label><textarea id="draft-body" value={body} onChange={e => setBody(e.target.value)} disabled={pending} rows={19} />
      {transport === "mock" && <div className="mock-draft-options"><label className="field-label" htmlFor="draft-outcome">Mock save scenario</label><select id="draft-outcome" value={outcome} onChange={e => setOutcome(e.target.value as "indexed" | "failed")} disabled={pending}><option value="indexed">Indexing succeeds</option><option value="failed">Indexing fails</option></select><small>Simulated stages only; no data is uploaded.</small></div>}
      <div className="draft-actions"><button className="primary-button" onClick={() => void persist()} disabled={pending || !body.trim() || !title.trim()}><Save size={15} />{busy ? "Saving / verifying…" : "Save draft"}</button><button className="secondary-button" onClick={() => void persist(true)} disabled={pending || !body.trim() || !title.trim()}><Plus size={15} />Save as new draft</button></div>
      {error && <ErrorNotice error={error} />}
      {record && <div className="draft-state" role="status"><div className="section-heading"><h3>{record.fixture ? "Mock draft status" : "Draft status"}</h3><StateLabel state={record.status} /></div><dl><div><dt>Provider indexing</dt><dd><StateLabel state={record.provider_indexing} /></dd></div><div><dt>Retrieval verification</dt><dd><StateLabel state={record.retrieval_verification} /></dd></div></dl>{record.error && <p className="gap-note">{record.error}</p>}{record.status === "indexed" && <p>Verified via: {record.verified_via === "hydradb" ? "HydraDB" : "local store"}{record.fixture ? " (simulated)" : ""}. {record.fixture ? "Simulation complete. This mock draft has not been uploaded to a provider." : `Retrieved and verified from ${record.verified_via === "hydradb" ? "HydraDB" : "the local store"}.`}</p>}{record.status === "indexed" && <p className="fine-print">searchable; graph enrichment may still be running</p>}<button className="text-button" onClick={() => void persist(false, true)} disabled={busy}><RotateCw size={14} />Check draft status</button></div>}
      <p className="draft-id">Draft ID: {id}</p>
    </section>
  </div>;
}
