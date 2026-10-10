import { describe, expect, it } from "vitest";
import { resolvePaths } from "./paths.ts";

describe("resolvePaths", () => {
  it("falls back to the XDG defaults under the home directory", () => {
    const paths = resolvePaths({}, "/srv/user");
    expect(paths.configFile).toBe("/srv/user/.config/smarternews/config.yaml");
    expect(paths.dbFile).toBe("/srv/user/.local/share/smarternews/db.sqlite");
    expect(paths.apiTokenFile).toBe("/srv/user/.config/smarternews/api-token");
    expect(paths.feedTokenFile).toBe("/srv/user/.config/smarternews/feed-token");
  });

  it("uses XDG_CONFIG_HOME and XDG_DATA_HOME when they are set", () => {
    const paths = resolvePaths({ XDG_CONFIG_HOME: "/etc/xdg", XDG_DATA_HOME: "/var/xdg" }, "/srv/user");
    expect(paths.configDir).toBe("/etc/xdg/smarternews");
    expect(paths.dataDir).toBe("/var/xdg/smarternews");
  });

  it("lets the product-specific variables override the XDG ones", () => {
    const paths = resolvePaths(
      { XDG_CONFIG_HOME: "/etc/xdg", SMARTERNEWS_CONFIG_DIR: "/tmp/c", SMARTERNEWS_DATA_DIR: "/tmp/d" },
      "/srv/user",
    );
    expect(paths.configDir).toBe("/tmp/c");
    expect(paths.dbFile).toBe("/tmp/d/db.sqlite");
  });
});
