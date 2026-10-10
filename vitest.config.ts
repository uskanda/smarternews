import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["packages/*/src/**/*.test.ts", "apps/server/src/**/*.test.ts", "scripts/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        plugins: [react()],
        test: {
          name: "web",
          include: ["apps/web/src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["apps/web/src/testing/setup.ts"],
        },
      },
    ],
  },
});
