import { describe, expect, it } from "vitest";
import type { Rule, ServiceDefinition } from "../src/ir/types.js";
import { advance, enabledTransitions } from "../src/engine/engine.js";
import type { ApplicationState } from "../src/engine/state.js";

function guard(id: string, overrides: Partial<Rule> = {}): Rule {
  return {
    id,
    cause: { kind: "always" },
    conditions: [],
    impediments: [],
    ...overrides,
  };
}

const linearDef: ServiceDefinition = {
  id: "svc-linear",
  code: "LINEAR",
  names: { ar: "خطي", en: "Linear" },
  entityId: "ent-1",
  departmentId: "dept-1",
  beneficiaryTypeIds: ["citizen"],
  fields: [],
  steps: [],
  states: [
    {
      id: "draft",
      status: { ar: "مسودة", en: "Draft" },
      statusCode: "draft",
      isTerminal: false,
    },
    {
      id: "review",
      status: { ar: "مراجعة", en: "Review" },
      statusCode: "review",
      isTerminal: false,
    },
    {
      id: "approved",
      status: { ar: "موافق", en: "Approved" },
      statusCode: "approved",
      isTerminal: true,
    },
  ],
  initialStateId: "draft",
  transitions: [
    {
      id: "t-draft-review",
      from: "draft",
      to: "review",
      guard: guard("g-draft-review"),
    },
    {
      id: "t-review-approved",
      from: "review",
      to: "approved",
      guard: guard("g-review-approved"),
      setValidity: "CURABLE",
    },
  ],
};

const guardedDef: ServiceDefinition = {
  ...linearDef,
  id: "svc-guarded",
  transitions: [
    ...linearDef.transitions,
    {
      id: "t-draft-rejected",
      from: "draft",
      to: "approved",
      guard: guard("g-blocked", {
        cause: { kind: "fieldEquals", field: "eligible", value: true },
        conditions: [{ kind: "fieldPresent", field: "national_id" }],
        impediments: [{ kind: "apiCheck", check: "has_fines" }],
      }),
    },
  ],
};

function app(overrides: Partial<ApplicationState> = {}): ApplicationState {
  return {
    stateId: "draft",
    validity: "VALID",
    fields: {},
    apiResults: {},
    ...overrides,
  };
}

describe("enabledTransitions", () => {
  it("returns passing transitions from the current state sorted by id", () => {
    const enabled = enabledTransitions(guardedDef, app());
    expect(enabled.map((transition) => transition.id)).toEqual([
      "t-draft-review",
    ]);
  });

  it("returns an empty list in a terminal state", () => {
    expect(
      enabledTransitions(guardedDef, app({ stateId: "approved" })),
    ).toEqual([]);
  });

  it("returns an empty list when the current state is unknown", () => {
    expect(
      enabledTransitions(guardedDef, app({ stateId: "missing" })),
    ).toEqual([]);
  });
});

describe("advance", () => {
  it("follows a linear path through multiple states", () => {
    let current = app();

    const first = advance(linearDef, current, "t-draft-review");
    expect("next" in first).toBe(true);
    if (!("next" in first)) {
      throw new Error("expected advance to succeed");
    }
    expect(first.next.stateId).toBe("review");
    expect(first.audit.outcome).toBe("allowed");
    expect(first.audit.rule.passed).toBe(true);
    current = first.next;

    const second = advance(linearDef, current, "t-review-approved");
    expect("next" in second).toBe(true);
    if (!("next" in second)) {
      throw new Error("expected advance to succeed");
    }
    expect(second.next.stateId).toBe("approved");
    current = second.next;

    expect(current.stateId).toBe("approved");
    expect(current.validity).toBe("CURABLE");
  });

  it("blocks a guarded transition and leaves the application in place", () => {
    const current = app({
      fields: { eligible: false },
      apiResults: { has_fines: false },
    });

    const result = advance(guardedDef, current, "t-draft-rejected");
    expect(result).toMatchObject({
      blocked: true,
      reason: "Cause not satisfied",
    });
    expect(result.audit.outcome).toBe("blocked");
    expect(result.audit.toStateId).toBeNull();
    expect(result.audit.validityBefore).toBe("VALID");
    expect(result.audit.validityAfter).toBe("VALID");
    expect(current.stateId).toBe("draft");
  });

  it("reports failed conditions and triggered impediments in blocked reasons", () => {
    const missingId = advance(
      guardedDef,
      app({ fields: { eligible: true }, apiResults: { has_fines: false } }),
      "t-draft-rejected",
    );
    expect(missingId).toMatchObject({
      blocked: true,
      reason: "Failed conditions: fieldPresent(national_id)",
    });

    const fined = advance(
      guardedDef,
      app({
        fields: { eligible: true, national_id: "123" },
        apiResults: { has_fines: true },
      }),
      "t-draft-rejected",
    );
    expect(fined).toMatchObject({
      blocked: true,
      reason: "Triggered impediments: apiCheck(has_fines)",
    });
  });

  it("rejects transitions from a terminal state", () => {
    const result = advance(
      linearDef,
      app({ stateId: "approved" }),
      "t-draft-review",
    );
    expect(result).toMatchObject({
      blocked: true,
      reason: "Cannot transition from terminal state",
    });
    expect(result.audit.outcome).toBe("blocked");
  });

  it("rejects transitions that do not start from the current state", () => {
    const result = advance(linearDef, app(), "t-review-approved");
    expect(result).toMatchObject({
      blocked: true,
      reason: "Transition not enabled from current state",
    });
  });

  it("rejects unknown transition ids", () => {
    const result = advance(linearDef, app(), "missing-transition");
    expect(result).toMatchObject({
      blocked: true,
      reason: "Unknown transition",
    });
    expect(result.audit.transitionId).toBe("missing-transition");
    expect(result.audit.rule.passed).toBe(true);
  });

  it("rejects advances from an unknown current state", () => {
    const result = advance(
      linearDef,
      app({ stateId: "missing" }),
      "t-draft-review",
    );
    expect(result).toMatchObject({
      blocked: true,
      reason: "Unknown current state",
    });
  });

  it("records audit details for allowed and blocked outcomes", () => {
    const allowed = advance(linearDef, app(), "t-draft-review");
    expect("next" in allowed).toBe(true);
    if (!("next" in allowed)) {
      throw new Error("expected advance to succeed");
    }
    expect(allowed.audit).toMatchObject({
      transitionId: "t-draft-review",
      fromStateId: "draft",
      toStateId: "review",
      outcome: "allowed",
      reason: null,
      validityBefore: "VALID",
      validityAfter: "VALID",
    });
    expect(allowed.audit.rule.causePresent).toBe(true);
    expect(allowed.audit.rule.failedConditions).toEqual([]);
    expect(allowed.audit.rule.triggeredImpediments).toEqual([]);

    const blocked = advance(
      guardedDef,
      app({ fields: { eligible: false } }),
      "t-draft-rejected",
    );
    expect(blocked.audit.rule.causePresent).toBe(false);
    expect(blocked.audit.rule.passed).toBe(false);
  });
});
