import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { KEY_STEP } from "../lib/panes.ts";

/**
 * The border on the right of a pane, as a handle: dragging it, or the arrow keys while it has the focus,
 * change the width of the pane; a double click puts the width back. It sits on top of the pane's rule and
 * shows a line of its own only under the pointer or with the focus.
 */
export function PaneResizer({
  label,
  width,
  min,
  max,
  onResize,
  onReset,
}: {
  /** What the handle changes, such as "項目の一覧の幅". */
  label: string;
  width: number;
  min: number;
  /** The largest width the pane can take right now. */
  max: number;
  onResize: (width: number) => void;
  onReset: () => void;
}) {
  // Where the drag began: the pointer's position and the width at that moment.
  const drag = useRef<{ x: number; width: number } | null>(null);
  const within = (next: number) => Math.min(max, Math.max(min, next));

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // Text must not get selected while the border is being moved.
    event.preventDefault();
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (drag.current) onResize(within(drag.current.width + event.clientX - drag.current.x));
  }
  function end() {
    drag.current = null;
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    const next =
      event.key === "ArrowLeft" ? width - KEY_STEP : event.key === "ArrowRight" ? width + KEY_STEP : event.key === "Home" ? min : event.key === "End" ? max : null;
    if (next === null) return;
    event.preventDefault();
    onResize(within(next));
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${width}ピクセル`}
      tabIndex={0}
      title="ドラッグで幅を変える。ダブルクリックで元の幅に戻す"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={key}
      className="pane-resizer"
    />
  );
}
