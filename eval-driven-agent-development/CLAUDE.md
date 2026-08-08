# Prerequisites

When asked to setup the folder/repository, make sure the prerequisites listed in the README.md are met (Node >=22 installed, Docker installed, `ANTHROPIC_API_KEY` set in environment). Do not deploy the resources yet.
Offer to install them for the user if missing (if Docker is missing, point them to the installation website)
Kick off `docker build -t cwc-pptx-render .` asap in a subagent to make sure the docker image is pre-built.

The `ant` CLI is optional — `npm run deploy` makes the same API calls (see below). Only install it if the user asks for it.

Write the `ANTHROPIC_API_KEY` from your environment into a `.env` file for reference (in case your terminal gets reopened and loses it). Do not override it though if the `.env` file already consists with a key inside — it may hold a self-hosted deployment's key plus a separate judge endpoint, none of which is in your environment. See `.env-example`.

# Repository structure

Assume you're at the workshop unless told otherwise.

- `resources/` contains the agent and environment definition. All changes to the agent will be made here.
- `solutions/` contains **solutions** for evolved agent definitions. Do not reference these unless explicitly asked. If asked, do no deploy these agents directly, copy the system prompt changes over to `resources/agent.yaml` and iterate on that agent.
- `src/eval-runner.ts` is the eval runner. It should not be modified during the workshop.
- `src/graders.ts` is where the eval graders leave. Add more graders here when asked.
- `src/graders/...` contains the **solutions** to graders. Don't import these unless asked to, default to adding new graders to `graders.ts`. You may get asked at some point to import the predefined graders so we're all on the same base.

# YAML resources

Deploy them with `npm run deploy` — both resources, or `npm run deploy -- agent` / `-- environment` for one. The same command creates and updates: a YAML file with no `id` is created, one that has an `id` is updated in place. Use it for the initial setup and after every edit to `resources/*.yaml`.

It writes the bookkeeping back into the YAML itself, so there is nothing to copy by hand:

```diff
+ id: agent_abc123...
+ version: 1
  name: workshop-pptx-01-polish
```

An agent update is optimistically concurrent, so `version` has to be present and current — the script bumps it from each response. Environments are not versioned and only get an `id`.

Then set `AGENT_ID` and `ENVIRONMENT_ID` in `.env`, or update the constants in `src/create-slides.ts` — the environment wins when both are set. The command prints both lines ready to paste.

If the user has the `ant` CLI and prefers it, these are the equivalent calls — but then the `id` / `version` write-back above is yours to do by hand:

```bash
ant beta:agents create < ./resources/agent.yaml
ant beta:agents update < ./resources/agent.yaml
```

# Troubleshooting

If a resource suddenly gives a 404, you were probably ran in a different terminal.
Load the `ANTHROPIC_API_KEY` from the `.env` file.

Two failure modes against a self-hosted control plane are silent — they produce a scorecard rather than an error, so check them before believing a bad result:

- **Every judge column reads `-` or `NaN`.** The judge endpoint accepted `output_config` and answered in prose instead of a score. Set `JUDGE_VIA_TOOL_CALL=1`.
- **`Produced result` is `missing` but the agent said it wrote the file.** Either the sandbox image has no `python-pptx` (the deployment may ignore the environment's `packages:`), or the outputs were never harvested into the Files API (`HARVEST_VIA_OUTCOME=1`). Read the run's `session.json` — a `session.error` event names a model-routing failure, which otherwise only surfaces as a `retries_exhausted` idle.


# Git operations

DO NOT COMMIT ANYTHING UNLESS EXPLICITLY ASKED BY THE USER.

# TypeScript Code Style

- Never add an explicit type guard signature to predicates like `.filter((x): x is Foo => x !== null)`. TypeScript infers type guards in latest versions, it's enough to write `.filter((x) => x !== null)` which is more type safe.
- Don't use `export default`, always name exports

# License headers

All `.ts` files need to have this license header at the top:

```
// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0
```
