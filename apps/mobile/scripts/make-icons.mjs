// Draws the PNG icons the Android build needs from the SVG files beside them. Run after changing an SVG:
//   node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const assets = join(import.meta.dirname, "../assets");
for (const name of ["icon", "icon-foreground", "icon-monochrome"]) {
  const svg = readFileSync(join(assets, `${name}.svg`), "utf8");
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } }).render().asPng();
  writeFileSync(join(assets, `${name}.png`), png);
  console.log(`wrote assets/${name}.png (${png.length} bytes)`);
}
