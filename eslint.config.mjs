// Lint for correctness, not style: TypeScript's recommended rules plus a few that catch real bugs.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", ".cache/**", "apps/web/postcss.config.cjs", "apps/web/tailwind.config.cjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "eqeqeq": ["error", "always"],
      "no-console": ["error", { allow: ["warn", "error"] }]
    }
  },
  {
    // CLIs that print their result to stdout.
    files: ["apps/api/src/ingest/refresh-bank-holidays.ts", "apps/api/src/cli/licence-review.ts"],
    rules: { "no-console": "off" }
  }
);
