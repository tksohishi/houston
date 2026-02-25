import { describe, expect, test } from "bun:test";
import { resetConfigAndSessions } from "../src/setup-reset";

describe("setup reset behavior", () => {
  test("removes config and sessions when both exist", () => {
    const files = new Set<string>(["/tmp/config.json", "/tmp/sessions.json"]);

    const outcome = resetConfigAndSessions("/tmp/config.json", "/tmp/sessions.json", {
      exists: (filePath) => files.has(filePath),
      remove: (filePath) => {
        files.delete(filePath);
      },
    });

    expect(outcome).toEqual({
      removedConfig: true,
      removedSessions: true,
    });
    expect(files.size).toBe(0);
  });

  test("handles missing files without failure", () => {
    const files = new Set<string>(["/tmp/config.json"]);

    const outcome = resetConfigAndSessions("/tmp/config.json", "/tmp/sessions.json", {
      exists: (filePath) => files.has(filePath),
      remove: (filePath) => {
        files.delete(filePath);
      },
    });

    expect(outcome).toEqual({
      removedConfig: true,
      removedSessions: false,
    });
    expect(files.size).toBe(0);
  });
});
