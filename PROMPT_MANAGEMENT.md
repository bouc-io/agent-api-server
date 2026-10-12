# Prompt Management

How every LLM-facing string in the bouc.io AI system is stored, versioned, read and changed.

## Why this exists

Before this, prompts were inline template literals and Python constants spread across three
services. Three consequences:

1. A prompt change was invisible in review, buried inside a large code diff.
2. Shared text had silently diverged. Three different "do not parrot the context back"
   wordings and four different completion instructions were in production at once, and the
   zero-step direct path was missing the FORMATTING and ASSUMPTIONS blocks entirely, so a
   zero-step answer could return LaTeX while an executor answer could not.
3. Eval results recorded the model and the container image tag but nothing about the
   prompts, so a prompt edit shipped in the same image was unattributable. "Did this change
   help?" was not answerable.

Each service now owns a `prompts/` directory, every unit has an id, a version and a hash,
and the promptset is stamped onto every run and every eval row.

## Principles

**Git is the only write path.** The API and any UI are read-only. A promptset hash
therefore always maps to exactly one commit, which is what keeps eval results reproducible.
Making prompts runtime-editable would trade that away, so it was deliberately rejected.

**No cross-repo sharing.** Each service is self-contained: no shared package, no submodule,
no `libs/`. Of 39 units, 31 live in `agent-api-server`, and once `chatbot-api-server` folds
in there is no sharing boundary left to serve. The duplication between services is two
small codegen files, which is cheaper than any distribution mechanism.

**The hash is the truth, the version is the claim.** `version` is hand-bumped and can be
forgotten. The hashes are computed, so they cannot be.

**No runtime overrides.** `memory-distiller` previously let `PROMPT_SEGMENTATION`,
`PROMPT_WORTHINESS`, `PROMPT_SYNTHESIS`, `PROMPT_SCORING`, `PROMPT_COMBINED_EVAL` and
`SYSTEM_PREAMBLE` replace prompt text from the environment. With any of those set, the
reported hash described text that was not what ran, which silently invalidates a baseline.
They were removed.

## Inventory

**39 units across three services.**

### agent-api-server (31)

13 prompts:

| id | stage | role |
|---|---|---|
| `planner.system` | planner | system |
| `planner.memory-context` | planner | fragment (appended when memories exist) |
| `planner.tool-list` | planner | fragment (appended when tools exist) |
| `planner.nudge` | planner | user (trailing turn) |
| `planner.retry` | planner | system (parse-failure retry) |
| `replanner.system` | replanner | system |
| `replanner.input` | replanner | user |
| `executor.system` | executor | system |
| `executor.summarize-nudge` | executor | user |
| `direct.system` | direct | system (zero-step path) |
| `chat.system` | chat | system |
| `compaction.system` | compaction | system |
| `compaction.summary-wrapper` | compaction | system |

18 fragments, under `prompts/fragments/`. Four are composed into `executor.system` by
include (`security-untrusted`, `tool-error-policy`, `assumptions`, `formatting`); the rest
are selected by the builders at runtime.

### memory-api-server (2)

`compression.system`, `compression.input`. Used when clustering near-duplicate memories
(cosine similarity at or above 0.90) into one.

### memory-distiller (6)

`system_preamble`, `segmentation`, `worthiness`, `synthesis`, `scoring`, `combined_eval`.

## Layout

Identical shape in all three services:

```
prompts/
  promptset.json          # { "version": "1.0.0" }, hand-bumped
  fragments/*.md          # agent-api-server only
  <id>.md                 # one file per unit
  fixtures/default.json   # frozen inputs for /rendered and the goldens
  __snapshots__/*.txt     # committed golden renders
```

Each file carries frontmatter:

```markdown
---
id: executor.system
title: Executor system prompt
version: 1
stage: executor
role: system
includes: [security-untrusted, tool-error-policy, assumptions, formatting]
variables: [instructionPrefix, now, goal, conversationContext, ...]
---
You are executing a plan. Goal: {{goal}}
...
{{> security-untrusted }}
```

`{{name}}` is a variable, substituted at render time. `{{> name }}` is an include, resolved
at build time from `prompts/fragments/name.md`. Includes do not nest.

## How the text reaches the running service

**Node services use build-time codegen.** `prompts:build` reads the markdown and emits
`src/prompts/generated.ts`, which is committed.

This is not an arbitrary choice. `tsconfig.json` emits only `src/**/*.ts`, and the
Dockerfile production stage copies only `dist/`, `node_modules/` and `prisma/`. Markdown
under `src/` would exist at build time and be absent in the container. Compiling the
prompts into a TypeScript module avoids asset copying, runtime file IO, and the
dev-versus-prod path resolution problem in one move.

