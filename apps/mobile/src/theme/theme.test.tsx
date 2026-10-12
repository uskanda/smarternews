import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { Appearance } from "react-native";
import { renderApp } from "../testing/app";
import { Button, IconButton } from "../ui/controls";
import { Txt } from "../ui/Txt";
import { chooseTheme, loadThemeChoice } from "./store";
import { themeFor } from "./theme";

let mockScheme: "light" | "dark" = "light";
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => mockScheme }));

const mockBarStyle = jest.fn();
jest.mock("expo-status-bar", () => ({
  StatusBar: ({ style }: { style: string }) => {
    mockBarStyle(style);
    return null;
  },
}));

/** Relative luminance and contrast as WCAG 2 defines them. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(5).filter(Boolean)) as Record<string, unknown>;

describe("the colour scheme", () => {
  afterEach(() => {
    mockScheme = "light";
  });

  const textColor = () => flat(screen.getByText("本文").props.style).color;

  it("draws in dark blue when the device is set to dark and the user chose nothing", async () => {
    mockScheme = "dark";
    await render(<Txt>本文</Txt>);

    expect(textColor()).toBe(themeFor("darkblue").colors["on-surface"]);
    expect(luminance(themeFor("darkblue").colors.surface)).toBeLessThan(0.05);
    expect(themeFor("darkblue").dark).toBe(true);
  });

  it("draws in the scheme the user chose, whatever the device is set to", async () => {
    await render(<Txt>本文</Txt>);

    await act(() => chooseTheme("dark"));
    expect(textColor()).toBe(themeFor("dark").colors["on-surface"]);
    expect(luminance(themeFor("dark").colors.surface)).toBeLessThan(0.05);

    mockScheme = "dark";
    await act(() => chooseTheme("light"));
    expect(textColor()).toBe(themeFor("light").colors["on-surface"]);
  });

  it("follows the device again when the user goes back to that", async () => {
    await render(<Txt>本文</Txt>);

    await act(() => chooseTheme("dark"));
    await act(() => chooseTheme("system"));

    expect(textColor()).toBe(themeFor("light").colors["on-surface"]);
    expect(await AsyncStorage.getItem("smarternews.theme")).toBeNull();
  });

  it("keeps the choice on the device and draws with it once it has been read", async () => {
    await act(() => chooseTheme("dark"));
    expect(await AsyncStorage.getItem("smarternews.theme")).toBe("dark");

    // As after closing the app and opening it again: nothing is held in memory.
    require("./store").resetThemeState();
    await render(<Txt>本文</Txt>);
    expect(textColor()).toBe(themeFor("light").colors["on-surface"]);

    await act(() => loadThemeChoice());
    expect(textColor()).toBe(themeFor("dark").colors["on-surface"]);
  });

  it("follows the device when something unknown is stored", async () => {
    await AsyncStorage.setItem("smarternews.theme", "sepia");
    await render(<Txt>本文</Txt>);

    await act(() => loadThemeChoice());

    expect(textColor()).toBe(themeFor("light").colors["on-surface"]);
  });

  it("draws dark text on a light ground otherwise", async () => {
    await render(<Txt>本文</Txt>);

    expect(flat(screen.getByText("本文").props.style).color).toBe(themeFor("light").colors["on-surface"]);
  });

  it.each(["light", "dark", "darkblue"] as const)("keeps body text, muted text and links readable in the %s scheme", (name) => {
    const { colors } = themeFor(name);
    for (const ground of [colors.surface, colors.background]) {
      expect(contrast(colors["on-surface"], ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors["on-surface-muted"], ground)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.primary, ground)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(colors["on-surface"], colors["mark-fill"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors["outline-strong"], colors.surface)).toBeGreaterThanOrEqual(3);
  });
});

describe("the bars of the device", () => {
  const setScheme = jest.spyOn(Appearance, "setColorScheme");
  beforeEach(() => {
    mockBarStyle.mockClear();
    setScheme.mockClear();
  });
  afterEach(() => {
    mockScheme = "light";
  });

  it("shows light words in the bar at the top over a dark scheme chosen on a light device, and tells the device to draw its own parts dark", async () => {
    await AsyncStorage.setItem("smarternews.theme", "dark");
    await renderApp({ url: "/settings" });

    await waitFor(() => expect(mockBarStyle).toHaveBeenLastCalledWith("light"));
    expect(setScheme).toHaveBeenLastCalledWith("dark");
  });

  it("shows dark words over a light scheme chosen on a dark device", async () => {
    mockScheme = "dark";
    await AsyncStorage.setItem("smarternews.theme", "light");
    await renderApp({ url: "/settings" });

    await waitFor(() => expect(mockBarStyle).toHaveBeenLastCalledWith("dark"));
    expect(setScheme).toHaveBeenLastCalledWith("light");
  });

  it("leaves the bars to the device while the user follows it", async () => {
    await renderApp({ url: "/settings" });

    await screen.findByRole("radio", { name: "端末に従う" });
    expect(mockBarStyle).toHaveBeenLastCalledWith("dark");
    expect(setScheme).toHaveBeenLastCalledWith("unspecified");
  });
});

describe("controls", () => {
  it("makes a button with words at least 48dp high and wide", async () => {
    await render(<Button label="保存する" onPress={() => {}} />);
    const style = flat(screen.getByRole("button", { name: "保存する" }).props.style) as { minHeight: number; minWidth: number };
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
    expect(style.minWidth).toBeGreaterThanOrEqual(48);
  });

  it("makes a button with a picture 48dp square and reads out its name", async () => {
    await render(<IconButton label="スターを付ける" icon="star" onPress={() => {}} />);
    const style = screen.getByRole("button", { name: "スターを付ける" }).props.style as { width: number; height: number };
    expect(style.width).toBeGreaterThanOrEqual(48);
    expect(style.height).toBeGreaterThanOrEqual(48);
  });

  it("cannot be written without a name: the type refuses it", () => {
    // @ts-expect-error -- a button that shows only a picture needs a label
    const nameless = <IconButton icon="star" onPress={() => {}} />;
    expect(nameless).toBeTruthy();
  });
});
