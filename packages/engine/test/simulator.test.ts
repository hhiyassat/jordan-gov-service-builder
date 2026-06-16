import { describe, expect, it } from "vitest";
import type { Rule, ServiceDefinition } from "../src/ir/types.js";
import type { SyntheticApplicant } from "../src/simulator/profile.js";
import { simulate } from "../src/simulator/simulate.js";

function guard(id: string, overrides: Partial<Rule> = {}): Rule {
  return {
    id,
    cause: { kind: "always" },
    conditions: [],
    impediments: [],
    ...overrides,
  };
}

const approvalService: ServiceDefinition = {
  id: "svc-approval",
  code: "APPROVAL",
  names: { ar: "موافقة", en: "Approval" },
  entityId: "ent-1",
  departmentId: "dept-1",
  beneficiaryTypeIds: ["citizen"],
  fields: [],
  steps: [
    {
      id: "step-identity",
      kind: "IDENTITY",
      title: { ar: "التحقق", en: "Identity" },
      isOptional: false,
      estimatedMinutes: 5,
      apiIds: ["cspd_ok"],
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
      guard: guard("g-draft-review", {
        conditions: [{ kind: "apiCheck", check: "cspd_ok" }],
      }),
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

const impedimentService: ServiceDefinition = {
  ...approvalService,
  id: "svc-impediment",
  states: [
    {
      id: "draft",
      status: { ar: "مسودة", en: "Draft" },
      statusCode: "draft",
      isTerminal: false,
    },
    {
      id: "approved",
      status: { ar: "موافق", en: "Approved" },
      statusCode: "approved",
      isTerminal: true,
    },
    {
      id: "rejected",
      status: { ar: "مرفوض", en: "Rejected" },
      statusCode: "rejected",
      isTerminal: true,
    },
  ],
  transitions: [
    {
      id: "t-draft-approved",
      from: "draft",
      to: "approved",
      guard: guard("g-draft-approved", {
        impediments: [{ kind: "apiCheck", check: "has_fines" }],
      }),
    },
    {
      id: "t-draft-rejected",
      from: "draft",
      to: "rejected",
      guard: guard("g-draft-rejected"),
    },
  ],
};

describe("simulate", () => {
  it("drives a profile through to approval", () => {
    const profiles: SyntheticApplicant[] = [
      {
        name: "eligible-applicant",
        fields: {},
        apiResults: { cspd_ok: true },
        expectedFinalStatusCode: "approved",
        expectedValidity: "CURABLE",
      },
    ];

    const report = simulate(approvalService, profiles);

    expect(report.allPassed).toBe(true);
    expect(report.perProfile[0]).toEqual({
      name: "eligible-applicant",
      path: ["draft", "review", "approved"],
      finalStatusCode: "approved",
      validity: "CURABLE",
      ok: true,
      mismatch: undefined,
    });
  });

  it("ends on a non-approved terminal state when an impediment blocks the preferred path", () => {
    const profiles: SyntheticApplicant[] = [
      {
        name: "fined-applicant",
        fields: {},
        apiResults: { has_fines: true },
        expectedFinalStatusCode: "rejected",
      },
    ];

    const report = simulate(impedimentService, profiles);

    expect(report.allPassed).toBe(true);
    expect(report.perProfile[0]).toMatchObject({
      name: "fined-applicant",
      path: ["draft", "rejected"],
      finalStatusCode: "rejected",
      validity: "VALID",
      ok: true,
    });
  });

  it("reports expectation mismatches", () => {
    const profiles: SyntheticApplicant[] = [
      {
        name: "wrong-expectation",
        fields: {},
        apiResults: { cspd_ok: true },
        expectedFinalStatusCode: "rejected",
        expectedValidity: "VOID",
      },
    ];

    const report = simulate(approvalService, profiles);

    expect(report.allPassed).toBe(false);
    expect(report.perProfile[0]?.ok).toBe(false);
    expect(report.perProfile[0]?.mismatch).toBe(
      "expected status code rejected, got approved; expected validity VOID, got CURABLE",
    );
  });

  it("returns deterministic output for identical inputs", () => {
    const profiles: SyntheticApplicant[] = [
      {
        name: "eligible-applicant",
        fields: {},
        apiResults: { cspd_ok: true },
      },
    ];

    const first = simulate(approvalService, profiles);
    const second = simulate(approvalService, profiles);

    expect(second).toEqual(first);
  });

  it("stops when no transition is enabled", () => {
    const profiles: SyntheticApplicant[] = [
      {
        name: "stuck-applicant",
        fields: {},
        apiResults: { cspd_ok: false },
      },
    ];

    const report = simulate(approvalService, profiles);

    expect(report.perProfile[0]).toMatchObject({
      path: ["draft"],
      finalStatusCode: "draft",
      validity: "VALID",
      ok: true,
    });
  });

  it("reports ok:false when an always-guard cycle prevents termination", () => {
    const cyclicService: ServiceDefinition = {
      ...approvalService,
      id: "svc-cycle",
      states: [
        {
          id: "a",
          status: { ar: "أ", en: "A" },
          statusCode: "a",
          isTerminal: false,
        },
        {
          id: "b",
          status: { ar: "ب", en: "B" },
          statusCode: "b",
          isTerminal: false,
        },
      ],
      initialStateId: "a",
      transitions: [
        {
          id: "t-a-b",
          from: "a",
          to: "b",
          guard: guard("g-a-b"),
        },
        {
          id: "t-b-a",
          from: "b",
          to: "a",
          guard: guard("g-b-a"),
        },
      ],
    };

    const report = simulate(cyclicService, [
      { name: "cyclist", fields: {}, apiResults: {} },
    ]);

    expect(report.allPassed).toBe(false);
    expect(report.perProfile[0]?.ok).toBe(false);
    expect(report.perProfile[0]?.mismatch).toContain("cycle");
  });
});
