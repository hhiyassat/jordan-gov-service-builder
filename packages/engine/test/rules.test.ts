import { describe, expect, it } from "vitest";
import type { Rule } from "../src/ir/types.js";
import { assertNever } from "../src/rules/assertNever.js";
import { describePredicate, evalPredicate, type EvalContext } from "../src/rules/predicate.js";
import { evaluateRule } from "../src/rules/rule.js";

const baseCtx: EvalContext = {
  fields: {
    age: 25,
    status: "active",
    blocked: false,
    national_id: "9981012345",
  },
  apiResults: {
    cspd_ok: true,
    has_fines: false,
  },
};

function rule(overrides: Partial<Rule> & Pick<Rule, "id">): Rule {
  return {
    cause: { kind: "always" },
    conditions: [],
    impediments: [],
    ...overrides,
  };
}

describe("evalPredicate", () => {
  it("always is true", () => {
    expect(evalPredicate({ kind: "always" }, baseCtx)).toBe(true);
  });

  it("fieldEquals matches and mismatches", () => {
    expect(
      evalPredicate(
        { kind: "fieldEquals", field: "status", value: "active" },
        baseCtx,
      ),
    ).toBe(true);
    expect(
      evalPredicate(
        { kind: "fieldEquals", field: "status", value: "inactive" },
        baseCtx,
      ),
    ).toBe(false);
  });

  it("fieldPresent is false for missing or empty string fields", () => {
    expect(
      evalPredicate({ kind: "fieldPresent", field: "national_id" }, baseCtx),
    ).toBe(true);
    expect(
      evalPredicate({ kind: "fieldPresent", field: "missing" }, baseCtx),
    ).toBe(false);
    expect(
      evalPredicate(
        { kind: "fieldPresent", field: "empty" },
        { ...baseCtx, fields: { ...baseCtx.fields, empty: "" } },
      ),
    ).toBe(false);
  });

  it("fieldCompare supports every operator", () => {
    const compare = (
      op: ">" | ">=" | "<" | "<=" | "!=" | "==",
      value: number,
      expected: boolean,
    ) => {
      expect(
        evalPredicate({ kind: "fieldCompare", field: "age", op, value }, baseCtx),
      ).toBe(expected);
    };

    compare(">", 20, true);
    compare(">", 25, false);
    compare(">=", 25, true);
    compare("<", 30, true);
    compare("<=", 25, true);
    compare("!=", 30, true);
    compare("==", 25, true);

    expect(
      evalPredicate(
        { kind: "fieldCompare", field: "status", op: "==", value: 1 },
        baseCtx,
      ),
    ).toBe(false);
  });

  it("apiCheck reads supplied results and treats missing keys as false", () => {
    expect(
      evalPredicate({ kind: "apiCheck", check: "cspd_ok" }, baseCtx),
    ).toBe(true);
    expect(
      evalPredicate({ kind: "apiCheck", check: "has_fines" }, baseCtx),
    ).toBe(false);
    expect(
      evalPredicate({ kind: "apiCheck", check: "unknown_check" }, baseCtx),
    ).toBe(false);
  });

  it("and / or / not compose correctly", () => {
    const ctx = baseCtx;
    expect(
      evalPredicate(
        {
          kind: "and",
          of: [
            { kind: "fieldPresent", field: "national_id" },
            { kind: "not", of: { kind: "apiCheck", check: "has_fines" } },
          ],
        },
        ctx,
      ),
    ).toBe(true);

    expect(
      evalPredicate(
        {
          kind: "or",
          of: [
            { kind: "apiCheck", check: "has_fines" },
            { kind: "fieldEquals", field: "blocked", value: true },
          ],
        },
        ctx,
      ),
    ).toBe(false);

    expect(
      evalPredicate(
        { kind: "not", of: { kind: "fieldEquals", field: "blocked", value: true } },
        ctx,
      ),
    ).toBe(true);
  });

  it("and with no children is vacuously true and or with no children is false", () => {
    expect(evalPredicate({ kind: "and", of: [] }, baseCtx)).toBe(true);
    expect(evalPredicate({ kind: "or", of: [] }, baseCtx)).toBe(false);
  });

  it("assertNever throws for impossible values", () => {
    expect(() => assertNever("unexpected" as never)).toThrow(/Unexpected value/);
  });
});

describe("describePredicate", () => {
  it("renders every primitive predicate kind", () => {
    expect(describePredicate({ kind: "always" })).toBe("always");
    expect(
      describePredicate({ kind: "fieldEquals", field: "x", value: 1 }),
    ).toBe('fieldEquals(x == 1)');
    expect(
      describePredicate({ kind: "fieldCompare", field: "age", op: ">=", value: 18 }),
    ).toBe("fieldCompare(age >= 18)");
    expect(describePredicate({ kind: "fieldPresent", field: "id" })).toBe(
      "fieldPresent(id)",
    );
    expect(describePredicate({ kind: "apiCheck", check: "cspd_ok" })).toBe(
      "apiCheck(cspd_ok)",
    );
    expect(
      describePredicate({
        kind: "or",
        of: [{ kind: "always" }, { kind: "apiCheck", check: "x" }],
      }),
    ).toBe("or(always, apiCheck(x))");
  });

  it("renders nested predicate descriptions", () => {
    const text = describePredicate({
      kind: "and",
      of: [
        { kind: "apiCheck", check: "cspd_ok" },
        { kind: "not", of: { kind: "apiCheck", check: "has_fines" } },
      ],
    });
    expect(text).toBe("and(apiCheck(cspd_ok), not(apiCheck(has_fines)))");
  });
});

describe("evaluateRule", () => {
  it("fails when cause is false", () => {
    const result = evaluateRule(
      rule({
        id: "r1",
        cause: { kind: "fieldEquals", field: "status", value: "inactive" },
      }),
      baseCtx,
    );
    expect(result.causePresent).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.failedConditions).toEqual([]);
    expect(result.triggeredImpediments).toEqual([]);
  });

  it("fails when any condition is false", () => {
    const result = evaluateRule(
      rule({
        id: "r2",
        conditions: [
          { kind: "fieldPresent", field: "national_id" },
          { kind: "fieldEquals", field: "status", value: "inactive" },
        ],
      }),
      baseCtx,
    );
    expect(result.causePresent).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.failedConditions).toEqual([
      'fieldEquals(status == "inactive")',
    ]);
  });

  it("fails when any impediment is true", () => {
    const result = evaluateRule(
      rule({
        id: "r3",
        impediments: [{ kind: "apiCheck", check: "has_fines" }],
      }),
      { ...baseCtx, apiResults: { ...baseCtx.apiResults, has_fines: true } },
    );
    expect(result.passed).toBe(false);
    expect(result.triggeredImpediments).toEqual(["apiCheck(has_fines)"]);
  });

  it("passes when cause, all conditions, and no impediments hold", () => {
    const result = evaluateRule(
      rule({
        id: "r4",
        cause: { kind: "apiCheck", check: "cspd_ok" },
        conditions: [{ kind: "fieldPresent", field: "national_id" }],
        impediments: [{ kind: "apiCheck", check: "has_fines" }],
      }),
      baseCtx,
    );
    expect(result).toEqual({
      passed: true,
      causePresent: true,
      failedConditions: [],
      triggeredImpediments: [],
    });
  });
});
