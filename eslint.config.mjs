import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "e2e/**", "**/artifacts/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "no-console": ["warn", { allow: ["warn", "error", "log"] }],
      "@typescript-eslint/no-explicit-any": "warn"
    }
  }
];