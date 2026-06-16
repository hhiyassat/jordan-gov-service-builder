import { advance, enabledTransitions } from "../engine/engine.js";
import type { ApplicationState } from "../engine/state.js";
import type { ServiceDefinition, Validity } from "../ir/types.js";
import type { SyntheticApplicant } from "./profile.js";

export type ProfileSimulationResult = {
  name: string;
  path: string[];
  finalStatusCode: string;
  validity: Validity;
  ok: boolean;
  mismatch?: string;
};

export type SimulationReport = {
  perProfile: ProfileSimulationResult[];
  allPassed: boolean;
};

function findStateStatusCode(
  def: ServiceDefinition,
  stateId: string,
): string {
  const state = def.states.find((item) => item.id === stateId);
  return state?.statusCode ?? "unknown";
}

function isTerminalState(def: ServiceDefinition, stateId: string): boolean {
  const state = def.states.find((item) => item.id === stateId);
  return state?.isTerminal ?? false;
}

function compareExpectations(
  profile: SyntheticApplicant,
  finalStatusCode: string,
  validity: Validity,
): { ok: boolean; mismatch?: string } {
  const mismatches: string[] = [];

  if (
    profile.expectedFinalStatusCode !== undefined &&
    profile.expectedFinalStatusCode !== finalStatusCode
  ) {
    mismatches.push(
      `expected status code ${profile.expectedFinalStatusCode}, got ${finalStatusCode}`,
    );
  }

  if (
    profile.expectedValidity !== undefined &&
    profile.expectedValidity !== validity
  ) {
    mismatches.push(
      `expected validity ${profile.expectedValidity}, got ${validity}`,
    );
  }

  if (mismatches.length === 0) {
    return { ok: true };
  }

  return { ok: false, mismatch: mismatches.join("; ") };
}

function runProfile(
  def: ServiceDefinition,
  profile: SyntheticApplicant,
): ProfileSimulationResult {
  let app: ApplicationState = {
    stateId: def.initialStateId,
    validity: "VALID",
    fields: { ...profile.fields },
    apiResults: { ...profile.apiResults },
  };

  const path = [app.stateId];

  while (!isTerminalState(def, app.stateId)) {
    const enabled = enabledTransitions(def, app);
    if (enabled.length === 0) {
      break;
    }

    const transition = enabled[0];
    if (transition === undefined) {
      break;
    }

    const result = advance(def, app, transition.id);
    if ("blocked" in result) {
      break;
    }

    app = result.next;
    path.push(app.stateId);
  }

  const finalStatusCode = findStateStatusCode(def, app.stateId);
  const expectations = compareExpectations(
    profile,
    finalStatusCode,
    app.validity,
  );

  return {
    name: profile.name,
    path,
    finalStatusCode,
    validity: app.validity,
    ok: expectations.ok,
    mismatch: expectations.mismatch,
  };
}

export function simulate(
  def: ServiceDefinition,
  profiles: SyntheticApplicant[],
): SimulationReport {
  const perProfile = profiles.map((profile) => runProfile(def, profile));

  return {
    perProfile,
    allPassed: perProfile.every((result) => result.ok),
  };
}
