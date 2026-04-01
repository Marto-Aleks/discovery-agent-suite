# CLAUDE.md — Discovery Agent Suite

This file provides guidance to Claude Code when working in this repository.

---

## What this project is

An AI-native Discovery pipeline — a multi-agent system that guides product teams through structured discovery, from raw problem through to estimated, delivery-ready stories.

Built to demonstrate agentic workflows in an AI-native SDLC. Not a prototype — intended to be used in real discovery sessions.

---

## Architecture

### Stack
- **Runtime:** Node.js (ES modules)
- **Server:** Express
- **AI:** Anthropic SDK (`@anthropic-ai/sdk` v0.80.0) — Opus 4 for reasoning, Haiku for governance
- **UI:** Single-page dashboard (`public/index.html`) via Server-Sent Events (SSE)

### Key files
| File | Role |
|---|---|
| `server.js` | Express server, SSE event bus, pipeline orchestration loop |
| `orchestrator.js` | Pipeline coordinator (imports agents, runs sequence) |
| `agents/*.js` | Thin runtime agent wrappers — each exports `meta`, `run`, `govern` |
| `skills/<skill-id>/` | Reusable prompting and governance instructions |
| `context/*.md` | Project or organisation-specific context layered onto skills |
| `.claude/agents/*.md` | Claude Code project subagents for working in this repo |
| `public/index.html` | Web dashboard — connects via SSE, renders pipeline state |

### Agent pipeline (in order)
1. **Problem Framing** — root cause clarity before any solution thinking
2. **Opportunity Framing** — turns problem into a bounded, measurable opportunity
3. **Story Creation** — generates delivery-ready user stories with testable ACs
4. **Prioritisation** — stack-ranks work by value, risk, and cost of delay
5. **Estimation** — sizes work with confidence ranges, flags unknowns

### Agents, skills, and context
- `agents/` defines runtime identity, sequencing metadata, and model settings
- `skills/` defines reusable method: role, output structure, rules, and governance criteria
- `context/` defines local facts: organisation, product, delivery, and evidence context
- `.claude/agents/` defines Claude Code project subagents for repo workflows

### Agent contract
Every runtime agent file exports:
- `meta` — `{ id, label, description }` used by the dashboard
- `run(client, messages, context)` — calls Sonnet, returns string output
- `govern(client, output)` — calls Haiku, returns `{ passed, score, issues, verdict }`

### Governance loop
- Each agent has up to 3 attempts to produce output that passes governance (score ≥ 70)
- Governance runs as a separate Haiku call — fast, cheap, independent
- On max attempts: user prompted to override or quit
- Session history (all prior agent outputs) is passed as context to each subsequent agent

### Communication (SSE events)
| Event | Payload |
|---|---|
| `pipeline-init` | List of stages |
| `agent-start` | Stage index + id |
| `agent-thinking` | Stage index |
| `agent-output` | Stage index + output text |
| `governance` | Stage index + score + issues + verdict |
| `agent-complete` | Stage index + score + passed flag |
| `override-request` | Stage index + label |
| `pipeline-complete` | Aborted flag + summary |
| `log` | Level (info/warn/error/success/muted) + text |
| `input-request` | Prompt text + type |

---

## Running locally

```bash
npm install
ANTHROPIC_API_KEY=<your-key> npm start
```

Opens at `http://localhost:3000`. Set `PORT` env var to override.

**Requires:** `ANTHROPIC_API_KEY` in environment. No build step.

---

## Adding or modifying agents

1. Create `skills/your-skill/system.md` and `skills/your-skill/governance.md`
2. Create `context/your-agent.md` if that stage needs project-specific context
3. Create `agents/your-agent.js` as a thin wrapper around `createAgent(...)`
4. Import and add it to [pipeline/config.js](/Users/alm1sf/discovery-agent-suite/pipeline/config.js)
5. Optionally add a matching project subagent in `.claude/agents/`

Keep reusable prompting guidance in `skills/`, not in `agents/`. Keep `context/` grounded in local facts, evidence, and constraints.

---

## Known constraints

- Pipeline runs one session at a time (`pipelineRunning` flag — no concurrency)
- Session state is in-memory — lost on server restart
- `max_tokens` per agent is hardcoded — adjust per agent if outputs are being truncated
- No auth on `/start` or `/input` endpoints — not production-hardened
