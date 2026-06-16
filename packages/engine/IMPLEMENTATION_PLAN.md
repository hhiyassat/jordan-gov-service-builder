# Implementation Plan — Declarative Government-Service Engine (Core)

> **For the AI coding agent (Cursor).** Implement this milestone by milestone, in order. After each milestone, run the test suite and do not proceed until it is green. This plan builds a **standalone, deterministic core** (schema + engine + rule evaluator + validator + simulator + 3 proof services). It does **not** touch any existing/production system — integration is a separate, later effort.

---

## 0. Objective & non-negotiable invariants

Build a deterministic engine that **interprets a declarative service definition** and runs an application through a guarded state machine. A "government service" is data (a `ServiceDefinition`), never code. The engine is the only runtime; new services are new definitions, not new code.

**Invariants the agent must never violate:**

1. **No LLM / no AI anywhere in this core.** `engine`, `rules`, `validator`, `simulator` must not import any AI/LLM client. The authoring agent is out of scope here.
2. **Pure & deterministic.** No network calls, no `Date.now()`/`Math.random()` inside decision logic. Inject a `Clock` and any external data (API check results) as plain inputs.
3. **Total typing.** TypeScript `strict` mode. No `any`. No non-null assertions to silence the compiler.
4. **`ServiceDefinition` is the single source of truth.** The engine only *reads* it; it never mutates definitions.
5. **Every module ships with tests.** Rules and engine require exhaustive tests (truth tables, reachability).
6. **Additive mindset.** This is a new isolated package; do not import or modify any pre-existing application code.

---

## 1. Tech stack & setup

- Language: **TypeScript** (strict).
- Runtime: **Node 20+**.
- Validation: **zod**.
- Tests: **vitest**.
- Package manager: **pnpm** (npm acceptable).
- No framework. Pure library + tests.

**Setup task:** initialize `package.json`, `tsconfig.json` (`"strict": true`, `"noUncheckedIndexedAccess": true`), `vitest.config.ts`, scripts: `build`, `typecheck`, `test`, `test:watch`.

---

## 2. Project structure (create exactly this)

```
src/
  ir/
    types.ts        # all IR TypeScript types (the contract — write FIRST)
    schema.ts       # zod schemas mirroring types.ts
    localized.ts    # Localized helper { ar, en }
  rules/
    predicate.ts    # Predicate type eval (pure)
    rule.ts         # evaluateRule: sabab ∧ conditions ∧ ¬impediments
  engine/
    state.ts        # ApplicationState, Validity
    engine.ts       # interpreter: enabledTransitions(), advance()
    audit.ts        # AuditEntry, decision tracing
  validator/
    compile.ts      # schema + referential integrity + completeness + reachability
    errors.ts       # typed validation errors
  simulator/
    profile.ts      # SyntheticApplicant
    simulate.ts     # run engine over profiles, produce SimulationReport
  index.ts
examples/
  driving-license-renewal.json
  business-registration.json
  social-support-with-concession.json
test/
  rules.test.ts
  engine.test.ts
  validator.test.ts
  simulator.test.ts
  examples.e2e.test.ts
```

---

## 3. Core contracts (implement `src/ir/types.ts` FIRST, verbatim names)

> Contract-first: define every name here before writing logic. No other module may invent a name that contradicts these.

