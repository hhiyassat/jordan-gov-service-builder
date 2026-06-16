import { describe, expect, it } from "vitest";
import { ServiceDefinitionSchema } from "../src/ir/schema.js";

const minimalValidDef = {
  id: "svc-1",
  code: "SRV-001",
  names: { ar: "خدمة تجريبية", en: "Sample Service" },
  entityId: "ent-1",
  departmentId: "dept-1",
  beneficiaryTypeIds: ["citizen"],
  fields: [],
  steps: [
    {
      id: "step-identity",
      kind: "IDENTITY",
      title: { ar: "التحقق من الهوية", en: "Identity Check" },
      isOptional: false,
      estimatedMinutes: 5,
    },
  ],
  states: [
    {
      id: "submitted",
      status: { ar: "تم التقديم", en: "Submitted" },
      statusCode: "submitted",
      isTerminal: false,
    },
    {
      id: "completed",
      status: { ar: "مكتمل", en: "Completed" },
      statusCode: "completed",
      isTerminal: true,
    },
  ],
  initialStateId: "submitted",
  transitions: [
    {
      id: "to-completed",
      from: "submitted",
      to: "completed",
      guard: {
        id: "guard-complete",
        cause: { kind: "always" },
        conditions: [],
        impediments: [],
      },
    },
  ],
};

describe("ServiceDefinitionSchema", () => {
  it("parses a minimal valid definition", () => {
    const parsed = ServiceDefinitionSchema.parse(minimalValidDef);
    expect(parsed.id).toBe("svc-1");
    expect(parsed.steps[0]?.kind).toBe("IDENTITY");
  });

  it("rejects an unknown StepKind", () => {
    const bad = {
      ...minimalValidDef,
      steps: [
        {
          ...minimalValidDef.steps[0],
          kind: "UNKNOWN_KIND",
        },
      ],
    };
    expect(() => ServiceDefinitionSchema.parse(bad)).toThrow();
  });

  it("rejects a missing initialStateId", () => {
    const { initialStateId: _removed, ...withoutInitial } = minimalValidDef;
    expect(() => ServiceDefinitionSchema.parse(withoutInitial)).toThrow();
  });

  it("rejects a bad field type", () => {
    const bad = {
      ...minimalValidDef,
      fields: [
        {
          name: "age",
          label: { ar: "العمر", en: "Age" },
          type: "integer",
          required: true,
        },
      ],
    };
    expect(() => ServiceDefinitionSchema.parse(bad)).toThrow();
  });

  it("parses nested and/not/apiCheck guard predicates", () => {
    const withNestedGuard = {
      ...minimalValidDef,
      transitions: [
        {
          id: "to-completed",
          from: "submitted",
          to: "completed",
          guard: {
            id: "complex-guard",
            cause: { kind: "apiCheck", check: "cspd_lookup_ok" },
            conditions: [
              {
                kind: "and",
                of: [
                  { kind: "fieldPresent", field: "national_id" },
                  {
                    kind: "not",
                    of: { kind: "apiCheck", check: "has_unpaid_fines" },
                  },
                ],
              },
            ],
            impediments: [
              {
                kind: "or",
                of: [
                  { kind: "apiCheck", check: "is_blacklisted" },
                  { kind: "fieldEquals", field: "blocked", value: true },
                ],
              },
            ],
          },
        },
      ],
    };
    const parsed = ServiceDefinitionSchema.parse(withNestedGuard);
    const guard = parsed.transitions[0]?.guard;
    expect(guard?.cause).toEqual({ kind: "apiCheck", check: "cspd_lookup_ok" });
    expect(guard?.conditions[0]?.kind).toBe("and");
    expect(guard?.impediments[0]?.kind).toBe("or");
  });
});
