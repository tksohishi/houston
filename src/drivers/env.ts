import path from "node:path";

function getPathKey(env: Record<string, string | undefined>): string {
  return Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
}

export function withRuntimePath(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const pathKey = getPathKey(env);
  const runtimeBinDir = path.dirname(process.execPath);
  const entries = (env[pathKey] ?? "").split(path.delimiter).filter(Boolean);

  if (!entries.includes(runtimeBinDir)) {
    entries.unshift(runtimeBinDir);
  }

  return {
    ...env,
    [pathKey]: entries.join(path.delimiter),
  };
}
