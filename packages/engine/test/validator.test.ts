import { describe, expect, it } from "vitest";
import { compile } from "../src/validator/compile.js";

const validDef = {
  id: "svc-1",
  code: "SRV-001",
  names: { ar: "خدمة تجريبية", en: "Sample Service" },
  entityId: "ent-1",
  departmentId: "dept-1",
  beneficiaryTypeIds: ["citizen"],
  fields: [
    {
      name: "national_id",
      label: { ar: "الرقم الوطني", en: "National ID" },
      type: "text",
      required: true,
    },
  ],
  fees: [
    {
      id: "fee-1",
      name: { ar: "رسوم", en: "Fee" },
      amount: 10,
      currency: "JOD",
    },
  ],
  steps: [
    {
      id: "step-identity",
      kind: "IDENTITY",
      title: { ar: "التحقق من الهوية", en: "Identity Check" },
      isOptional: false,
      estimatedMinutes: 5,
      apiIds: ["cspd_ok"],
      fieldNames: ["national_id"],
    },
    {
      id: "step-payment",
      kind: "PAYMENT",
      title: { ar: "الدفع", en: "Payment" },
      isOptional: false,
      estimatedMinutes: 10,
      feeIds: ["fee-1"],
    },
    {
      id: "step-approval",
      kind: "APPROVAL",
      title: { ar: "الموافقة", en: "Approval" },
      isOptional: false,
      estimatedMinutes: 15,
      approverRoleIds: ["officer"],
    },
  ],
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
      id: "completed",
      status: { ar: "مكتمل", en: "Completed" },
      statusCode: "completed",
      isTerminal: true,
    },
  ],
  initialStateId: "draft",
  transitions: [
    {
      id: "to-review",
      from: "draft",
      to: "review",
      stepId: "step-identity",
      guard: {
        id: "guard-review",
        cause: { kind: "fieldPresent", field: "national_id" },
        conditions: [{ kind: "apiCheck", check: "cspd_ok" }],
        impediments: [],
      },
    },
    {
      id: "to-completed",
      from: "review",
      to: "completed",
      stepId: "step-payment",
      guard: {
        id: "guard-complete",
        cause: { kind: "always" },
        conditions: [],
        impediments: [],
      },
    },
  ],
};

function expectFailed(
  result: ReturnType<typeof compile>,
  code: string,
  pathFragment?: string,
) {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected compile to fail");
  }
  const match = result.errors.find(
    (error) =>
      error.code === code &&
      (pathFragment === undefined || error.path.includes(pathFragment)),
  );
  expect(match).toBeDefined();
  return match;
}

