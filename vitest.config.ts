import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/modules/**/*.ts", "src/shared/**/*.ts"],
      exclude: ["**/*.tsx", "**/repository.ts", "**/actions.ts"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 }
    }
  }
});
