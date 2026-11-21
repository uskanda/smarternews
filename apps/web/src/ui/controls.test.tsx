import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Loading } from "./controls.tsx";

describe("the loading line", () => {
  it("is read out as a status, not only shown", () => {
    render(<Loading />);
    expect(screen.getByRole("status")).toHaveTextContent(/^読み込み中…$/);
  });
});
