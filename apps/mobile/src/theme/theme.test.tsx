import { render, screen } from "@testing-library/react-native";
import { Button, IconButton } from "../ui/controls";
import { Txt } from "../ui/Txt";
import { themeFor } from "./theme";

let mockScheme: "light" | "dark" = "light";
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => mockScheme }));

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

  it("draws light text on a dark ground when the device is set to dark", async () => {
    mockScheme = "dark";
    await render(<Txt>本文</Txt>);

    expect(flat(screen.getByText("本文").props.style).color).toBe(themeFor("dark").colors["on-surface"]);
    expect(luminance(themeFor("dark").colors.surface)).toBeLessThan(0.05);
  });

  it("draws dark text on a light ground otherwise", async () => {
    await render(<Txt>本文</Txt>);

    expect(flat(screen.getByText("本文").props.style).color).toBe(themeFor("light").colors["on-surface"]);
  });

  it.each(["light", "dark"] as const)("keeps body text, muted text and links readable in the %s scheme", (name) => {
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
