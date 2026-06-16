import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ServiceDefinition } from "../src/ir/types.js";
import type { SyntheticApplicant } from "../src/simulator/profile.js";
import { simulate } from "../src/simulator/simulate.js";
import { compile } from "../src/validator/compile.js";

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), "../examples");

function loadExample(filename: string): unknown {
  const raw = readFileSync(join(examplesDir, filename), "utf8");
  return JSON.parse(raw) as unknown;
}

function expectCompiled(def: unknown): ServiceDefinition {
  const result = compile(def);
  if (!result.ok) {
    throw new Error(
      `expected compile to succeed:\n${result.errors
        .map((error) => `${error.code} ${error.path}: ${error.message}`)
        .join("\n")}`,
    );
  }
  return def as ServiceDefinition;
}

describe("proof service examples (M6 gate)", () => {
  describe("driving-license-renewal.json", () => {
    const def = expectCompiled(loadExample("driving-license-renewal.json"));

    it("compiles cleanly", () => {
      expect(compile(def).ok).toBe(true);
    });

    it("simulates a clean renewal through issuance", () => {
      const profiles: SyntheticApplicant[] = [
        {
          name: "clean-applicant",
          fields: {
            national_id: "9981012345",
            license_number: "DL-12345",
            medical_certificate: "medical.pdf",
          },
          apiResults: {
            cspd_ok: true,
            license_valid: true,
            has_unpaid_fines: false,
          },
          expectedFinalStatusCode: "completed",
        },
      ];

      const report = simulate(def, profiles);
      expect(report.allPassed).toBe(true);
      expect(report.perProfile[0]?.path).toEqual([
        "submitted",
        "identity_verified",
        "application_complete",
        "documents_complete",
        "payment_complete",
        "completed",
      ]);
    });

    it("simulates an applicant blocked by unpaid fines", () => {
      const profiles: SyntheticApplicant[] = [
        {
          name: "fined-applicant",
          fields: {
            national_id: "9981012345",
            license_number: "DL-12345",
            medical_certificate: "medical.pdf",
          },
          apiResults: {
            cspd_ok: true,
            license_valid: true,
            has_unpaid_fines: true,
          },
          expectedFinalStatusCode: "blocked_unpaid_fines",
        },
      ];

      const report = simulate(def, profiles);
      expect(report.allPassed).toBe(true);
      expect(report.perProfile[0]?.path).toEqual([
        "submitted",
        "identity_verified",
        "application_complete",
        "documents_complete",
        "payment_complete",
        "blocked_unpaid_fines",
      ]);
    });
  });

  describe("business-registration.json", () => {
    const def = expectCompiled(loadExample("business-registration.json"));

    it("compiles cleanly", () => {
      expect(compile(def).ok).toBe(true);
    });

    it("simulates dual approvals through to approved", () => {
      const profiles: SyntheticApplicant[] = [
        {
          name: "approved-business",
          fields: {
            national_id: "9981012345",
            commercial_registration_doc: "cr.pdf",
          },
          apiResults: {
            cspd_ok: true,
            dept_approval_ok: true,
            municipal_approval_ok: true,
          },
          expectedFinalStatusCode: "approved",
        },
      ];

      const report = simulate(def, profiles);
      expect(report.allPassed).toBe(true);
      expect(report.perProfile[0]?.path).toEqual([
        "submitted",
        "identity_verified",
        "documents_submitted",
        "pending_dept_approval",
        "pending_municipal_approval",
        "approved",
      ]);
    });

    it("simulates rejection when department approval fails", () => {
      const profiles: SyntheticApplicant[] = [
        {
          name: "dept-rejected-business",
          fields: {
            national_id: "9981012345",
            commercial_registration_doc: "cr.pdf",
          },
          apiResults: {
            cspd_ok: true,
            dept_approval_ok: false,
          },
          expectedFinalStatusCode: "rejected",
        },
      ];

      const report = simulate(def, profiles);
      expect(report.allPassed).toBe(true);
      expect(report.perProfile[0]?.path).toEqual([
        "submitted",
        "identity_verified",
        "documents_submitted",
        "pending_dept_approval",
        "rejected",
      ]);
    });

    it("simulates rejection when municipal approval fails", () => {
      const profiles: SyntheticApplicant[] = [
        {
          name: "municipal-rejected-business",
          fields: {
            national_id: "9981012345",
            commercial_registration_doc: "cr.pdf",
          },
          apiResults: {
            cspd_ok: true,
            dept_approval_ok: true,
            municipal_approval_ok: false,
          },
          expectedFinalStatusCode: "rejected",
        },
      ];

      const report = simulate(def, profiles);
      expect(report.allPassed).toBe(true);
      expect(report.perProfile[0]?.path).toEqual([
        "submitted",
        "identity_verified",
        "documents_submitted",
        "pending_dept_approval",
        "pending_municipal_approval",
        "rejected",
      ]);
    });
  });

  describe("social-support-with-concession.json", () => {
    const def = expectCompiled(loadExample("social-support-with-concession.json"));

    it("compiles cleanly", () => {
      expect(compile(def).ok).toBe(true);
    });

    it("simulates the default azima path with payment", () => {
      const profiles: SyntheticApplicant[] = [
        {
          name: "standard-beneficiary",
          fields: {
            category: "standard",
            household_size: 4,
          },
          apiResults: { eligibility_ok: true },
          expectedFinalStatusCode: "completed",
        },
      ];

      const report = simulate(def, profiles);
      expect(report.allPassed).toBe(true);
      expect(report.perProfile[0]?.path).toEqual([
        "submitted",
        "intake_complete",
        "assessed",
        "awaiting_payment",
        "completed",
      ]);
    });

    it("simulates the concession path that waives payment", () => {
      const profiles: SyntheticApplicant[] = [
        {
          name: "low-income-beneficiary",
          fields: {
            category: "low_income",
            household_size: 6,
          },
          apiResults: { eligibility_ok: true },
          expectedFinalStatusCode: "completed",
        },
      ];

      const report = simulate(def, profiles);
      expect(report.allPassed).toBe(true);
      expect(report.perProfile[0]?.path).toEqual([
        "submitted",
        "intake_complete",
        "assessed",
        "waiver_granted",
        "completed",
      ]);
    });
  });
});
