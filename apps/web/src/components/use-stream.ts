"use client";

import { useEffect, useRef, useState } from "react";
import type { Schema, Terminal, Transport } from "@/lib/contracts";
import { endpoint } from "@/lib/api";
import { errorBody } from "@/lib/errors";
import { consumeSSE } from "@/lib/sse";

export function useStream(initial: Terminal | null) {
  const [terminal, setTerminal] = useState(initial);
  const [events, setEvents] = useState<Schema<"StreamEvent">[]>([]);
  const [error, setError] = useState<Schema<"ErrorBody"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [fixture, setFixture] = useState(initial?.fixture ?? false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const reset = () => {
    controller.current?.abort(); controller.current = null;
    setTerminal(null); setEvents([]); setError(null); setBusy(false); setCancelled(false); setFixture(false);
  };
  const run = async (transport: Transport, kind: "ask" | "review", body: Schema<"AskRequest"> | Schema<"ProposalReviewRequest">) => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setTerminal(null); setEvents([]); setError(null); setCancelled(false); setBusy(true); setFixture(transport === "mock");
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, 60000);
    try {
      const response = await fetch(endpoint(transport, kind === "ask" ? "ask" : "proposals/review"), { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body), signal: abort.signal });
      const result = await consumeSSE(response, event => {
        if (controller.current !== abort) return;
        if (event.fixture) setFixture(true);
        setEvents(current => [...current, event]);
      }, abort.signal, kind === "ask" ? "answer_completed" : "review_completed");
      if (controller.current !== abort) return;
      if (result.type === "error") setError(result);
      else setTerminal(result);
    } catch (caught) {
      if (controller.current !== abort) return;
      if (timedOut) setError({ code: "timeout", message: "The request took longer than 60 seconds. Try again.", retryable: true, request_id: null });
      else if (abort.signal.aborted) { setCancelled(true); setEvents([]); }
      else setError(errorBody(caught));
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) { setBusy(false); controller.current = null; }
    }
  };
  return { terminal, events, error, busy, cancelled, fixture, reset, run, cancel: () => controller.current?.abort() };
}
