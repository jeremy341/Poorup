// Poorup lint scope: server/ (game logic + stores are the safety-critical,
// testable code), public/ (browser modules, including main.js via the
// shared browser rule set below), scripts/ (operations and test runners) and
// qa/ (browser specs and load tools). The CommonJS ecosystem file and the
// scripts/*.cjs helpers use the commonjs source type. vendor/ and generated
// assets are ignored; the remaining no-unused-vars warnings in server/ and
// public/ are tracked as a cleanup ledger, and `npm run lint` caps them.
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "coverage/**", "server/data/**", "supplied/**", "public/vendor/**"],
  },
  js.configs.recommended,
  {
    files: ["scripts/**/*.{js,mjs,cjs}", "qa/**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // Spec files name the globals they use in /* global */ comments; those
      // duplicate the built-in sets above and are not a defect.
      "no-redeclare": ["error", { builtinGlobals: false }],
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
  },
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