```typescript
// ---------- localization ----------
export type Localized = { ar: string; en: string };

// ---------- closed capability registry ----------
// The ONLY step kinds the engine knows how to run. Services compose these; they never add new kinds.
export type StepKind =
  | "IDENTITY"   // GSP identity/entity inquiry
  | "FORM"       // collect custom fields
  | "UPLOAD"     // attachments
  | "PAYMENT"    // fee payment
  | "APPROVAL"   // internal approvals
  | "FEES"       // read-only fee display
  | "DETAILS";   // read-only summary

// ---------- fields (closed type set) ----------
export type FieldType =
  | "text" | "email" | "number" | "phone" | "date" | "textarea" | "select" | "file";

export type FieldDef = {
  name: string;            // english identifier, no spaces, unique within service
  label: Localized;
  type: FieldType;
  required: boolean;
  options?: { value: string; label: Localized }[]; // select only
  validation?: { regex?: string; min?: number; max?: number; maxFileSizeBytes?: number; accept?: string[] };
};

// ---------- predicates (the building blocks of rules) ----------
// Pure boolean expressions over field values and externally-supplied API check results.
export type Predicate =
  | { kind: "always" }
  | { kind: "fieldEquals"; field: string; value: string | number | boolean }
  | { kind: "fieldCompare"; field: string; op: ">" | ">=" | "<" | "<=" | "!=" | "=="; value: number }
  | { kind: "fieldPresent"; field: string }
  | { kind: "apiCheck"; check: string }   // boolean result keyed by name, supplied in EvalContext.apiResults
  | { kind: "and"; of: Predicate[] }
  | { kind: "or"; of: Predicate[] }
  | { kind: "not"; of: Predicate };

// ---------- Rule = khitab al-wad' structure ----------
// السبب / الشرط / المانع
export type Rule = {
  id: string;
  cause: Predicate;          // السبب — trigger that activates the effect
  conditions: Predicate[];   // الشروط — every one must hold (AND)
  impediments: Predicate[];  // الموانع — none may hold (NOR)
};

// ---------- validity dimension (صحة / فساد / بطلان) — orthogonal to the merits decision ----------
export type Validity = "VALID" | "CURABLE" | "VOID"; // صحيح / فاسد (قابل للتصحيح) / باطل

// ---------- steps ----------
export type StepDef = {
  id: string;
  kind: StepKind;
  title: Localized;
  isOptional: boolean;
  estimatedMinutes: number;
  fieldNames?: string[];     // FORM: which fields render here
  apiIds?: string[];         // IDENTITY/checks: which gov APIs this step uses
  approverRoleIds?: string[];// APPROVAL: required approvers
  requiresSignature?: boolean;
  feeIds?: string[];         // PAYMENT/FEES
};

// ---------- guarded state machine ----------
export type StateDef = {
  id: string;
  status: Localized;         // displayed status name
  statusCode: string;        // e.g. "submitted","under_review","approved","rejected","completed"
  isTerminal: boolean;
};

export type TransitionDef = {
  id: string;
  from: string;              // StateDef.id
  to: string;                // StateDef.id
  stepId?: string;           // step this transition is gated behind, if any
  guard: Rule;               // fires only if cause ∧ all conditions ∧ no impediment
  setValidity?: Validity;    // optional effect on validity dimension
};

// ---------- concession (رخصة) vs default path (عزيمة) ----------
export type Concession = {
  id: string;
  label: Localized;
  appliesWhen: Predicate;                  // شروط الترخّص
  overrides: Partial<Pick<ServiceDefinition, "fees" | "steps" | "transitions">>;
};

// ---------- fees ----------
export type FeeDef = { id: string; name: Localized; amount: number; currency: "JOD" };

// ---------- the IR root ----------
export type ServiceDefinition = {
  id: string;
  code: string;
  names: Localized;
  entityId: string;
  departmentId: string;
  beneficiaryTypeIds: string[];
  fields: FieldDef[];
  steps: StepDef[];
  states: StateDef[];
  initialStateId: string;
  transitions: TransitionDef[];
  fees?: FeeDef[];
  concessions?: Concession[]; // azima = base definition; each concession is a guarded override
};
```

**Key function signatures (other modules must match these exactly):**

```typescript
// rules/predicate.ts
export type EvalContext = {
  fields: Record<string, string | number | boolean | undefined>;
  apiResults: Record<string, boolean>; // results of apiCheck, supplied by caller (NOT fetched here)
};
export function evalPredicate(p: Predicate, ctx: EvalContext): boolean;

// rules/rule.ts
export type RuleResult = {
  passed: boolean;
  causePresent: boolean;
  failedConditions: string[];   // human-readable predicate descriptions that failed
  triggeredImpediments: string[];
};
// The master formula:
//   passed ⟺ cause ∧ (∀ conditions) ∧ ¬(∃ impediment)
export function evaluateRule(rule: Rule, ctx: EvalContext): RuleResult;

// engine/engine.ts
export type ApplicationState = {
  stateId: string;
  validity: Validity;
  fields: Record<string, string | number | boolean | undefined>;
  apiResults: Record<string, boolean>;
};
export function enabledTransitions(def: ServiceDefinition, app: ApplicationState): TransitionDef[];
export function advance(def: ServiceDefinition, app: ApplicationState, transitionId: string)
  : { next: ApplicationState; audit: AuditEntry } | { blocked: true; reason: string; audit: AuditEntry };

// validator/compile.ts
export type CompileResult = { ok: true } | { ok: false; errors: ValidationError[] };
export function compile(def: unknown): CompileResult; // zod parse + integrity + completeness + reachability

// simulator/simulate.ts
export function simulate(def: ServiceDefinition, profiles: SyntheticApplicant[]): SimulationReport;
```

---

## 4. Milestones (do in order; each ends green before the next)

### M1 — IR types + zod schema
- Implement `src/ir/types.ts` (exactly as §3), `src/ir/localized.ts`, `src/ir/schema.ts` (zod mirrors of every type; `ServiceDefinitionSchema` parses the root).
- **Tests (`validator.test.ts` partial):** a minimal valid definition parses; a definition with a bad `StepKind`, a missing `initialStateId`, or a malformed field is rejected with a clear error.
- **Acceptance:** `ServiceDefinitionSchema.parse(validDef)` succeeds; invalid inputs throw zod errors.

### M2 — Predicate + Rule evaluator (the heart)
- Implement `src/rules/predicate.ts` (`evalPredicate`, total over the union — exhaustive `switch`, no default fallthrough) and `src/rules/rule.ts` (`evaluateRule` = the master formula).
- `failedConditions` / `triggeredImpediments` must carry readable descriptions (implement a `describePredicate(p): string`).
- **Tests (`rules.test.ts`):** truth tables — cause false ⇒ fail; any condition false ⇒ fail; any impediment true ⇒ fail; all-good ⇒ pass. Cover `and`/`or`/`not`, `fieldCompare` each operator, `apiCheck` missing key (treat missing as `false`, and document it).
- **Acceptance:** ≥ 95% line coverage on `rules/`.

