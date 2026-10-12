# DevPost entry draft (edit before pasting; refine after the demo so it matches what actually works)

**Title:** Why Brain

**Elevator pitch (200 characters max):** Ask “why did we decide that?” Get cited reasons, what replaced the decision, and a check of your new proposal against past decisions, so teams stop repeating or reversing old calls.

**Tagline:** Ask "Why did we decide that?" and get the cited reasoning, the decision that replaced it, and a check on your new proposal.

**Description**

Teams forget why they made decisions, and old decisions keep getting followed after they were replaced. Why Brain is a company brain for decision records. You ask a question in plain language. An agent retrieves the relevant records from HydraDB, follows what superseded what, and answers with quoted citations and a small evidence graph. When the record cannot support an answer, it says so instead of guessing.

Then it takes action. Paste a new proposal and Why Brain lists the past decisions it may contradict, repeat, or suggest replacing, each with a quote and an uncertainty. You can save your proposal as an explicitly labeled draft; the draft is stored in the brain separately from accepted decisions, retrieved back to confirm it landed, and never rewrites history.

Demo data is public: 24 Python Enhancement Proposals (PEPs), which are real decision records with `Replaces` and `Superseded-By` links. The story: why was PEP 386 replaced by PEP 440, what would a proposal that reverts part of it collide with, and what happens when we save it.

**How it maps to the judging criteria**

- Technical execution: Python/FastAPI backend, Next.js frontend, a generated contract shared by both, streamed agent steps, verified quotes, and a test suite for the contract. The mode badge (LIVE, LOCAL, REPLAY) reports what each request actually used.
- Use of the brain: content is uploaded into HydraDB, retrieved by meaning, and connected through supersession links; the proposal review and the saved draft both read and write the same brain. [Confirm after the HydraDB spike which HydraDB graph features are used.]
- Agentic capability: the agent chooses which evidence to fetch next, when to follow a successor, and when to abstain; its final action is a reviewed, saved proposal.
- Creativity: evidence-first decision memory. Supersession comes from source headers, not from model guesses, and a missing successor is shown as a gap.
- Real-world value: any team with ADRs, RFCs or design docs has this problem.

**Honest limits:** one corpus snapshot; authors are recorded contacts, not current owners; a Final PEP can be superseded and a historical record is not necessarily today's specification; the evaluation is a small curated set, not a claim of broad reliability.

**Built with:** HydraDB, Anthropic Claude (Sonnet), Python, FastAPI, Pydantic, Next.js, TypeScript.

**Try it:** repo https://github.com/joshlaubach/10_12_hackathon_whybrain ; demo video link goes here after 10 pm.
