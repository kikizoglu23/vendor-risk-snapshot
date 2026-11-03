/**
 * THE LIST OF ACTIVE CHECKS.
 *
 * To add a new check: write a module that exports a `CheckDefinition`
 * (see types.ts) and add it to this array. The API endpoint
 * /api/checks/{id}, the UI columns, the methodology section and the
 * overall score all update automatically.
 */
import { breachesCheck } from "./breaches";
import { emailSecurityCheck } from "./email-security";
import { exposedServicesCheck } from "./exposed-services";
import { ransomwareCheck } from "./ransomware";
import type { CheckDefinition, CheckMeta } from "./types";

export const checks: CheckDefinition[] = [
  ransomwareCheck,
  breachesCheck,
  exposedServicesCheck,
  emailSecurityCheck,
];

export function getCheck(id: string): CheckDefinition | undefined {
  return checks.find((c) => c.id === id);
}

/** Everything except the `run` function, safe to send to the browser. */
export function checkMeta(): CheckMeta[] {
  return checks.map(({ id, name, shortName, question, whyItMatters, weight, sources, limitations }) => ({
    id,
    name,
    shortName,
    question,
    whyItMatters,
    weight,
    sources,
    limitations,
  }));
}
