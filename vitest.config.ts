import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    // All suites share one database; run files sequentially.
    fileParallelism: false,
    globalSetup: "tests/unit/global-setup.ts",
    testTimeout: 20_000,
  },
});
