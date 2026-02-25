export interface SetupFlags {
  reset: boolean;
  resetOnly: boolean;
  yes: boolean;
}

export function parseSetupFlags(argv: string[]): SetupFlags {
  const flags = new Set(argv);
  const resetOnly = flags.has("--reset-only");
  const reset = flags.has("--reset") || resetOnly;
  const yes = flags.has("--yes") || flags.has("-y");

  return {
    reset,
    resetOnly,
    yes,
  };
}
