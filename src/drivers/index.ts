import type { HarnessDriver, HarnessName } from "../harness";
import { claudeDriver } from "./claude";
import { codexDriver } from "./codex";
import { geminiDriver } from "./gemini";

const drivers: Record<HarnessName, HarnessDriver> = {
  claude: claudeDriver,
  codex: codexDriver,
  gemini: geminiDriver,
};

export function getDriver(name: HarnessName): HarnessDriver {
  return drivers[name];
}

export function isHarnessName(value: string): value is HarnessName {
  return value === "claude" || value === "gemini" || value === "codex";
}

export async function checkAvailableDrivers(): Promise<Set<HarnessName>> {
  const names = Object.keys(drivers) as HarnessName[];
  const results = await Promise.all(
    names.map(async (name) => {
      const proc = Bun.spawn(["command", "-v", drivers[name].binary], {
        stdout: "ignore",
        stderr: "ignore",
      });
      const code = await proc.exited;
      return code === 0 ? name : null;
    }),
  );
  return new Set(results.filter((n): n is HarnessName => n !== null));
}

export { claudeDriver } from "./claude";
export { codexDriver } from "./codex";
export { geminiDriver } from "./gemini";
