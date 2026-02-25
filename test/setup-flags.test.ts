import { describe, expect, test } from "bun:test";
import { parseSetupFlags } from "../src/setup-flags";

describe("setup flag parsing", () => {
  test("no flags means no reset", () => {
    expect(parseSetupFlags([])).toEqual({
      reset: false,
      resetOnly: false,
      yes: false,
    });
  });

  test("reset flag enables reset", () => {
    expect(parseSetupFlags(["--reset"])).toEqual({
      reset: true,
      resetOnly: false,
      yes: false,
    });
  });

  test("reset only implies reset", () => {
    expect(parseSetupFlags(["--reset-only"])).toEqual({
      reset: true,
      resetOnly: true,
      yes: false,
    });
  });

  test("yes aliases are parsed", () => {
    expect(parseSetupFlags(["--reset", "--yes"])).toEqual({
      reset: true,
      resetOnly: false,
      yes: true,
    });
    expect(parseSetupFlags(["--reset", "-y"])).toEqual({
      reset: true,
      resetOnly: false,
      yes: true,
    });
  });
});
