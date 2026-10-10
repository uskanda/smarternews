import { join } from "node:path";

export interface Paths {
  configDir: string;
  dataDir: string;
  configFile: string;
  dbFile: string;
  apiTokenFile: string;
  feedTokenFile: string;
}

/** Where configuration, tokens and the database live. Everything is outside the repository. */
export function resolvePaths(env: Record<string, string | undefined>, home: string): Paths {
  const configDir =
    env.SMARTERNEWS_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "smarternews");
  const dataDir =
    env.SMARTERNEWS_DATA_DIR ?? join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "smarternews");
  return {
    configDir,
    dataDir,
    configFile: join(configDir, "config.yaml"),
    dbFile: join(dataDir, "db.sqlite"),
    apiTokenFile: join(configDir, "api-token"),
    feedTokenFile: join(configDir, "feed-token"),
  };
}
