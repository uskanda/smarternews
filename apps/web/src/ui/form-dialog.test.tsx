import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormDialog } from "./FormDialog.tsx";

describe("the dialog that holds a form", () => {
  it("is named by its title, puts the focus in the first field and keeps the one-letter keys off", async () => {
    render(
      <FormDialog open onOpenChange={() => {}} trigger={<button>開く</button>} title="購読フィードを追加">
        <form>
          <label>
            URL
            <input />
          </label>
          <button type="submit">追加</button>
        </form>
      </FormDialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "購読フィードを追加" });
    await waitFor(() => expect(screen.getByLabelText("URL")).toHaveFocus());
    expect(dialog).toHaveAttribute("data-hotkeys", "off");
  });
});
