import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "./controls.tsx";
import { FormDialog, useDialogCancel } from "./FormDialog.tsx";
import { useUnsaved } from "./unsaved.tsx";

/** A field that tells the dialog it holds input once something is written, and a button that cancels. */
function Form({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  useUnsaved("URL", text !== "");
  const cancel = useDialogCancel(onDone);
  return (
    <form>
      <label>
        URL
        <input value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <Button onClick={cancel}>やめる</Button>
    </form>
  );
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p>背後の一覧</p>
      <FormDialog open={open} onOpenChange={setOpen} trigger={<button>開く</button>} title="購読フィードを追加">
        <Form onDone={() => setOpen(false)} />
      </FormDialog>
    </>
  );
}

const question = () => screen.findByRole("alertdialog", { name: "保存していない変更があります" });
// Hidden from the tree, and so unnamed, while the question is open over it.
const dialog = () => document.querySelector('[role="dialog"]');

// The page behind a modal dialog takes no pointer events; pressing it is pressing outside the dialog.
async function openWith(text: string) {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "開く" }));
  if (text) await user.type(screen.getByLabelText("URL"), text);
  return user;
}

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

  it("stays open when the page behind is pressed while a field holds input", async () => {
    const user = await openWith("https://example.com/");
    await user.click(screen.getByText("背後の一覧"));
    expect(dialog()).toBeInTheDocument();
    expect(screen.getByLabelText("URL")).toHaveValue("https://example.com/");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("closes when the page behind is pressed while no field holds input", async () => {
    const user = await openWith("");
    await user.click(screen.getByText("背後の一覧"));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
  });

  it("asks before Escape closes it while a field holds input, and goes back to editing", async () => {
    const user = await openWith("https://example.com/");
    await user.keyboard("{Escape}");
    const asked = await question();
    expect(within(asked).getByText(/保存されません/)).toBeInTheDocument();
    expect(dialog()).toBeInTheDocument();

    await user.click(within(asked).getByRole("button", { name: "編集を続ける" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(dialog()).toBeInTheDocument();
    expect(screen.getByLabelText("URL")).toHaveValue("https://example.com/");
  });

  it("asks before the cancel button closes it, and closes once the input is thrown away", async () => {
    const user = await openWith("https://example.com/");
    await user.click(screen.getByRole("button", { name: "やめる" }));
    await user.click(within(await question()).getByRole("button", { name: "破棄して閉じる" }));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "開く" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "開く" }));
    expect(screen.getByLabelText("URL")).toHaveValue("");
  });

  it("closes at once with Escape or the cancel button while no field holds input", async () => {
    const user = await openWith("");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "開く" }));
    await user.click(screen.getByRole("button", { name: "やめる" }));
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