### M3 — Validity + guarded state-machine engine
- Implement `src/engine/state.ts`, `src/engine/audit.ts`, `src/engine/engine.ts`.
- `enabledTransitions` returns transitions from the current state whose `guard` passes.
- `advance` runs the guard; if blocked, returns a reason + audit; if allowed, returns the next state (apply `setValidity`, move to `to`) + an `AuditEntry` recording **why** (cause/conditions/impediments outcome). Status only moves forward is **not** assumed by the engine itself — ordering is encoded in `transitions`; instead enforce: cannot transition out of a terminal state.
- **Tests (`engine.test.ts`):** linear path advances; a blocked guard stays put with a reason; terminal state rejects further transitions; validity is set correctly; audit entries capture the decision.
- **Acceptance:** ≥ 95% coverage on `engine/`; every `advance` produces an `AuditEntry`.

### M4 — Validator / compiler (deterministic, catches errors before publish)
- Implement `src/validator/compile.ts` performing, in order: (1) zod parse; (2) **referential integrity** — every `fieldNames`, `apiIds`, `feeIds`, `from`/`to`, `stepId`, and every predicate `field`/`apiCheck`/`check` reference must resolve to a declared entity; (3) **completeness** — a `PAYMENT` step must reference ≥1 fee; an `APPROVAL` step must list ≥1 approver; `initialStateId` exists; (4) **reachability** — every non-initial state is reachable via transitions, and at least one terminal state is reachable.
- Errors are typed (`ValidationError { code, path, message }`).
- **Tests (`validator.test.ts`):** each rule above has a passing and a failing case.
- **Acceptance:** all checks covered; no check throws — they return structured errors.

### M5 — Simulator
- Implement `src/simulator/profile.ts` (`SyntheticApplicant = { name: string; fields; apiResults; expectedFinalStatusCode?; expectedValidity? }`) and `src/simulator/simulate.ts`.
- `simulate` drives the engine: from `initialStateId`, repeatedly take the **first** enabled transition (deterministic ordering by transition `id`) until terminal or no transition is enabled; record the path; compare to expectations.
- Output `SimulationReport { perProfile: { name; path: string[]; finalStatusCode; validity; ok; mismatch?: string }[]; allPassed: boolean }`.
- **Tests (`simulator.test.ts`):** a profile reaching approval; a profile blocked by an impediment ending non-approved; expectation mismatch reported.
- **Acceptance:** deterministic output for identical inputs.

### M6 — The 3 proof services (the thesis test, in code)
Author three **deliberately divergent** definitions under `examples/` and an end-to-end test (`examples.e2e.test.ts`) that `compile()`s each and `simulate()`s each against built-in synthetic profiles:

1. **`driving-license-renewal.json`** — simple path: IDENTITY → FORM/UPLOAD → PAYMENT → DETAILS. Includes one **impediment** (unpaid fines via `apiCheck`) that blocks issuance.
2. **`business-registration.json`** — multi-approval: IDENTITY → UPLOAD → multiple APPROVAL steps with `requiresSignature`, branching to `rejected` if any approval fails.
3. **`social-support-with-concession.json`** — branching + **concession**: a default (azima) path with a fee, plus a `Concession` waiving the fee when `appliesWhen` (e.g., a category flag) holds.

- **Acceptance (the gate):** all three `compile()` clean **and** all synthetic profiles pass in `simulate()`. If a service cannot be expressed in the current IR, **stop and record the gap** — the IR (§3) must be revised before proceeding, not worked around in code.

---

## 5. Conventions / guardrails for the agent

- Implement modules in milestone order; keep each module importing only from lower layers (`ir` ← `rules` ← `engine`; `validator` and `simulator` depend on `ir`+`engine`).
- Exhaustive `switch` on every discriminated union (`StepKind`, `FieldType`, `Predicate.kind`); use a `never` exhaustiveness check.
- No I/O in `src/` except reading the JSON examples in the e2e test.
- Prefer small pure functions; no classes unless they add real value.
- Write the test file alongside each milestone; never mark a milestone done with failing/!skipped tests.
- Keep all human-facing strings as `Localized` (`ar`/`en`); never hardcode display text in logic.

---

## 6. Definition of done

`pnpm typecheck && pnpm test` is green; all three example services compile and simulate successfully; rules and engine each ≥ 95% coverage; the public API in `src/index.ts` re-exports: `ServiceDefinition`, `compile`, `evaluateRule`, `enabledTransitions`, `advance`, `simulate`, and the IR types.

When done, the deterministic core is proven in isolation. **Next (separate plan, not now):** (a) integrate this engine behind a feature flag into the existing platform; (b) build the authoring agent that *outputs* a `ServiceDefinition` and pipes it through `compile` + `simulate` before a human approves publishing — the agent stays strictly outside this core.
