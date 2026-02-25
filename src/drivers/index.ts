import type { HarnessDriver, HarnessName } from "../harness";
import { claudeDriver } from "./claude";
import { geminiDriver } from "./gemini";

const drivers: Record<HarnessName, HarnessDriver> = {
  claude: claudeDriver,
  gemini: geminiDriver,
};

export function getDriver(name: HarnessName): HarnessDriver {
  return drivers[name];
}

export function isHarnessName(value: string): value is HarnessName {
  return value === "claude" || value === "gemini";
}

export { claudeDriver } from "./claude";
export { geminiDriver } from "./gemini";
