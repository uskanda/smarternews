import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider, useSearchParams } from "react-router";
import { describe, expect, it } from "vitest";
import { useScrollMemory } from "./scroll-memory.ts";

/** A page with its own scrolling region. One that waits has its content once "load" is pressed. */
function Page({ waits = false }: { waits?: boolean }) {
  const [, setParams] = useSearchParams();
  const [ready, setReady] = useState(!waits);
  const region = useScrollMemory("page", ready);
  return (
    <div ref={region} data-testid="region">
      <button onClick={() => setParams((next) => (next.set("flag", "on"), next), { replace: true })}>flag</button>
      <button onClick={() => setReady(true)}>load</button>
    </div>
  );
}

function renderPages(start = "/page") {
  const router = createMemoryRouter(
    [
      { path: "/page", element: <Page /> },
      { path: "/slow", element: <Page waits /> },
      { path: "/other", element: <p>other</p> },
    ],
    { initialEntries: [start] },
  );
  render(<RouterProvider router={router} />);
  return {
    router,
    region: () => screen.getByTestId("region"),
    scrollTo(top: number) {
      screen.getByTestId("region").scrollTop = top;
      fireEvent.scroll(screen.getByTestId("region"));
    },
    async go(to: string | number) {
      await act(async () => {
        await (typeof to === "number" ? router.navigate(to) : router.navigate(to));
      });
    },
  };
}

describe("the scroll position kept for each entry of the history", () => {
  it("comes back when the browser goes back to the entry", async () => {
    const page = renderPages();
    page.scrollTo(240);
    await page.go("/other");
    await page.go(-1);
    expect(page.region().scrollTop).toBe(240);
  });

  it("is not that of another entry on the same path", async () => {
    const page = renderPages();
    page.scrollTo(240);
    await page.go("/other");
    await page.go("/page");
    expect(page.region().scrollTop).toBe(0);
  });

  it("is put back once the content is there, and not overwritten by scrolling before that", async () => {
    const page = renderPages("/slow");
    fireEvent.click(screen.getByRole("button", { name: "load" }));
    page.scrollTo(240);
    await page.go("/other");
    await page.go(-1);

    expect(page.region().scrollTop).toBe(0);
    // A short page scrolls to its top while it loads.
    fireEvent.scroll(page.region());
    fireEvent.click(screen.getByRole("button", { name: "load" }));
    expect(page.region().scrollTop).toBe(240);
  });

  it("keeps what the reader scrolls after it is put back", async () => {
    const page = renderPages();
    page.scrollTo(300);
    await page.go("/other");
    await page.go(-1);
    page.scrollTo(50);
    await page.go("/other");
    await page.go(-1);
    expect(page.region().scrollTop).toBe(50);
  });

  it("follows the entry when a search parameter is replaced", async () => {
    const page = renderPages();
    page.scrollTo(180);
    fireEvent.click(screen.getByRole("button", { name: "flag" }));
    expect(page.router.state.location.search).toBe("?flag=on");
    await page.go("/other");
    await page.go(-1);
    expect(page.router.state.location.search).toBe("?flag=on");
    expect(page.region().scrollTop).toBe(180);
  });
});
