// "Always allow": the requests a person said yes to for good, kept in ~/.airband/station-rules.json
// as keys made by ruleKey (reply.ts). The newest RULES_MAX are kept.
import { airbandFile, writeFileAtomic } from "../core/paths";
import { readJson } from "../core/json";

const rulesFile = () => airbandFile("station-rules.json");
const RULES_MAX = 500;

export function readRules(): string[] {
  return readJson<string[]>(rulesFile(), []);
}

/** Keeps "always allow" for this exact request: same agent, folder, tool and input. */
export function rememberRule(rule: string): void {
  const rules = readRules();
  if (!rules.includes(rule)) writeFileAtomic(rulesFile(), JSON.stringify([...rules, rule].slice(-RULES_MAX)));
}
