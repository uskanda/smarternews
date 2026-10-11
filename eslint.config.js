import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "coverage/**", "apps/mobile/android/**", "apps/mobile/ios/**", "apps/mobile/.expo/**", "apps/mobile/expo-env.d.ts", ".agents/**", ".claude/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/mobile/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    // The files that Expo, Metro, Babel and Jest load themselves are CommonJS and run in Node.
    files: ["apps/mobile/*.js", "apps/mobile/src/testing/*.js", "apps/mobile/plugins/*.js", "apps/mobile/scripts/*.mjs"],
    languageOptions: {
      globals: { require: "readonly", module: "writable", __dirname: "readonly", process: "readonly", console: "readonly", globalThis: "readonly" },
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Jest replaces a module with what `require` returns inside the factory that mocks it.
    files: ["apps/mobile/**/*.test.{ts,tsx}", "apps/mobile/src/testing/**"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // The browser runs these as they are, before the app: plain scripts, not modules.
    files: ["apps/web/public/*.js"],
    languageOptions: { sourceType: "script", globals: { window: "readonly", document: "readonly" } },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // Article text comes from a model that read the web. It is never handed to the browser as markup.
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "Render text through React. Markdown goes through the Markdown component.",
        },
        {
          selector: "MemberExpression[property.name=/^(innerHTML|outerHTML)$/]",
          message: "Do not write markup strings into the page.",
        },
        {
          selector: "CallExpression[callee.property.name=/^(insertAdjacentHTML|write)$/][callee.object.name=/^(document|el|element|node)$/]",
          message: "Do not write markup strings into the page.",
        },
      ],
    },
  },
);
