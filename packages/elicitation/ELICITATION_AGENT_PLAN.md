## Implementation Plan — Requirements Elicitation Agent (authoring layer)

> **For the AI coding agent (Cursor).** Same operating discipline as `.cursorrules`: one milestone per turn, in order; run `pnpm typecheck && pnpm test` after each; never advance on red; contract-first (types before logic, never invent a name).
>
> **This is the SECOND plan.** Build it only after the core (`IMPLEMENTATION_PLAN.md`) is complete and green. This package is the **authoring layer**: it helps a system administrator turn an *incomplete* requirements document into a *complete, valid* `ServiceDefinition` by interviewing them with grounded clarifying questions. It sits **on top of** the core and never enters the execution path.

---

### 0. Objective & non-negotiable invariants

Take an incomplete requirements document, compute what is missing **relative to the core IR**, ask the admin targeted clarifying questions (grounded in available capabilities and in a curated best-practices checklist), and produce a complete `ServiceDefinition` that passes the core `compile()` and `simulate()` — then hand it to a human for approval.

**Invariants the agent must never violate:**

1. **Completeness is decided by code, not by the model.** "What is missing" is computed deterministically by diffing the draft against the IR's required slots + the best-practices checklist. The LLM never decides whether the requirement is complete.
2. **The LLM has exactly three bounded jobs:** (a) extract an initial draft from the document, (b) phrase a question for a given gap, (c) interpret a free-text answer into a draft slot. Nothing else. It never decides validity, never picks options absent from the registry, never writes code, never publishes.
3. **No invented capabilities.** Every option offered in a question comes from the `CapabilityRegistry`. If a needed capability does not exist, flag the gap for the human ("no available check for this condition — mark manual?"); never fabricate one.
4. **Every LLM call is behind the `LlmClient` interface** and returns **schema-validated** structured output. On parse failure: repair/retry deterministically, never silently accept.
5. **Out of the execution path.** This package depends on the core **read-only**. It never modifies the engine and is never imported by it. Its only output is a draft that must pass `compile()` + `simulate()` and then **explicit human approval** before publishing. The agent never publishes.
6. **Deterministic where it counts.** Gap analysis, the best-practices checklist, and final assembly/validation are pure, fully-tested functions. All tests run with a **fake `LlmClient`** — no real model in CI.
7. **Local-first model.** The LLM runtime is **local Gemma 4**, served on your own infrastructure behind `LlmClient`. Requirement documents and citizen data never leave your infrastructure (data residency / sovereignty). The model is swappable — only the adapter changes; nothing else in the package depends on which model is used.

---

### 1. Tech stack & dependency

- Same stack as the core: TypeScript strict, Node 20+, zod, vitest, pnpm.
- **Depends on the core package** for: `ServiceDefinition` and IR types, `compile`, `simulate`, `SimulationReport`, `ValidationError`. Import them; do not re-implement them.
- **LLM runtime = local Gemma 4** (open-weight, Apache-2.0), served on your own infrastructure via **Ollama** or **vLLM**, behind the `LlmClient` interface. Rationale for a government deployment: requirement documents and citizen data never leave your infrastructure, no per-call cost, full determinism control. The model is used ONLY for the three bounded jobs in §0; all decisions stay deterministic, so a mid-size local model (e.g. Gemma 4 12B / 26B-A4B / 31B) is sufficient.
- Force structured output via **constrained / JSON decoding** (Ollama `format: json`, vLLM guided decoding, or a grammar) and set **temperature 0** (+ fixed seed). Keep the zod validate-and-repair loop — it matters *more* with a smaller local model.
- **Tests never call the real model.** All tests inject the deterministic fake `LlmClient`; no network and no model weights in CI. The Gemma adapter is integration/runtime only.

---

### 2. Project structure (create exactly this)

