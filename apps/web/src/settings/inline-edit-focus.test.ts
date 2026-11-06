import { describe, expect, it } from "vitest";
import { firstField } from "./inline-edit-focus.ts";

type Spec = { tag: "input" | "select" | "textarea" | "button"; id?: string; type?: string; name?: string; checked?: boolean; disabled?: boolean };

/** A region holding the given fields, in order. */
function root(...specs: Spec[]): HTMLElement {
  const element = document.createElement("div");
  for (const spec of specs) {
    const field = document.createElement(spec.tag);
    if (spec.id) field.id = spec.id;
    if (field instanceof HTMLInputElement) {
      if (spec.type) field.type = spec.type;
      if (spec.name) field.name = spec.name;
      field.checked = spec.checked ?? false;
    }
    if (spec.disabled) field.setAttribute("disabled", "");
    element.append(field);
  }
  return element;
}

describe("firstField", () => {
  it("finds a text area that comes before the inputs", () => {
    const form = root({ tag: "input", type: "hidden" }, { tag: "textarea", id: "text" }, { tag: "input", type: "checkbox", id: "enabled" });
    expect(firstField(form)?.id).toBe("text");
  });

  it("finds the chosen radio button of a group", () => {
    const form = root(
      { tag: "input", type: "radio", name: "kind", id: "hide" },
      { tag: "input", type: "radio", name: "kind", id: "keep", checked: true },
      { tag: "select", id: "scope" },
    );
    expect(firstField(form)?.id).toBe("keep");
  });

  it("finds the first radio button of a group where none is chosen", () => {
    const form = root({ tag: "input", type: "radio", name: "kind", id: "hide" }, { tag: "input", type: "radio", name: "kind", id: "keep" });
    expect(firstField(form)?.id).toBe("hide");
  });

  it("passes over fields that cannot be used", () => {
    const form = root({ tag: "input", id: "off", disabled: true }, { tag: "select", id: "none", disabled: true }, { tag: "input", id: "name" });
    expect(firstField(form)?.id).toBe("name");
  });

  it("finds nothing in a region without fields", () => {
    expect(firstField(root({ tag: "button" }))).toBeNull();
  });
});
