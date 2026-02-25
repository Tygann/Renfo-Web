const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: ["node_modules/**", ".git/**", ".wrangler/**", "*.png", "*.ico"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js", "config.js"],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.browser,
        mapkit: "readonly",
        lucide: "readonly",
      },
    },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["cloudflare/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.serviceworker,
        ...globals.worker,
        ...globals.browser,
        atob: "readonly",
        btoa: "readonly",
      },
    },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
];
