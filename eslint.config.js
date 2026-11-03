import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist/**', 'api/dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**']),
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': ['error', { patterns: [
        { group: ['**/features/*/internal/**'], message: 'Import features through their public index.' },
      ] }],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['react', 'react-dom', '@azure/**', 'jose', '**/app/**', '**/features/**', '**/demo/**', '**/client/**', '**/api/**'], message: 'Domain models cannot depend on UI, infrastructure or fixtures.' },
      ] }],
    },
  },
  {
    files: ['src/features/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['**/app/**', '**/demo/**'], message: 'Feature views receive data through props; app owns composition.' },
      ] }],
    },
  },
  {
    files: ['api/src/**/*.ts', 'src/contracts/**/*.ts', 'src/client/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['react', 'react-dom', '**/app/**', '**/features/**', '**/demo/**'], message: 'API, contracts and client adapters cannot depend on UI or fixtures.' },
      ] }],
    },
  },
  {
    files: ['src/demo/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['react', 'react-dom', '**/app/**', '**/features/**'], message: 'Fixtures depend on domain models only.' },
      ] }],
    },
  },
]);