```
src/
  registry/ types.ts        # CapabilityRegistry: the available options the agent may offer
  draft/
    types.ts                # RequirementDraft: deep-partial ServiceDefinition + provenance/confidence
    schema.ts               # zod
    assemble.ts             # draft -> candidate ServiceDefinition (pure)
  llm/
    client.ts               # LlmClient interface (the ONLY seam to a model)
    fake.ts                 # deterministic, scriptable fake for tests
    gemmaLocal.ts           # LlmClient adapter -> local Gemma 4 (Ollama/vLLM); runtime only, never in tests
  gaps/
    types.ts                # Gap, GapReport, GapKind
    bestPractices.ts        # curated, versioned checklist (pure) — "khitab al-wad' over the requirement"
    analyze.ts              # analyzeGaps = (IR required slots - filled) + bestPractices  (PURE, no LLM)
  extract/ extract.ts       # document -> RequirementDraft (LlmClient; output validated)
  question/ generate.ts     # Gap -> Question (template-first; LLM only polishes phrasing)
  answer/ interpret.ts      # (Gap, answer) -> updated RequirementDraft (LlmClient; validated; ambiguous -> follow-up)
  loop/
    elicit.ts               # orchestrator: analyze -> ask -> interpret -> update -> repeat
    audit.ts                # QAEntry trail
  finalize/ finalize.ts     # compile() + simulate() via core -> ApprovalPackage (needs human approval)
  index.ts
examples/
  incomplete-driving-license.md   # a deliberately incomplete requirement doc
  scripted-answers.json           # admin answers, keyed by gap id, for the e2e test
test/
  gaps.test.ts            # deterministic gap analysis + each best-practice rule (NO LLM)
  interpret.test.ts       # answer -> slot mapping (fake LLM)
  loop.test.ts            # full elicitation loop (fake LLM, scripted answers)
  finalize.e2e.test.ts    # incomplete doc + scripted answers -> ServiceDefinition that compiles & simulates
```

---

### 3. Core contracts (implement the type files FIRST, verbatim)

```typescript
import type {
  ServiceDefinition, Localized, ValidationError, SimulationReport,
} from "<core-package>"; // the package built by IMPLEMENTATION_PLAN.md

// ---------- registry: what the agent is ALLOWED to offer ----------
export type CapabilityRegistry = {
  stepKinds: { kind: string; label: Localized }[];                 // from core StepKind
  identityTypes: { id: string; code: string; label: Localized }[]; // e.g. CSPD, CCD, PSD, Gov, MIT
  apiChecks: { id: string; name: Localized }[];                    // catalog of available boolean checks
  fieldTypes: string[];                                            // from core FieldType
  beneficiaryTypes: { id: string; label: Localized }[];
};

// ---------- draft: an in-progress requirement ----------
export type Provenance = "from_document" | "from_answer" | "default" | "unknown";
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type RequirementDraft = {
  partial: DeepPartial<ServiceDefinition>;
  provenance: Record<string, Provenance>; // key = json-path slot
  confidence: Record<string, number>;     // 0..1 for LLM-extracted slots
  notes: string[];                         // unstructured captures from the document
};

// ---------- gaps: computed deterministically ----------
export type GapKind = "missing_required" | "ambiguous" | "best_practice";
export type Gap = {
  id: string;
  slotPath: string;            // where it belongs in the IR
  kind: GapKind;
  ruleId?: string;             // best-practice rule that raised it (if best_practice)
  prompt: Localized;           // base question text BEFORE optional LLM polishing
  options?: { value: string; label: Localized }[]; // ALWAYS from the registry; never invented
  required: boolean;
};
export type GapReport = { gaps: Gap[]; complete: boolean };

// ---------- LLM seam ----------
export type LlmRequest = { system: string; user: string; schemaName: string };
export interface LlmClient {
  complete(req: LlmRequest): Promise<unknown>; // caller validates result against a zod schema
}

// ---------- questions, answers, output ----------
export type Question = { gapId: string; text: Localized; options?: Gap["options"] };
export type QAEntry = { gapId: string; slotPath: string; question: string; answer: string };
export type ApprovalPackage = {
  service: ServiceDefinition;     // complete; passes core compile()
  simulation: SimulationReport;   // from core simulate()
  audit: QAEntry[];               // full Q&A trail for accountability
};

// ---------- key function signatures (other modules match these exactly) ----------
export function assembleCandidate(draft: RequirementDraft): DeepPartial<ServiceDefinition>; // pure
export function analyzeGaps(draft: RequirementDraft, registry: CapabilityRegistry): GapReport; // PURE, no LLM

export type BestPracticeRule = { id: string; check: (d: RequirementDraft, r: CapabilityRegistry) => Gap[] };
export const bestPracticeRules: BestPracticeRule[]; // curated, versioned, pure

export function extract(doc: string, registry: CapabilityRegistry, llm: LlmClient): Promise<RequirementDraft>;
export function generateQuestion(gap: Gap, llm?: LlmClient): Promise<Question>; // template-first
export function interpretAnswer(
  gap: Gap, answer: string, draft: RequirementDraft, registry: CapabilityRegistry, llm: LlmClient
): Promise<RequirementDraft>; // updates draft; if unmappable, mark slot "ambiguous" -> follow-up gap

export type ElicitIO = { ask: (q: Question) => Promise<string> };
export type ElicitResult = { draft: RequirementDraft; audit: QAEntry[] };
export function elicit(doc: string, registry: CapabilityRegistry, llm: LlmClient, io: ElicitIO): Promise<ElicitResult>;

export function finalize(draft: RequirementDraft):
  | { ok: true; pkg: ApprovalPackage }
  | { ok: false; errors: ValidationError[] };
```

