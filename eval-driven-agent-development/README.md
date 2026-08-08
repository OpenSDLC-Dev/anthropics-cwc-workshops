<!-- Copyright 2026 Anthropic PBC -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

> **Workshop materials. Not maintained and not accepting contributions.**

# Eval-Driven Agent Development

A hands-on workshop: build an eval for a Claude Managed Agent that generates
slide decks, then iterate the agent against it and see what the eval reveals.

## Requirements

| Tool | Version | Install |
|---|---|---|
| **Node.js** | >=22 | <https://nodejs.org> or `brew install node` |
| **`ant` CLI** | >=1.6.0 | `brew install anthropics/tap/ant` (macOS) — see [docs](https://platform.claude.com/docs/en/api/sdks/cli) for Linux/Windows |
| **Docker** | any recent | <https://www.docker.com/products/docker-desktop/> or OrbStack |
| **Anthropic API key** | — | Get one from <https://platform.claude.com/settings/keys> |

## Setup

```bash
# 1. Clone and install
git clone <REPO_URL>
cd eval-driven-agent-development
npm install

# 2. Authenticate
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Build the render image (LibreOffice in a container — used by the grader)
docker build -t cwc-pptx-render .
```

Check your install:

```bash
node --version    # should be v22.x or higher
ant --version
docker ps         # should not error
```

### Running against a self-hosted control plane

Nothing here is bound to `api.anthropic.com`. Everything below is read from
`.env`, so the workshop drives any **wire-compatible** Managed Agents control
plane — for example [managed-agent-platform](https://github.com/OpenSDLC-Dev/managed-agent-platform)'s
docker-compose stack on your own machine. Leave the variables unset and it goes
back to the hosted API unchanged. See `.env-example` for the full list.

The one thing that is *not* interchangeable: the workshop drives **two**
endpoints. `create-slides.ts` talks to the control plane; the judge graders in
`graders.ts` call the **Messages API**, with vision and a structured result per
slide. A self-hosted deployment serves `/v1/sessions` but not `/v1/messages`,
so the judges need their own endpoint:

```bash
ANTHROPIC_BASE_URL=http://localhost:8080                  # control plane
ANTHROPIC_API_KEY=<that deployment's CONTROLPLANE_API_KEY>
JUDGE_BASE_URL=<a real Anthropic-protocol model endpoint> # judging
JUDGE_API_KEY=<its key>
JUDGE_MODEL=<a model that accepts images>
```

Three more things a self-hosted deployment tends to differ on:

- **`packages:` may be ignored.** The hosted API installs an environment's apt
  and pip lists into the sandbox; a self-hosted one may store the field and
  never act on it, which leaves the agent without `python-pptx`. Bake them into
  the sandbox image instead — `resources/sandbox.Dockerfile` is that image, and
  the executor reads one deployment-wide variable to find it:

  ```bash
  docker build -t cwc-sandbox-pptx -f resources/sandbox.Dockerfile resources
  # then, in the deployment: EXECUTOR_IMAGE=cwc-sandbox-pptx, and restart it
  ```

  Set it before running any session — a deployment that already gave a session
  a sandbox from the old image will refuse to reconcile the difference.

- **Outputs may only be harvested during an outcome cycle.** If
  `/mnt/session/outputs/` is indexed into the Files API only while an outcome
  is being graded, then with no outcome defined the deck is written in the
  sandbox and never indexed, and `create-slides` finds nothing to download.
  `HARVEST_VIA_OUTCOME=1` attaches a minimal one-iteration outcome to each
  session for exactly that reason.

- **Structured outputs may be silently ignored.** `output_config` is a hosted
  feature; an endpoint that accepts and ignores it answers in prose, which
  scores the deck as `NaN` rather than failing loudly. `JUDGE_VIA_TOOL_CALL=1`
  asks for the same schema through a forced tool call instead.

## Running it

The presenter will walk you through these in order, but for reference:

```bash
# Create the cloud environment + agent from YAML, paste the returned IDs
# into src/create-slides.ts (ENVIRONMENT_ID, AGENT_ID, WORKSPACE_ID)
ant beta:environments create < resources/workshop-pptx.environment.yaml
ant beta:agents create        < resources/agent.yaml

# Or, without the CLI — same two API calls, and it writes the returned id
# (and the agent's version) back into the YAML for you. Re-run it after every
# edit to resources/*.yaml: a file that already has an id is updated in place.
npm run deploy
npm run deploy -- agent

# Run the agent on one task
npm run create-slides -- technology
npm run create-slides -- --all

# Render the resulting deck to per-slide JPGs
npm run render -- technology

# Grade it (programmatic checks + LLM judge)
npm run eval -- technology
npm run eval -- --all

# The first time, pass --baseline to record the score as the baseline (future runs will show deltas against this result):
npm run eval -- --all --baseline

# To show the stored baseline eval results again at any point:
npm run show-baseline
```

## Repo layout

```
resources/
  workshop-pptx.environment.yaml   cloud env definition
  agents/00-naive.agent.yaml       baseline agent (and 01-04 for each round)
src/
  create-slides.ts                 starts a CMA session, downloads the pptx
  render.ts                        pptx → JPGs via local Docker
  parse-pptx.ts                    pptx → structural metrics
  graders.ts                       declarative grader definitions (the eval rubric)
  eval-runner.ts                      the harness — runs every grader on every task
tasks.json                         the 5 task prompts (the test set)
runs/                              outputs land here per task
```
