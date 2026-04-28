# Discovery Agent Suite

An AI-assisted discovery pipeline for turning a raw product problem into structured delivery artifacts.

The system runs a sequence of specialist stages:

1. Problem Framing
2. Opportunity Framing
3. Story Creation
4. Estimation
5. Prioritisation

Each stage generates output, runs a governance review, and either passes, retries with feedback, or is manually overridden.

## How It Works

The pipeline can be run in two ways:

- CLI mode through [orchestrator.js](/Users/alm1sf/discovery-agent-suite/orchestrator.js)
- Browser dashboard mode through [server.js](/Users/alm1sf/discovery-agent-suite/server.js)

Both entry points use the same runtime pipeline from [pipeline/config.js](/Users/alm1sf/discovery-agent-suite/pipeline/config.js) and [pipeline/runner.js](/Users/alm1sf/discovery-agent-suite/pipeline/runner.js).

For each stage:

1. The runner selects the next runtime agent from [agents/](/Users/alm1sf/discovery-agent-suite/agents).
2. The agent factory in [agents/factory.js](/Users/alm1sf/discovery-agent-suite/agents/factory.js) loads:
   - the reusable skill from [skills/](/Users/alm1sf/discovery-agent-suite/skills)
   - the project context from [context/](/Users/alm1sf/discovery-agent-suite/context)
3. The stage runs against the Anthropic API.
4. Governance evaluates the output using the stage's governance rules.
5. If the stage passes, the output is condensed and carried forward as context for the next stage.
6. If it fails, the governance feedback is fed back into another attempt.

Governance is now multi-layered:

- stage-local quality checks from each skill's `governance.md`
- evidence-aware review that penalizes unsupported claims when evidence exists
- cross-stage alignment checks against previous stage summaries
- contradiction detection for scope drift or certainty inflation
- a final pipeline governance pass over the whole session

## Repo Structure

### `agents/`
Runtime agents used by the app.

These are thin JavaScript wrappers that define:

- stage identity
- label and description
- model settings
- which skill/context to load

These are the agents your application actually runs.

### `skills/`
Reusable capability definitions.

Each skill contains:

- `system.md` for the method and output structure
- `governance.md` for pass/fail criteria

Skills define how a stage should work, independent of any specific project.

The current skill contract is:

- produce a bounded draft even when context is incomplete
- capture gaps under `Missing / Needed Inputs`
- reuse stable IDs when later stages need to reference earlier outputs
- submit governance through the structured governance tool instead of raw JSON prose

### `context/`
Project-specific and organisation-specific facts.

This is where you place:

- product context
- constraints
- evidence sources
- team conventions
- delivery realities

Context should describe the local situation, not reusable prompting technique.

### `.claude/agents/`
Claude Code project subagents.

These are not used by the runtime app. They are for Claude Code itself when helping you work in this repository.

### `pipeline/`
Shared pipeline orchestration:

- [config.js](/Users/alm1sf/discovery-agent-suite/pipeline/config.js) defines stage order and runtime options
- [runner.js](/Users/alm1sf/discovery-agent-suite/pipeline/runner.js) executes the loop, retries, governance, and carry-forward context
- [governance.js](/Users/alm1sf/discovery-agent-suite/pipeline/governance.js) handles structured tool-use governance and final pipeline review
- [shared.js](/Users/alm1sf/discovery-agent-suite/pipeline/shared.js) contains condensation and shared helper logic

### `lib/`
Server-side utilities:

- [session-save.js](/Users/alm1sf/discovery-agent-suite/lib/session-save.js) serialises completed sessions to markdown and saves them to `sessions/`

## Runtime Flow Example

If you enter a topic like `checkout drop-off on mobile`, the pipeline works like this:

1. Problem Framing creates a clear problem statement.
2. Opportunity Framing turns that problem into a measurable opportunity.
3. Story Creation generates delivery-ready stories.
4. Estimation sizes the stories using ranges and confidence.
5. Prioritisation ranks the work by value, risk, and effort.

Each passed stage adds a condensed summary to session history, so later stages build on earlier outputs.

The downstream stages now stay linked by shared identifiers:

- Story Creation assigns stable story IDs such as `ST-1`, `ST-2`
- Estimation carries those IDs forward when sizing the work
- Prioritisation ranks the same IDs so decisions map back to the generated stories

## Evidence Ingestion

The dashboard supports a lightweight evidence-ingestion workflow.

End users can:

