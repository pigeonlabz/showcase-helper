import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset paths work both at a domain root and under /repository-name/ on Pages.
  base: "./",
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
