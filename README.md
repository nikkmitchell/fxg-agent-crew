# FXG Agent Crew

A visual workroom for watching a coordinated team of software agents plan, build, review, and ship.

## Current milestone

Version `0.1` is a polished local-first Mission Control prototype. It uses a deterministic event simulator to demonstrate agent state, handoffs, evidence, operator direction, and a live work ledger before any real runtime is connected.

## Run locally

```bash
pnpm install
pnpm dev
```

Production check:

```bash
pnpm build
pnpm preview
```

## Product principles

- The work—not the agents' personalities—is the visual hero.
- Every status links to evidence, a decision, or an operator action.
- The UI consumes a normalized event stream so mock and live runtimes remain interchangeable.
- External credentials and private keys never enter the event log.

## Planned phases

1. Functional event reducer and deterministic mission composer.
2. Artifact review, dependency graph, persistence, and automated flows.
3. Live runtime adapters and repository workflows.
4. WebHarness adapter and port-443-compatible hosted-agent onboarding.