---

### 3a. Worked example (a concrete target — build to match these shapes)

> Paths/field names below are illustrative; align them to the actual core IR in `IMPLEMENTATION_PLAN.md` §3. The point is the *shapes*: a curated catalog → a deterministic rule → a `Gap` → a `Question` → a draft update.

**Prompt catalog** (`question/catalog.ts`) — curated bilingual question text, keyed by slot path or best-practice rule id. The local model never writes these; it may only polish phrasing.

```typescript
import type { Localized } from "<core-package>";

export const promptCatalog: Record<string, Localized> = {
  "steps.identity.identityTypeId": {
    ar: "كيف نتحقّق من هوية مقدّم الطلب؟",
    en: "How should the applicant's identity be verified?",
  },
  "rule:payment-needs-fee": {
    ar: "ما مقدار الرسوم وبأي عملة؟",
    en: "What is the fee amount and currency?",
  },
  "rule:missing-impediments": {
    ar: "هل من مانعٍ يمنع إتمام الخدمة حتى مع استيفاء كل الشروط؟",
    en: "Is there any impediment that blocks the service even when all conditions hold?",
  },
};
```

**Best-practices checklist** (`gaps/bestPractices.ts`, excerpt) — pure functions, no LLM:

```typescript
export const bestPracticeRules: BestPracticeRule[] = [
  {
    id: "payment-needs-fee",
    check: (d, _r) => {
      const hasPayment = (d.partial.steps ?? []).some((s) => s?.kind === "PAYMENT");
      const hasFee = (d.partial.fees ?? []).length > 0;
      return hasPayment && !hasFee
        ? [{
            id: "gap:payment-needs-fee",
            slotPath: "fees[0]",
            kind: "best_practice",
            ruleId: "payment-needs-fee",
            prompt: promptCatalog["rule:payment-needs-fee"],
            required: true,
          }]
        : [];
    },
  },
  {
    id: "missing-impediments",
    check: (d, _r) => {
      const toApproval = (d.partial.transitions ?? []).filter(
        (t) => t?.to === "approved" && (t?.guard?.conditions?.length ?? 0) > 0,
      );
      const lacks = toApproval.some((t) => (t?.guard?.impediments?.length ?? 0) === 0);
      return lacks
        ? [{
            id: "gap:missing-impediments",
            slotPath: "transitions[approve].guard.impediments",
            kind: "best_practice",
            ruleId: "missing-impediments",
            prompt: promptCatalog["rule:missing-impediments"],
            required: false,
          }]
        : [];
    },
  },
];
```

**A concrete `Gap`** — the identity-type slot is required and empty, so `analyzeGaps` raises it; its `options` are taken from `registry.identityTypes` (never invented by the model):