The generated module also carries `PROMPT_FIXTURE`, for the same reason: `prompts/` is not
in the image, but `/v1/prompts/:id/rendered` needs those inputs.

**memory-distiller reads the markdown directly.** Its Dockerfile is `COPY . .` and
`.dockerignore` excludes only `README.md` and the design doc, so the files ship as-is and
`prompts.py` loads them at import time. No codegen step is needed there.

## Versioning

Two identifiers:

- **`PROMPTSET_VERSION`**, the `version` field in `prompts/promptset.json`. You choose it.
- **`PROMPTSET_HASH`**, a sha256 over the promptset version plus every unit's id, declared
  version and resolved-template hash. Computed.

Because the set hash covers each resolved template, editing a shared fragment moves the set
hash even when no individual file's `version` was bumped. That is the bump-forgetting case,
and it is exactly what the drift gate catches.

**In the Node services the generated module is the lock file.** No separate lock artifact
is needed: `src/prompts/generated.ts` already holds every hash, and it is committed, so
comparing it against a fresh build is the drift check.

**memory-distiller needs an explicit lock**, because it loads markdown at runtime and so
has nothing committed to compare against. `prompts/promptset.lock.json` fills that role.
Regenerate it after an intentional change with `python prompts.py --write-lock`.

### The drift gate

`npm run prompts:check` fails when `generated.ts` no longer matches the markdown. The same
assertion also runs as a unit test (`src/prompts/drift.test.ts`), which means it is
enforced by the existing CI test job with no change to the private `ci-templates` project.

The drift test additionally verifies that no template contains an unresolved include, and
that each file's declared `variables` matches the placeholders its template actually uses.

In `memory-distiller` the equivalent is `tests/test_prompts.py::TestDriftGate`, which
compares the loaded registry against `prompts/promptset.lock.json` and also asserts that
the set hash genuinely depends on template content, so the gate cannot pass vacuously.

### Golden renders

`prompts/__snapshots__/` holds the fully composed text of each prompt, rendered against the
frozen fixture, one file per branch (cli versus web, with versus without memories).

Their purpose is review, not assertion. They make a prompt change show up in a merge
request as a readable before-and-after of what the model actually receives, including the
ripple when a shared fragment is edited: touching `formatting.md` changes
`executor.system`'s golden, and you see that in the diff rather than discovering it in an
eval regression.

Regenerate intentionally with `npx vitest run -u src/prompts` and commit the diff.

## Reading prompts over HTTP

Each service serves its own. There is no aggregation.

The paths nest under each service's existing path family, which is a deliberate choice:
the `api.*` host routes by path prefix, those prefixes are already registered in both the
Istio VirtualService and the oauth2-proxy upstreams, and nesting therefore needs no
infrastructure change and no `clusters/components/` submodule bump.

| service | paths |
|---|---|
| agent-api-server | `/v1/assignments/prompts`, `/v1/assignments/prompts/{id}`, `/v1/assignments/prompts/{id}/rendered`, `/v1/assignments/promptset` |
| memory-api-server | `/v1/memories/prompts`, `/v1/memories/prompts/{id}`, `/v1/memories/prompts/{id}/rendered`, `/v1/memories/promptset` |
| memory-distiller | `/v1/distill/prompts`, `/v1/distill/prompts/{id}`, `/v1/distill/prompts/{id}/rendered`, `/v1/distill/promptset` |

Two routing constraints make this work, and both are load-order dependent, so take care
when editing the mounts:

1. **The prompt router is mounted ahead of the resource router** (`app.use("/v1/assignments",
   promptRoutes)` before `app.use("/v1/assignments", assignmentRoutes)`). Express matches in
   registration order, so the literal `prompts` segment resolves before the resource
   router's `/:id` can capture it. The same pattern already exists in this codebase:
   `/stats` sits before `/:id` in `memory.routes.ts`, and `/health` before `/:id` in
   `assignmentRoutes.ts`. In memory-api this ordering is load-bearing rather than cosmetic,
   because its ids are `@db.Uuid` and a fallthrough would hand Prisma a non-UUID.
2. **The guard is applied per route, never with `router.use()`.** A router-level guard
   would reject every `/v1/assignments/*` request before it could fall through to the
   resource router. Only the four declared prompt paths are guarded; everything else passes
   through untouched.

`/rendered` accepts `?client_type=cli|web` on `agent-api-server` to select the
completion-instruction variant. For the three assembled system prompts
(`executor.system`, `direct.system`, `planner.system`) it calls the real builders, so the
output is what the service actually sends, not an approximation.

For a fragment, `GET /v1/prompts/{id}` returns `included_by`, the list of prompts that pull
it in. That is the question worth asking before editing a fragment.

### Access control

**Any bouc.io staff role** (`BOUC_ROLES`): `bouc_admin`, `bouc_finance`, `bouc_ops`,
`bouc_engineer`, `bouc_sre`, `bouc_user`.

