# Why Brain

**Every team forgets why it made its decisions. Why Brain remembers.**

Why Brain is an AI assistant that answers one of the hardest questions at work: *"Why did we decide that?"* It connects your decisions, discussions, and owners, then shows you the full story behind every answer.

![Why Brain screenshot](docs/screenshot.png)

[Watch the 2-minute demo](#) · [Try it live](#)

---

## The problem

Important decisions are scattered across documents, chat threads, and meeting notes. Months later, nobody remembers the reasoning, who was involved, or whether the decision still holds. New teammates ask the same questions again. Old decisions get followed long after they've been replaced.

## What Why Brain does

- **Answers with the full story.** Ask a question in plain language and get a clear answer with sources.
- **Shows its work.** Every answer comes with a visual map of how the pieces connect, so you can see exactly where it came from.
- **Warns you about outdated decisions.** If a newer decision has replaced the one you're asking about, Why Brain tells you and shows you the current reasoning.
- **Adapts to the person asking.** A maintainer gets the technical detail. A newcomer gets the context. Same facts, different emphasis.

## Highlights

**Answer trace.** Watch the connections light up as Why Brain finds your answer.

**Graph vs. search.** See the same question answered two ways: by ordinary search, which returns disconnected snippets, and by Why Brain, which returns a connected answer.

**Decision timeline.** Follow any decision from its first proposal through every change, to where it stands today. Replaced decisions are clearly marked.

**Knowledge health map.** Spot topics that are out of date or known by only one person, before they become a problem.

**Role-based answers.** Compare how the same answer changes for different people on your team.

## See it in action

Our demo uses the public Python Enhancement Proposals (PEPs), a real record of design decisions made over many years. Try asking:

> *Why does Python handle this feature the way it does?*

Ordinary search returns the original proposal, which was later replaced. Why Brain finds the replacement, flags the older proposal as outdated, and shows the path between them.

Bring your own data: architecture decision records, RFCs, meeting notes, Slack threads, and tickets all work the same way.

## How it works

1. **Collect.** Your documents, messages, and tickets are stored in [HydraDB](https://hydradb.com).
2. **Connect.** Decisions, people, and teams are linked by how they relate, such as who proposed what and what replaced what.
3. **Ask.** Why Brain finds the relevant passages and follows the connections between them.
4. **Show.** You get a clear answer, a visual map, and a warning if anything is out of date.

## Quick start

```bash
git clone https://github.com/your-org/why-brain.git
cd why-brain
cp .env.example .env      # add your HydraDB API key
pip install -r requirements.txt
python ingest.py          # loads the demo data
python app.py             # opens at http://localhost:3000
```

You'll need a free [HydraDB account](https://app.hydradb.com/sign-up) and an API key.

## Built with

- [HydraDB](https://hydradb.com) for memory, knowledge graph, and retrieval
- [App-Starter](https://github.com/) for the web app foundation
- Python and FastAPI for the backend
- React for the interface and visualizations

## What's next

- Live connections to Slack, Notion, GitHub, and Jira
- Alerts when a new decision conflicts with an existing one
- Team-wide digests of outdated knowledge

## About

Why Brain was created for the Company Brain Hackathon.

Built by [Your Name](https://github.com/your-handle).

## License

MIT