describe("compile", () => {
  it("accepts a valid definition", () => {
    expect(compile(validDef)).toEqual({ ok: true });
  });

  describe("schema validation", () => {
    it("rejects an unknown StepKind", () => {
      const bad = {
        ...validDef,
        steps: [{ ...validDef.steps[0], kind: "UNKNOWN_KIND" }],
      };
      expectFailed(compile(bad), "SCHEMA", "steps");
    });

    it("rejects a missing initialStateId", () => {
      const { initialStateId: _removed, ...withoutInitial } = validDef;
      expectFailed(compile(withoutInitial), "SCHEMA", "initialStateId");
    });

    it("rejects a malformed field type", () => {
      const bad = {
        ...validDef,
        fields: [{ ...validDef.fields[0], type: "integer" }],
      };
      expectFailed(compile(bad), "SCHEMA", "fields");
    });
  });

  describe("referential integrity", () => {
    it("accepts references that resolve to declared entities", () => {
      expect(compile(validDef).ok).toBe(true);
    });

    it("rejects unknown field references on steps", () => {
      const bad = {
        ...validDef,
        steps: [
          {
            ...validDef.steps[0],
            fieldNames: ["missing_field"],
          },
          ...validDef.steps.slice(1),
        ],
      };
      expectFailed(compile(bad), "REFERENTIAL_INTEGRITY", "fieldNames");
    });

    it("rejects unknown fee references on steps", () => {
      const bad = {
        ...validDef,
        steps: [
          validDef.steps[0],
          { ...validDef.steps[1], feeIds: ["missing-fee"] },
          validDef.steps[2],
        ],
      };
      expectFailed(compile(bad), "REFERENTIAL_INTEGRITY", "feeIds");
    });

    it("rejects unknown state references on transitions", () => {
      const bad = {
        ...validDef,
        transitions: [{ ...validDef.transitions[0], to: "missing-state" }],
      };
      expectFailed(compile(bad), "REFERENTIAL_INTEGRITY", "to");
    });

    it("rejects unknown step references on transitions", () => {
      const bad = {
        ...validDef,
        transitions: [{ ...validDef.transitions[0], stepId: "missing-step" }],
      };
      expectFailed(compile(bad), "REFERENTIAL_INTEGRITY", "stepId");
    });

    it("rejects unknown predicate field references", () => {
      const transition = validDef.transitions[0];
      if (!transition) {
        throw new Error("fixture transition missing");
      }
      const bad = {
        ...validDef,
        transitions: [
          {
            ...transition,
            guard: {
              ...transition.guard,
              cause: { kind: "fieldPresent", field: "missing_field" },
            },
          },
        ],
      };
      expectFailed(compile(bad), "REFERENTIAL_INTEGRITY", "cause.field");
    });

    it("rejects unknown apiCheck references", () => {
      const transition = validDef.transitions[0];
      if (!transition) {
        throw new Error("fixture transition missing");
      }
      const bad = {
        ...validDef,
        transitions: [
          {
            ...transition,
            guard: {
              ...transition.guard,
              conditions: [{ kind: "apiCheck", check: "missing_api" }],
            },
          },
        ],
      };
      expectFailed(compile(bad), "REFERENTIAL_INTEGRITY", "check");
    });

    it("rejects an unknown initial state id", () => {
      const bad = { ...validDef, initialStateId: "missing-state" };
      expectFailed(compile(bad), "REFERENTIAL_INTEGRITY", "initialStateId");
    });

    it("validates nested predicates and concession overrides", () => {
      const withConcession = {
        ...validDef,
        concessions: [
          {
            id: "concession-1",
            label: { ar: "إعفاء", en: "Waiver" },
            appliesWhen: {
              kind: "and",
              of: [
                { kind: "fieldPresent", field: "national_id" },
                { kind: "apiCheck", check: "cspd_ok" },
              ],
            },
            overrides: {
              steps: [
                {
                  id: "override-payment",
                  kind: "PAYMENT",
                  title: { ar: "دفع مخفض", en: "Reduced payment" },
                  isOptional: false,
                  estimatedMinutes: 5,
                  feeIds: ["override-fee"],
                },
              ],
              fees: [
                {
                  id: "override-fee",
                  name: { ar: "رسوم مخفضة", en: "Reduced fee" },
                  amount: 0,
                  currency: "JOD",
                },
              ],
              transitions: [
                {
                  id: "override-transition",
                  from: "draft",
                  to: "completed",
                  stepId: "override-payment",
                  guard: {
                    id: "override-guard",
                    cause: { kind: "always" },
                    conditions: [],
                    impediments: [],
                  },
                },
              ],
            },
          },
        ],
      };
      expect(compile(withConcession).ok).toBe(true);

      const badConcession = {
        ...withConcession,
        concessions: [
          {
            ...withConcession.concessions[0],
            appliesWhen: { kind: "fieldPresent", field: "missing_field" },
          },
        ],
      };
      expectFailed(
        compile(badConcession),
        "REFERENTIAL_INTEGRITY",
        "appliesWhen",
      );
    });
  });

  describe("completeness", () => {
    it("accepts PAYMENT and APPROVAL steps with required references", () => {
      expect(compile(validDef).ok).toBe(true);
    });

    it("rejects PAYMENT steps without fees", () => {
      const bad = {
        ...validDef,
        steps: [
          validDef.steps[0],
          { ...validDef.steps[1], feeIds: [] },
          validDef.steps[2],
        ],
      };
      expectFailed(compile(bad), "COMPLETENESS", "feeIds");
    });

    it("rejects APPROVAL steps without approvers", () => {
      const bad = {
        ...validDef,
        steps: [
          validDef.steps[0],
          validDef.steps[1],
          { ...validDef.steps[2], approverRoleIds: [] },
        ],
      };
      expectFailed(compile(bad), "COMPLETENESS", "approverRoleIds");
    });

    it("rejects a missing initial state declaration", () => {
      const bad = {
        ...validDef,
        initialStateId: "undeclared",
        states: validDef.states.filter((state) => state.id !== "undeclared"),
      };
      const result = compile(bad);
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected compile to fail");
      }
      expect(
        result.errors.some(
          (error) =>
            error.code === "COMPLETENESS" && error.path === "initialStateId",
        ),
      ).toBe(true);
    });
  });

  describe("reachability", () => {
    it("accepts a graph where every state is reachable and a terminal is reachable", () => {
      expect(compile(validDef).ok).toBe(true);
    });

    it("rejects unreachable non-initial states", () => {
      const bad = {
        ...validDef,
        states: [
          ...validDef.states,
          {
            id: "orphan",
            status: { ar: "يتيم", en: "Orphan" },
            statusCode: "orphan",
            isTerminal: false,
          },
        ],
      };
      expectFailed(compile(bad), "REACHABILITY", "orphan");
    });

    it("rejects definitions with no reachable terminal state", () => {
      const bad = {
        ...validDef,
        states: validDef.states.map((state) =>
          state.id === "completed" ? { ...state, isTerminal: false } : state,
        ),
      };
      expectFailed(compile(bad), "REACHABILITY", "states");
    });
  });

  it("never throws for invalid input", () => {
    expect(() => compile(null)).not.toThrow();
    expect(() => compile({})).not.toThrow();
    expect(() => compile(validDef)).not.toThrow();
  });
});
