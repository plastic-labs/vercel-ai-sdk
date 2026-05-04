import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/openai/index.ts",
    "src/identity/index.ts",
  ],
  format: ["esm"],
  dts: true,
  splitting: true,
  clean: true,
  target: "es2022",
  outDir: "dist",
  external: [
    "ai",
    "zod",
    "@ai-sdk/provider",
  ],
});
