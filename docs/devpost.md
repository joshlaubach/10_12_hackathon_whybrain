# DevPost entry draft

No unverified placeholders remain. Every claim below reflects something that has been checked as of about 6:30 PM on Oct 12. The paired evaluation has not been run, so no evaluation numbers are claimed. Re-read it after recording the video, and add the video link and any evaluation results only once they are real.

**Title:** yBrain

**Elevator pitch (200 characters max):** Ask “why did we decide that?” Get cited reasons, what replaced the decision, and a check of your new proposal against past decisions, so teams stop repeating or reversing old calls.

**Tagline:** Ask "Why did we decide that?" and get the cited reasoning, the decision that replaced it, and a check on your new proposal.

**Built with:** HydraDB, Anthropic Claude (Sonnet), Python, FastAPI, Pydantic, Next.js, TypeScript.

**Try it:** repo https://github.com/joshlaubach/10_12_hackathon_whybrain ; demo video link goes here after 10 pm.

---

# Project Story (paste this into the DevPost story box)

## Inspiration

Every team has a decision nobody can explain. The document is half remembered, the thread is buried, and someone is still following a rule that was replaced two years ago. A café that drops its receipt-only refund rule, and a new hire who still follows the old one, is the same problem at small scale. Python's PEPs are the public, real-data version: decision records with `Replaces` and `Superseded-By` links, and plenty of people who still quote the old one.

We wanted a company brain that does more than retrieve text. It should answer "why did we decide that?", say what replaced the decision, and check a new idea against the record before someone repeats or reverses a past call.

## What it does

yBrain (pronounced "why-brain") is a company brain for decision records. You ask a question in plain language. An agent retrieves the relevant records from HydraDB, follows what superseded what using the links in the source headers, and answers with quoted citations and a small evidence graph. When the record cannot support an answer, it says so instead of guessing.

It keeps three things apart that most tools blur together: the status recorded in the source (Final, Superseded, Withdrawn), whether a newer record superseded it as of our corpus snapshot, and conflicts the model only inferred. If a successor is not in the corpus, the graph shows an explicit gap rather than hiding it.

Then it takes action. Paste a new proposal and yBrain lists the past decisions it may contradict, repeat, or suggest replacing, each with a quote, an explanation and an uncertainty, plus the recorded contacts from those sources (authors, not current owners). You can save the proposal as a draft labeled PROPOSAL. The draft goes into the brain separately from accepted decisions, is read back to confirm it landed, and never rewrites history.

We show it on two corpora. The one anyone can follow is Maple Street Café, a fictional sample company with nine decision records: a refund policy that dropped its receipt rule, opening hours that changed and point to a replacement we deliberately left out, a paper schedule that still says Accepted although a team chat replaced it, a loyalty program, a withdrawn compostable-cup plan and a bean supplier. The real-data proof is 24 public Python Enhancement Proposals (PEPs), which are Python's own decision records.

The café walkthrough: ask why customers can get a refund without a receipt, see the old rule marked as replaced with the reason quoted, ask when the café is open and see the missing record shown as a gap, ask who owns the loyalty program and get a refusal, then paste a proposal to bring the receipt rule back and watch it flagged against the reason it was dropped. On the PEPs the same flow explains why PEP 386 was replaced by PEP 440.

## How we built it

A Python/FastAPI backend and a Next.js/TypeScript frontend, joined by one contract. The contract is written once as Pydantic models and generates the OpenAPI file, the TypeScript types and the test fixtures, so the two sides cannot drift. Josh directed the build and made the judgment calls (corpus, ground-truth cases, what counts as relevant evidence, the demo narrative). Claude Code built the backend and the contract; Codex built the interface.

HydraDB stores and retrieves the records. Claude (Sonnet) runs the agent loop with tools to search the brain, read a decision, follow edges, check status and look for conflicts. The agent chooses what to fetch next and when to stop, but supersession comes from the source headers, never from the model. Every quote is checked against its source text. Answers stream as events with request ids, and each answer reports what it actually used (LIVE, LOCAL or REPLAY) from per-request provenance, not from configuration.

