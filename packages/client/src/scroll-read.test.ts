import { describe, expect, it, vi } from "vitest";
import { createReadQueue, parseScrollRead, passedRows, SCROLL_READ_STORAGE_KEY, type ReadQueueTimers } from "./scroll-read.ts";

type Row = { id: number; isRead: boolean; updatedAt: string };
const rows = (count: number, from = 1): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: from + i, isRead: false, updatedAt: `2026-10-25T09:00:${String(i % 60).padStart(2, "0")}.000Z` }));
const ids = (list: Row[]) => list.map((row) => row.id);

describe("the rows that went past the top of a list", () => {
  it("passes nothing on the first look, whatever is above the top already", () => {
    const list = rows(10);
    expect(passedRows(null, list, 3).passed).toEqual([]);
  });

  it("passes a row that was below the top and is above it now", () => {
    const list = rows(10);
    const first = passedRows(null, list, 0);
    const second = passedRows(first.below, list, 3);
    expect(ids(second.passed)).toEqual([1, 2, 3]);
    expect(passedRows(second.below, list, 3).passed).toEqual([]);
  });

  it("passes every row of a fast scroll that jumps over thirty at once", () => {
    const list = rows(40);
    const first = passedRows(null, list, 0);
    expect(ids(passedRows(first.below, list, 30).passed)).toEqual(ids(list.slice(0, 30)));
  });

  it("does not pass a row it never saw, added at the head of the list above the top", () => {
    const list = rows(10, 11);
    const first = passedRows(null, list, 0);
    const arrived = [...rows(3, 1), ...list];
    // The three new rows went in above; the rows seen before kept their place on screen.
    expect(ids(passedRows(first.below, arrived, 3).passed)).toEqual([]);
    expect(ids(passedRows(first.below, arrived, 5).passed)).toEqual([11, 12]);
  });

  it("leaves out a row that is read already, and one that is excluded", () => {
    const list = rows(5).map((row) => (row.id === 2 ? { ...row, isRead: true } : row));
    const first = passedRows(null, list, 0);
    expect(ids(passedRows(first.below, list, 4, new Set([3])).passed)).toEqual([1, 4]);
  });

  it("passes a row again that is still unread when it comes back below the top and goes above once more", () => {
    const list = rows(5);
    const first = passedRows(null, list, 0);
    const passed = passedRows(first.below, list, 2);
    expect(ids(passed.passed)).toEqual([1, 2]);
    const back = passedRows(passed.below, list, 0);
    expect(ids(passedRows(back.below, list, 2).passed)).toEqual([1, 2]);
  });
});

/** Timers the test moves by hand. */
function manualTimers() {
  let now = 0;
  let serial = 0;
  const pending = new Map<number, { at: number; run: () => void }>();
  const timers: ReadQueueTimers = {
    set(run, ms) {
      serial += 1;
      pending.set(serial, { at: now + ms, run });
      return serial;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    advance(ms: number) {
      now += ms;
      for (const [handle, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(handle);
          timer.run();
        }
      }
    },
  };
}

const seen = (count: number, from = 1) => rows(count, from).map(({ id, updatedAt }) => ({ id, updatedAt }));

describe("the queue that sends the rows that went past", () => {
  function queue(answer: () => Promise<unknown> = () => Promise.resolve({ updated: 0, ids: [] })) {
    const clock = manualTimers();
    const send = vi.fn((_articles: unknown, _options: { keepalive?: boolean }) => answer());
    const onFailed = vi.fn();
    const onSent = vi.fn();
    const q = createReadQueue({ send, onFailed, onSent, timers: clock.timers });
    return { q, clock, send, onFailed, onSent };
  }

  it("sends one second after the last row came, all rows in one request", async () => {
    const s = queue();
    s.q.add(seen(2));
    s.clock.advance(600);
    s.q.add(seen(1, 3));
    s.clock.advance(600);
    expect(s.send).not.toHaveBeenCalled();
    s.clock.advance(400);
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.send.mock.calls[0]![0]).toEqual([...seen(2), ...seen(1, 3)]);
    await vi.waitFor(() => expect(s.onSent).toHaveBeenCalledTimes(1));
  });

  it("sends a row once even when it came twice", () => {
    const s = queue();
    s.q.add(seen(2));
    s.q.add(seen(2));
    s.clock.advance(1000);
    expect(s.send.mock.calls[0]![0]).toEqual(seen(2));
  });

  it("sends at once when a hundred rows have gathered", () => {
    const s = queue();
    s.q.add(seen(60));
    s.q.add(seen(40, 61));
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.send.mock.calls[0]![0]).toHaveLength(100);
    s.clock.advance(1000);
    expect(s.send).toHaveBeenCalledTimes(1);
  });

  it("sends at once without waiting when the list is left, keeping the request alive when asked", () => {
    const s = queue();
    s.q.add(seen(2));
    s.q.flush({ keepalive: true });
    expect(s.send).toHaveBeenCalledWith(seen(2), { keepalive: true });
    s.clock.advance(1000);
    expect(s.send).toHaveBeenCalledTimes(1);
    s.q.flush();
    expect(s.send).toHaveBeenCalledTimes(1);
  });

  it("hands back the rows of a request that failed, and sends them again when asked", async () => {
    let fail = true;
    const s = queue(() => (fail ? Promise.reject(new Error("down")) : Promise.resolve({ updated: 2, ids: [1, 2] })));
    s.q.add(seen(2));
    s.clock.advance(1000);
    await vi.waitFor(() => expect(s.onFailed).toHaveBeenCalledTimes(1));
    expect(s.onFailed.mock.calls[0]![0]).toEqual(seen(2));
    expect(s.onSent).not.toHaveBeenCalled();
    fail = false;
    s.q.retry(seen(2));
    await vi.waitFor(() => expect(s.onSent).toHaveBeenCalledTimes(1));
    expect(s.onSent.mock.calls[0]![0]).toEqual(seen(2));
  });

  it("drops a waiting row that the user put back to unread before it went", () => {
    const s = queue();
    s.q.add(seen(3));
    s.q.drop([2]);
    s.clock.advance(1000);
    expect(s.send.mock.calls[0]![0]).toEqual([seen(3)[0], seen(3)[2]]);
  });

  it("never sends more than the server takes in one request", () => {
    const s = queue();
    s.q.add(seen(1200));
    expect(s.send.mock.calls.map((call) => (call[0] as unknown[]).length)).toEqual([500, 500, 200]);
  });
});

describe("the stored setting", () => {
  it("is stored under a key of its own", () => {
    expect(SCROLL_READ_STORAGE_KEY).toBe("smarternews.scrollRead");
  });

  it("is on only for the value stored when it is on, and off for nothing or anything else", () => {
    expect(parseScrollRead("on")).toBe(true);
    expect(parseScrollRead(null)).toBe(false);
    expect(parseScrollRead("off")).toBe(false);
    expect(parseScrollRead("true")).toBe(false);
  });
});
