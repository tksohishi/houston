import { describe, expect, test } from "bun:test";
import { ChannelQueue } from "../src/queue";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ChannelQueue", () => {
  test("runs jobs sequentially per channel", async () => {
    const queue = new ChannelQueue();
    const events: string[] = [];

    const first = queue.enqueue("a", async () => {
      events.push("first-start");
      await sleep(25);
      events.push("first-end");
      return 1;
    });

    const second = queue.enqueue("a", async () => {
      events.push("second-start");
      await sleep(5);
      events.push("second-end");
      return 2;
    });

    const results = await Promise.all([first, second]);
    expect(results).toEqual([1, 2]);
    expect(events).toEqual(["first-start", "first-end", "second-start", "second-end"]);
  });

  test("runs channels in parallel", async () => {
    const queue = new ChannelQueue();
    const events: string[] = [];

    const a = queue.enqueue("a", async () => {
      events.push("a-start");
      await sleep(60);
      events.push("a-end");
      return "a";
    });

    const b = queue.enqueue("b", async () => {
      events.push("b-start");
      await sleep(10);
      events.push("b-end");
      return "b";
    });

    const results = await Promise.all([a, b]);
    expect(results.sort()).toEqual(["a", "b"]);
    expect(events[0]).toBe("a-start");
    expect(events[1]).toBe("b-start");
    expect(events[2]).toBe("b-end");
    expect(events[3]).toBe("a-end");
  });

  test("continues after a rejected task", async () => {
    const queue = new ChannelQueue();
    const events: string[] = [];

    await expect(
      queue.enqueue("x", async () => {
        events.push("fail");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const result = await queue.enqueue("x", async () => {
      events.push("success");
      return 42;
    });

    expect(result).toBe(42);
    expect(events).toEqual(["fail", "success"]);
  });
});
