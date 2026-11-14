import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast, type Toast } from "./toast.tsx";

/** Shows the toast it is given when its button is pressed. */
function Trigger({ toast }: { toast: Toast }) {
  const show = useToast();
  return <button onClick={() => show(toast)}>show</button>;
}

function shown(toast: Toast) {
  render(
    <ToastProvider>
      <Trigger toast={toast} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "show" }));
  return screen.getByRole("status");
}

const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a toast with an action", () => {
  const undo = () => ({ message: "3件を既読にしました", durationMs: 10_000, action: { label: "取り消す", run: vi.fn() } });

  it("is drawn with the strong outline, so that it stands out on the white list and article", () => {
    expect(shown(undo())).toHaveClass("border-outline-strong");
  });

  it("goes away once its time is up", () => {
    shown(undo());
    wait(10_000);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stays while the pointer is over it, and counts its time again from the start once the pointer leaves", () => {
    const status = shown(undo());

    fireEvent.mouseEnter(status);
    wait(30_000);
    expect(screen.getByRole("status")).toBeInTheDocument();

    fireEvent.mouseLeave(status);
    wait(9_000);
    expect(screen.getByRole("status")).toBeInTheDocument();
    wait(1_000);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stays while its button has the focus", () => {
    shown(undo());
    const button = screen.getByRole("button", { name: "取り消す" });

    act(() => button.focus());
    wait(30_000);
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => button.blur());
    wait(10_000);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("runs its action with z and goes away", () => {
    const toast = undo();
    shown(toast);

    fireEvent.keyDown(document.body, { key: "z" });

    expect(toast.action.run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("z without a toast to act on", () => {
  it("does nothing when no toast is shown, or the toast has no action", () => {
    const run = vi.fn();
    shown({ message: "保存しました" });

    fireEvent.keyDown(document.body, { key: "z" });

    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
