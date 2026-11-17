import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePending } from "./pending.ts";

/** A promise and the hands that settle it, for a request whose answer the test lets through. */
function held() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("the state of a request that the user started", () => {
  it("is pending until the request ends, and drops the calls made meanwhile", async () => {
    const { result } = renderHook(() => usePending());
    const answer = held();
    let calls = 0;
    const task = () => {
      calls += 1;
      return answer.promise;
    };
    let first!: Promise<void>;
    act(() => {
      first = result.current[1](task);
      // A second call in the same render, before the state could show the request.
      void result.current[1](task);
    });
    expect(result.current[0]).toBe(true);
    act(() => void result.current[1](task));
    expect(calls).toBe(1);
    await act(async () => {
      answer.resolve();
      await first;
    });
    expect(result.current[0]).toBe(false);
    await act(async () => {
      await result.current[1](async () => {
        calls += 1;
      });
    });
    expect(calls).toBe(2);
  });

  it("ends when the request fails, so that it can be tried again", async () => {
    const { result } = renderHook(() => usePending());
    const answer = held();
    let first!: Promise<void>;
    act(() => {
      first = result.current[1](() => answer.promise);
    });
    await act(async () => {
      answer.reject(new Error("down"));
      await first.catch(() => undefined);
    });
    expect(result.current[0]).toBe(false);
    let ran = false;
    await act(async () => {
      await result.current[1](async () => {
        ran = true;
      });
    });
    expect(ran).toBe(true);
  });
});