The same backend serves either corpus. A `CORPUS` setting selects the corpus, its id format, source links, prompts and HydraDB collections, and the PEP path was verified to be identical before and after the café was added. Each API process serves one corpus at a time, and the café is labeled a fictional sample everywhere it appears.

HydraDB features we use: document ingestion with asynchronous indexing (we poll until each record is searchable), ranked retrieval that returns verbatim chunk text we can quote-check, and graph context, the relations HydraDB extracts from the text. Those extracted relations are a supporting signal only. HydraDB has no "follow the Superseded-By link" operation, and its extracted graph is built from prose by a model, so the graph we draw and the supersession we report come from our own header graph, which is deterministic. Drafts live in their own HydraDB collection, separate from the accepted decisions.

## Challenges we ran into

- A Final document can still be superseded. PEP 333 is Final and was superseded by PEP 3333, so lifecycle status and supersession had to be separate fields.
- Real corpora have holes. PEP 563 names PEP 749 as a successor and PEP 291 names PEP 387, and neither is in our snapshot. We show the gap instead of inventing the missing record.
- Being honest about "live". LIVE only counts when HydraDB supplied evidence that appears in the answer and the model call completed. Failed or merely attempted calls do not qualify, and fixture playback is always labeled "Mock data".
- Indexing is asynchronous, so an uploaded draft is not searchable yet. A draft is only "indexed" after we read it back from the store, and the backend's cached save response does not count.
- A proposal must never rewrite accepted history. Proposals only create a `proposes_to_replace` relation, live in a separate collection, and reusing a draft id with different content returns a conflict.
- HydraDB's extracted graph is noisy. For PEP 386 alone it returned about 70 relations, including one that read "'dev' replaced with '@'" under the predicate `replaces`. It also gave us no way to follow a relation, and its subgraph lookup returned nothing for our documents. That is why edges come from the source headers and HydraDB's relations are only a supporting signal.
- Format and speed. HydraDB rejected our `.rst` files, so we upload the PEPs as `.txt`. Indexing took about 96 seconds per document one at a time; four concurrent uploads brought it to about 60 seconds each. A saved draft's indexing time swung from about eleven seconds to more than ten minutes, because HydraDB's graph-extraction step, which we only use as a hint, sometimes stalled behind other uploads. One test draft passed our ten-minute limit and was shown as failed instead of being reported as saved. We now treat a draft as saved once HydraDB can return it and our read-back finds that exact draft, even if graph enrichment is still running; in a timed test that took about eleven seconds.
- Building a second corpus honestly. The café is fictional, so we wrote it to contain the same traps as the real data: a record that says Accepted but was superseded, a replacement that is missing, a withdrawn decision, and a question the records cannot answer.
- HydraDB's graph step lagged again for the café. Nine documents and a draft sat in graph enrichment for over thirty minutes while retrieval already worked; seven of the nine later completed and the other two were still enriching but already searchable. That is why a draft counts as saved once HydraDB can return it and our read-back finds it.
- Retrieval noise. Early café answers drew extra edges for records that were only loosely related to the question, so for the café we now keep only the edges that touch a cited document.
- Review labels are model output. A proposal that reverted the refund rule was first labeled a suggested replacement rather than a contradiction. A prompt nudge now asks for a contradiction finding when a proposal reinstates what a decision dropped for its stated reason, and the labels can still vary between runs.
- Model output varies. The same 386 question returned four citations on one run and five on the next, so our live checks assert what must be true (the header edge, verified quotes from both decisions) rather than exact counts.
- Four hours, two AI coding agents and one human. Disjoint file ownership and a generated contract kept the work parallel.

## Accomplishments that we're proud of

