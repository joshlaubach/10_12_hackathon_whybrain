import { AlertTriangle, Check, ExternalLink } from "lucide-react";
import type { Schema } from "@/lib/contracts";

export function ErrorNotice({ error }: { error: Schema<"ErrorBody"> }) {
  return <div className="error-notice" role="alert" aria-label={`${error.code} error`}><AlertTriangle size={18} /><div><strong>{error.code}</strong><p>{error.message}</p>{error.request_id && <small>Request {error.request_id}</small>}</div></div>;
}

export function SourceLink({ url, children }: { url: string; children: React.ReactNode }) {
  let safe = false;
  try { safe = ["https:", "http:"].includes(new URL(url).protocol); } catch { /* Invalid source URL stays plain text. */ }
  return safe ? <a className="source-link" href={url} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={12} /></a> : <span>{children}</span>;
}

export function StateLabel({ state }: { state: string }) {
  return <span className={`state-label ${state === "indexed" || state === "verified" || state === "completed" ? "supported" : state === "failed" ? "conflict" : ""}`}>{state === "indexed" || state === "verified" || state === "completed" ? <Check size={12} /> : null}{state}</span>;
}
