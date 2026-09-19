// Poorup lint scope: server/ (game logic + stores are the safety-critical,
// testable code). public/main.js (8k-line legacy SPA) is deliberately excluded
// for now — a follow-up refactor PR can opt it in as warnings.
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "coverage/**", "server/data/**", "supplied/**", ".ulpi/**", "public/vendor/**"],
  },
  js.configs.recommended,
  {
    files: ["server/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // The codebase leans on these idioms; keep them as warnings so the CI
      // gate stays green while the cleanup ledger accumulates.
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-control-regex": "off",
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.browser,
        io: "readonly",
        ResizeObserver: "readonly",
      },
    },
    rules: {
      // Browser modules are intentionally decomposed around shared host
      // hooks; keep unused parameters visible without blocking the release
      // gate while the client cleanup ledger is worked down.
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
];
