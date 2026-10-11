import { screen } from "@testing-library/react-native";
import { store } from "expo-router/build/global-state/router-store";
import { renderApp } from "../testing/app";
import { makeServer } from "../testing/server";

// Android's back button leaves the app when there is nothing to go back to. A screen that always has
// "something behind it" traps the user.
describe("the system back button", () => {
  it("has nothing to go back to on the unread list, so it leaves the app", async () => {
    const server = await makeServer();
    await renderApp({ server });
    await screen.findByRole("header", { name: "未読" });

    expect(store.navigationRef.canGoBack()).toBe(false);
  });

  it("has nothing to go back to on a list that was opened directly either", async () => {
    const server = await makeServer();
    await server.category("Category A");
    await renderApp({ server, url: "/list/category-1" });
    await screen.findByRole("header", { name: "Category A" });

    expect(store.navigationRef.canGoBack()).toBe(false);
  });
});