```jsonc
{
  "id": "gap:steps.identity.identityTypeId",
  "slotPath": "steps.identity.identityTypeId",
  "kind": "missing_required",
  "prompt": {
    "ar": "كيف نتحقّق من هوية مقدّم الطلب؟",
    "en": "How should the applicant's identity be verified?"
  },
  "options": [
    { "value": "cspd", "label": { "ar": "مواطن أردني", "en": "Jordanian citizen" } },
    { "value": "ccd",  "label": { "ar": "شركة",        "en": "Company" } },
    { "value": "psd",  "label": { "ar": "غير أردني",   "en": "Non-Jordanian" } }
  ],
  "required": true
}
```

**Rendered as a `Question`** (`generateQuestion`) — content and options copied straight from the `Gap`; the local Gemma model may only smooth the wording, never change meaning or options:

```jsonc
{
  "gapId": "gap:steps.identity.identityTypeId",
  "text": {
    "ar": "كيف نتحقّق من هوية مقدّم الطلب؟ اختر النوع المناسب:",
    "en": "How should the applicant's identity be verified? Choose the type:"
  },
  "options": [
    { "value": "cspd", "label": { "ar": "مواطن أردني", "en": "Jordanian citizen" } },
    { "value": "ccd",  "label": { "ar": "شركة",        "en": "Company" } },
    { "value": "psd",  "label": { "ar": "غير أردني",   "en": "Non-Jordanian" } }
  ]
}
```

