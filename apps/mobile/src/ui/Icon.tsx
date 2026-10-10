import Svg, { Path } from "react-native-svg";

const PATHS = {
  menu: "M3 6h18M3 12h18M3 18h18",
  back: "M15 5l-7 7 7 7",
  close: "M6 6l12 12M18 6L6 18",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z",
  unread: "M4 6h16v12H4zM4 7l8 6 8-6",
  open: "M14 4h6v6M20 4l-9 9M10 6H5v13h13v-5",
  checkAll: "M2 13l4 4 8-9M10 16l1.5 1.5L21 8",
  settings: "M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0M16 5v4M10 10v4M18 15v4",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
} as const;

export type IconName = keyof typeof PATHS;

/** A line icon. It carries no meaning for screen readers: the button around it has the name. */
export function Icon({ name, color, filled = false, size = 24 }: { name: IconName; color: string; filled?: boolean; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={PATHS[name]} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill={filled ? color : "none"} />
    </Svg>
  );
}