This is deliberately *not* `ADMIN_PORTAL_ROLES`, the usual guard for `/v1/admin` routes.
That group also includes `org_admin` and `org_admin_enterprise`, which are **customer**
administrators, so reusing it would expose the injection-defense and worthiness prompt text
to customers.

Note the consequence of including `bouc_user`: any internal end user, not only staff with
an operational role, can read prompt text. That was an explicit choice over the narrower
`bouc_admin`-only gate, on the grounds that prompts are internal implementation detail
rather than a secret.

`AI_APP_ROLES`, the blanket guard on both `assignmentRoutes` and `memory.routes`, overlaps
`BOUC_ROLES` only at `bouc_user`. The other five staff roles are rejected by it, which is
precisely why the prompt routes live in their own router mounted ahead of those rather than
as routes inside them.

`memory-distiller` had no authentication of any kind before this. `auth.py` adds a
decode-only `bouc_admin` check used solely by the prompt endpoints; `/v1/distill`,
`/health` and `/metrics` are unchanged and remain open. As in the other services the token
is decoded rather than verified, because signature validation happens at the edge, so this
is defence in depth rather than the primary boundary.

## Run and eval provenance

- The `Run` row carries `promptset_version` and `promptset_hash`, captured at completion
  alongside `model_name`.
- `RunStep` index 0 already stored the rendered system prompt; its `output` JSON now also
  carries `prompt_id`, `prompt_hash`, `promptset_version` and `promptset_hash`. A single
  historical run is therefore fully traceable.
- The run API response exposes both fields, which is how the eval harness reads them.
- `run_evals.sh` is schema v3: `promptset_version` and `promptset_hash` sit in the version
  manifest, right after `agent_version`. They are read per row from the run object, like
  `model_name`, so a batch against a deployment that predates stamping records `unknown`
  rather than aborting.

## Changing a prompt

1. Edit the `.md` file.
2. Bump its `version` in the frontmatter, and `prompts/promptset.json` if the change is
   meaningful.
3. `npm run prompts:build` (Node) to regenerate `generated.ts`.
4. `npx vitest run -u src/prompts` to refresh the goldens.
5. Commit the markdown, the regenerated module and the golden diff together. The golden
   diff is the reviewable part.
6. Run evals and compare against the previous promptset hash.

Adding a unit is the same, plus creating the file; the drift test will tell you if the
frontmatter and the template disagree.

## Known divergences, preserved on purpose

The extraction was byte-neutral by design: text moved verbatim, including text that is
wrong. Fixing any of the following changes model output and needs its own eval delta.

- **Three no-parrot wordings**: `frag.no-parrot-executor`, `frag.no-parrot-direct`,
  `frag.no-parrot-chat`. The chat variant only forbids quoting "verbatim", which permits
  paraphrasing the user's profile back at them.
- **Four completion instructions**: `frag.completion-cli` / `-web` and
  `frag.completion-direct-cli` / `-direct-web`. The direct-path pair is terser than the
  executor pair for no recorded reason.
- **`direct.system` has no FORMATTING, ASSUMPTIONS or SECURITY block**, so the most common
  conversational path has the weakest output contract.
- **`executor.system` has no identity line.** Every other stage says what it is.
- **The timestamp sits near the top** of both `executor.system` and `direct.system`, which
  invalidates provider prefix caches on every single run. Moving it below a cache boundary
  is a one-line change with a real latency payoff.
- **`planner.system` states the "restate the user message" rule twice** and
  `planner.nudge` states it a third time, all in negated form, and its 12 few-shot examples
  are skewed toward trivial one-step plans.
- **`frag.strict-rules-header`** renders admin config instructions and auto-distilled
  `instruction`-category memories under one `STRICT RULES (always follow)` header at equal
  authority, with no provenance and no precedence.
- **`compaction.system`** output is re-injected with role `system` by
  `compaction.summary-wrapper`, which strips the `<untrusted_tool_output>` quarantine from
  anything it summarized.
- **MCP tool descriptions are not sanitized** before being rendered into the planner and
  executor tool lists, so an external MCP server can write into a system prompt.
- **`worthiness` and `combined_eval` disagree** in the distiller: the former accepts
  anything whose loss would reduce future quality, the latter requires an explicit user
  statement. `PIPELINE_MODE` therefore changes what gets remembered, not just how many LLM
  calls are made.
- **`scoring`** reserves importance 0.9 for core items and its worked example scores 0.8,
  so the `critical` retrieval tier (which needs 0.9) is rarely populated.
- **`compression.system`** assumes every cluster is "about the same person", which is
  untrue for fact and context memories, and is never told the target category even though
  the caller picks one by majority vote.
