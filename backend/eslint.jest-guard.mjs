import tseslint from 'typescript-eslint';
import jestPlugin from 'eslint-plugin-jest';

// Dedicated, baseline-independent guard: enforces ONLY that no focused tests
// (.only / fdescribe / fit) are committed. Intentionally does NOT load the
// type-checked/prettier rules of eslint.config.mjs, so it stays green against
// the current lint debt and can gate CI on its own.
export default [
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    languageOptions: { parser: tseslint.parser },
    // Register the TS plugin so inline `eslint-disable @typescript-eslint/*`
    // directives in the specs resolve to a known rule (otherwise ESLint errors
    // with "Definition for rule ... was not found"). No TS rules are enabled,
    // so this stays baseline-independent.
    plugins: { jest: jestPlugin, '@typescript-eslint': tseslint.plugin },
    rules: { 'jest/no-focused-tests': 'error' },
  },
];