- A contract-first build: one Pydantic source generates the OpenAPI file, TypeScript types and 14 fixtures, with a backend suite of 58 tests that check, among other things, that every quote appears in its source and every header edge matches the corpus.
- On the café, five live checks passed on real HydraDB and Sonnet calls: the refund answer with both header edges and the reason quoted, the opening-hours answer with the missing record shown as a gap, the loyalty question refused with no citations, a proposal that reverts the refund rule flagged as a contradiction with a verified quote, and a harmless proposal (a sign explaining the policy) that raised no contradiction. A saved café draft read back as indexed in about 25 seconds.
- Evidence-first design: the interface draws only typed evidence edges from the response and never infers relationships from prose.
- Every step of the backend story has run against real HydraDB and Sonnet calls: the 386-to-440 answer with verified citations, the PEP 563 answer with PEP 749 shown as a gap, an abstention on a question the record cannot answer, a proposal review, and a draft that went from pending to indexed only after it was read back from HydraDB.
- The interface runs the same flows against the live API in a real browser: the 386 answer with the LIVE badge and no mock data, the PEP 563 gap, the abstention, and the proposal review with recorded contacts. Its test suite covers the stream protocol, the mock-versus-live labels and the draft states.

## What we learned

- Decision memory is about relationships and status, not only similarity. A search that finds the old record is not the same as a system that knows it was replaced.
- Make deterministic whatever can be deterministic, and let the model explain. Supersession and quote checks do not need a model's opinion. HydraDB's extracted graph made this concrete: it is a useful hint and a bad authority.
- "Saved" has to mean "we could read it back". A quote that appears in a source proves it was quoted accurately, not that it supports the conclusion; that still takes a human.
- Parallel coding agents work when the contract and the file ownership are explicit before anyone starts.

## What's next for yBrain

- Bring your own folder: upload ADRs, RFCs, meeting notes and tickets and build the graph from them.
- Serve several corpora from one backend at once, instead of one per process.
- Live connections to Slack, Notion, GitHub and Jira.
- Real ownership: evidence for who owns a decision today, instead of recorded authors.
- Time travel: show what was current on a past date.
- A larger paired evaluation with failure analysis, not just a small curated set.
- Alerts when a new proposal collides with an existing decision.

---

# Notes for Josh (not part of the story)

**How the story maps to the judging criteria**

- Technical execution: generated contract, streamed agent steps, verified quotes, contract test suite, per-request mode reporting.
- Use of the brain: content is uploaded into HydraDB, retrieved by meaning, and connected through supersession links from the source headers; HydraDB's extracted graph context is used as a supporting signal; review and draft both read and write the same brain (drafts in a separate collection).
- Agentic capability: the agent chooses evidence, follows successors, abstains, and ends in a reviewed, saved proposal.
- Creativity: evidence-first decision memory; supersession from headers, gaps shown.
- Real-world value: any team with ADRs, RFCs or design docs has this problem.

**Honest limits to keep in the submission:** the café is a fictional sample; each API process serves one corpus snapshot at a time; authors are recorded contacts, not current owners; a historical record is not necessarily today's specification; HydraDB's graph relations are model-extracted and noisy, so they are not used as authority; a saved draft can take from about ten seconds to several minutes to become searchable depending on HydraDB's queue, it counts as saved once it is searchable and read back (graph enrichment may still be running), and one earlier test draft passed our ten-minute limit and was shown as failed; the evaluation is a small curated set, not a claim of broad reliability.

**Where the new facts come from:** the HydraDB findings (extracted triplets, 70 relations for PEP 386, the `'dev' replaced with '@'` example, no relation-following operation, empty subgraph, `.rst` rejected, 96 s and 60 s indexing) and the live backend results come from the local Claude Code spike and Step 1-5 report; the café results (five live checks, the 25-second draft, seven of nine documents completed graph enrichment) come from the local Claude Code report and from Codex's real-browser café run; the 58-test count was re-run on `main` before this edit and passes. Re-check the live claims when you record the video, and update the test count if it changes.