**Answer → draft update** (`interpretAnswer`): the admin picks "مواطن أردني" → the local model maps the free text to the option value `"cspd"` (validated against `registry.identityTypes`; if it can't map confidently it marks the slot `ambiguous` instead of guessing) → set `draft.partial.steps[identity].identityTypeId = "cspd"` with provenance `from_answer`. On the next loop, `analyzeGaps` no longer raises this gap.

---

### 4. Milestones (in order; green before next)

**M1 — Registry + Draft model.** Implement `registry/types.ts`, `draft/types.ts`, `draft/schema.ts`, `draft/assemble.ts` (pure: collapse `partial` into a candidate `ServiceDefinition` shape). *Tests:* a partial draft assembles; provenance/confidence preserved; schema rejects malformed drafts.

**M2 — LLM seam (local Gemma 4).** Implement `llm/client.ts` (`LlmClient`), `llm/fake.ts` (deterministic scriptable fake keyed by `schemaName` + input, used by ALL later tests), and `llm/gemmaLocal.ts` (a `LlmClient` adapter calling a local Gemma 4 server via Ollama/vLLM: JSON/constrained decoding on, temperature 0, then validate the raw response against the caller's zod schema and repair-or-throw). *Tests:* the fake returns scripted output and an unscripted call throws (so tests can never depend on a real model). The `gemmaLocal` adapter is integration-only and is **not** exercised in CI.

**M3 — Gap analysis (the heart; deterministic, NO LLM).** Implement `gaps/types.ts`, `gaps/bestPractices.ts`, `gaps/analyze.ts`.
`analyzeGaps` = (1) **structural gaps**: every IR-required slot that `assembleCandidate(draft)` leaves empty, or that core `compile()` reports as missing/unresolved → a `missing_required` gap; plus (2) **best-practice gaps** from `bestPracticeRules`.
Implement these **best-practice rules** (each pure, versioned, with an id) — "khitab al-wad' over the requirement":
- `payment-needs-fee`: a PAYMENT step with no fee → ask amount + currency.
- `approval-needs-approvers`: an APPROVAL step with no approver roles → ask who approves.
- `identity-type-unspecified`: an IDENTITY step without a chosen type → ask, offering registry `identityTypes`.
- `condition-without-check`: an eligibility condition in prose/`notes` not linked to an `apiCheck` → ask which check verifies it (offer registry `apiChecks`) or mark manual.
- `missing-impediments`: a consequential approval transition with conditions but **no impediments** → ask "is there any مانع that should block this even when conditions hold?".
- `rejection-without-validity-policy`: a path to a rejected/terminal state with no curable (fasid) alternative → ask whether rejected applications are correctable or final.
- `special-category-without-concession`: notes mention a special/exempt category but no `Concession` exists → ask whether a رخصة (waiver / shortened path) applies and to whom.
- `missing-bilingual-label`: any user-facing label missing `ar` or `en` → ask for the missing language.
*Tests (`gaps.test.ts`):* each rule has a raising and a non-raising case; `complete === true` only when zero required + zero unresolved-compile gaps. **No LLM here.** *Acceptance:* ≥ 95% coverage on `gaps/`.

**M4 — Extractor (document → draft).** Implement `extract/extract.ts`: a constrained prompt ("map this document onto these IR slots; output JSON for schema X; do not invent values; use null for unknown"), call `LlmClient`, validate against the draft schema, set provenance `from_document` + confidence. *Tests:* with the fake LLM scripted for `examples/incomplete-driving-license.md`, `extract` yields the expected filled/empty slots; malformed LLM output is repaired or rejected.

**M5 — Question generator + Answer interpreter.** `question/generate.ts`: build the question **from the Gap** (text = `gap.prompt`, options = `gap.options`); LLM use optional and limited to natural phrasing — it must not change options or meaning. `answer/interpret.ts`: map the admin's free-text answer to the gap's slot via `LlmClient` (constrained: "choose from these options" / "extract this typed value"), validate against the IR slot type, set provenance `from_answer`; if unmappable, do **not** guess — mark the slot `ambiguous` for a follow-up. *Tests (`interpret.test.ts`):* "citizens" → identity type CSPD; a numeric fee answer fills amount+currency; an unmappable answer yields an ambiguous follow-up, not a wrong value.

**M6 — Elicitation loop + audit.** `loop/elicit.ts`: from the extracted draft, repeat — `analyzeGaps` → if not complete, take the next gap, `generateQuestion`, `io.ask`, `interpretAnswer`, update draft, append `QAEntry` — until `analyzeGaps(...).complete` **and** the assembled candidate passes core `compile()`; remaining `compile()` errors are converted into gaps so they too get asked. Bound the loop (max rounds); surface unresolved ambiguities to the human rather than looping forever. *Tests (`loop.test.ts`):* with fake LLM + `scripted-answers.json`, the loop drives an incomplete draft to complete; the audit records every Q&A; the max-round guard trips on an intentionally unanswerable gap.

**M7 — Finalize → ApprovalPackage (human approves; agent never publishes).** `finalize/finalize.ts`: assemble the final `ServiceDefinition`, run core `compile()` (must be ok) then core `simulate()` against synthetic profiles, return `ApprovalPackage { service, simulation, audit }`. **No publish step exists here** — output is for a human to approve. *Tests (`finalize.e2e.test.ts`):* `examples/incomplete-driving-license.md` + `scripted-answers.json` → a complete `ServiceDefinition` that **compiles and simulates**; the audit explains how each slot was filled. *Acceptance (gate):* the e2e produces a service the core accepts and simulates, with a complete Q&A audit.

---

### 5. Guardrails (enforced)

- LLM only in `extract`, `generateQuestion` (phrasing only), `interpret`. Everywhere else is pure code.
- Gap detection, best-practice rules, assembly, and final validation never call the LLM.
- Every option presented to the admin comes from `CapabilityRegistry`; never fabricate a capability — flag missing ones for the human.
- All LLM outputs validated against zod; failures repaired or surfaced, never silently accepted.
- Depend on the core read-only; never modify or re-implement it; never run in the execution path.
- The package cannot publish; it only emits an `ApprovalPackage` for human approval.
- All tests use the fake `LlmClient`. No network, no real model in CI.

### 6. Definition of done

`pnpm typecheck && pnpm test` green; gap analysis + best-practice rules ≥ 95% coverage; the e2e turns an incomplete document plus scripted answers into a `ServiceDefinition` that passes the core `compile()` and `simulate()`, with a full Q&A audit trail; `src/index.ts` re-exports `analyzeGaps`, `bestPracticeRules`, `extract`, `generateQuestion`, `interpretAnswer`, `elicit`, `finalize`, and the public types.

### 7. Kickoff prompt — paste as your first message
> Read this plan in full and obey `.cursorrules`. The core package (from `IMPLEMENTATION_PLAN.md`) is built and green; depend on it read-only. Do project setup, then implement **Milestone M1 only** (Registry + Draft model) with its tests. Run `pnpm typecheck && pnpm test`, report, and STOP — do not start M2.
