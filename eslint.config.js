// ESLint 9 flat config. Replaces the legacy .eslintrc.cjs / .eslintignore, which ESLint 9
// no longer reads. Run with `npm run lint:eslint`; type checking stays in `npm run lint`.
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'dist/', 'build/', 'coverage/', 'public/', 'go-wrapper/'] },
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  {
    files: ['**/*.{ts,tsx,js,cjs,mjs}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Fires on every lazy()/memo() wrapper; component names come from the file anyway.
      'react/display-name': 'off',
      // Only the two classic hook rules. The v7 "recommended" set also enables the
      // React Compiler rules, which this codebase has never been checked against.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // Existing debt (~1000 hits, mostly `any` in server.ts) kept visible as warnings
      // so the remaining errors are the ones worth reading.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-empty': 'warn',
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
    },
  },
  prettier,
];
