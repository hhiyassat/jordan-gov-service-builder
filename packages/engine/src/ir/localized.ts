import type { Localized } from "./types.js";

export type { Localized };

export function localized(ar: string, en: string): Localized {
  return { ar, en };
}