- paste evidence text directly into the UI
- import `.txt`, `.md`, `.csv`, `.json`, `.docx`, `.xlsx`, or `.pdf` files from their machine
- ask the evidence-triage agent to auto-label the intake
- label each evidence item by type
- scope evidence to all stages or a specific stage

Evidence is stored in memory for the active server session and routed to agents using explicit stage rules plus lightweight relevance scoring.

There is also an evidence-triage layer that acts like a lightweight intake agent. When a user pastes or imports evidence, the app can suggest:

- a title
- an evidence type
- the likely relevant stages
- a confidence level
- a short summary

The user can accept or override those suggestions before the evidence enters the active library.

The frontend flow is:

1. Paste or import evidence
2. Click `Auto-label`
3. Review the suggested title, type, stage scope, confidence, and summary
4. Accept the suggestion or edit manually
5. Add the evidence to the session library

Supported document parsing:

- plain text and markdown: direct UTF-8 extraction
- CSV and JSON: direct text extraction
- Word documents (`.docx`): server-side text extraction
- Excel spreadsheets (`.xlsx`): sheet-by-sheet text extraction
- PDFs (`.pdf`): text extraction for text-based PDFs

Note: scanned/image-only PDFs are not reliably supported yet because they require OCR rather than text extraction.

Examples:

- Problem Framing gets support, analytics, incident, and research evidence
- Opportunity Framing gets strategy, analytics, research, and commercial evidence
- Estimation gets technical, delivery, dependency, and capacity evidence
- Prioritisation gets commercial, strategy, dependency, capacity, and analytics evidence

When a stage starts, the runner selects the most relevant evidence items and injects them into the prompt alongside the carried-forward session summary. The dashboard also shows which evidence each stage used.

## Session Saving

When a pipeline run completes, two files are written to `sessions/`:

- `<date>_<topic-slug>.md` — full session output including stage results, governance scores, evidence used, and a token usage table with cache efficiency
- `<date>_<topic-slug>.run.log` — timestamped log of every pipeline event from the run

The session markdown includes a pipeline summary table and, if final governance ran, a full cross-stage review. Token usage is broken down per stage (run in/out, cache read/write, governance in/out) with a totals row and overall cache efficiency percentage.

The `sessions/` directory is created automatically on first save.

## Running Locally

Install dependencies:

```bash
npm install
```

Create a local env file once:

```bash
cp .env.example .env.local
```

Then edit `.env.local` and add your real key:

```bash
ANTHROPIC_API_KEY=your_api_key
```

After that, local testing is just one command per workflow.

Start the dashboard:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

Run the health check:

```bash
npm run healthcheck
```

Notes:

- `server.js`, `orchestrator.js`, and `scripts/healthcheck.js` now auto-load `.env` and `.env.local`
- values already exported in your shell still win over file-based values
- use `.env.local` for machine-specific secrets; it is gitignored

## Important Files

- [server.js](/Users/alm1sf/discovery-agent-suite/server.js): Express server and dashboard orchestration
- [orchestrator.js](/Users/alm1sf/discovery-agent-suite/orchestrator.js): CLI pipeline runner
- [agents/factory.js](/Users/alm1sf/discovery-agent-suite/agents/factory.js): composes skills and context at runtime
- [context/loader.js](/Users/alm1sf/discovery-agent-suite/context/loader.js): loads shared and stage-specific context
- [skills/loader.js](/Users/alm1sf/discovery-agent-suite/skills/loader.js): loads reusable skill prompts

## Design Principle

The project now follows this separation:

- `agents` decide which stage is running
- `skills` define how that stage should behave
- `context` provides the local facts the stage should apply
- `.claude/agents` helps Claude Code work with the repo

This keeps reusable method separate from project knowledge and makes the pipeline easier to evolve over time.

## Governance Model

Governance is no longer only checking formatting and completeness.

For each stage, the system now reviews:

- whether the structure satisfies the skill-specific rules
- whether claims are grounded in the evidence provided
- whether assumptions are made explicit
- whether the stage is aligned with previous stage outputs
- whether contradictions or scope drift appear

The governance response includes:

- pass/fail
- score
- issues
- verdict
- evidence grounding strength
- cross-stage alignment strength
- assumptions
- contradictions

Stage governance now uses a `70` pass threshold, with each skill's `governance.md` defining any blocker conditions for that stage.

At the end of the pipeline, a final governance pass evaluates the session as a whole for:

- evidence grounding
- cross-stage integrity
- contradictions
- decision usefulness
- unresolved uncertainty
