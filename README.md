# Government Services — Engine + Elicitation Agent (scaffold)

A pre-configured **pnpm workspace** so the AI coding agent can go straight to **Milestone M1** with no project-setup step.

## Layout
- `packages/engine` — the deterministic core. **Build this FIRST.** Plan: `packages/engine/IMPLEMENTATION_PLAN.md`.
- `packages/elicitation` — the requirements-elicitation agent. **Build SECOND** (it depends on the engine). Plan: `packages/elicitation/ELICITATION_AGENT_PLAN.md`.
- `.cursorrules` — operating rules for the agent (apply to both packages).

> When a plan says `src/...`, it means **that package's** `src/` (e.g. `packages/engine/src/ir/types.ts`).

## Prerequisites
- Node 20+, pnpm, Cursor.
- *(Phase 2 runtime only)* Ollama + a local Gemma 4 model — **not** needed to start, and **never** needed for tests.

## Start — Phase 1 (the engine)
1. `pnpm install`
2. Open this repo in Cursor.
3. Paste this as your first message:

> The workspace is already scaffolded — do **NOT** run project setup. Obey `.cursorrules`. Work in `packages/engine`. Read `packages/engine/IMPLEMENTATION_PLAN.md` and implement **Milestone M1 only** (the `src/ir` types + zod schema) with its tests. Run `pnpm -F @gov/engine typecheck && pnpm -F @gov/engine test`, report, and **STOP** — do not start M2.

4. Continue one milestone at a time: M2, M3, M4, M5, M6. Keep tests green between milestones.
5. The engine is **done** when `pnpm -F @gov/engine test` is green **and** the three example services (M6) compile + simulate.

## Phase 2 (the elicitation agent) — only after the engine is green
- Read `packages/elicitation/ELICITATION_AGENT_PLAN.md`; build M1 … M7 the same way (`pnpm -F @gov/elicitation ...`).
- Wire **local Gemma 4** only at the end (`src/llm/gemmaLocal.ts`) via Ollama. Tests always use the fake `LlmClient`.

## Important
"Local Gemma 4" is the model the **finished app** calls at runtime — **not** the model Cursor uses to write the code. Use any capable model inside Cursor. The engine package has **no LLM at all**.

## Commands
```
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm -F @gov/engine test
```

> On first `pnpm install` you may see a harmless notice that esbuild's build script was ignored — it does not affect anything (vitest works); you can silence it with `pnpm approve-builds`.

