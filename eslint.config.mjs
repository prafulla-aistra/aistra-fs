// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Accuracy guard-rails (see CLAUDE.md): money and rates must never pass through JS floats.
const noFloatMoney = {
  'no-restricted-globals': [
    'error',
    {
      name: 'parseFloat',
      message: 'Use decimal.js (engine) or Prisma Decimal — never floats for money/rates.',
    },
  ],
  'no-restricted-properties': [
    'error',
    {
      object: 'Number',
      property: 'parseFloat',
      message: 'Use decimal.js — never floats for money/rates.',
    },
    {
      object: 'Math',
      property: 'round',
      message: 'Use Decimal#toDecimalPlaces with an explicit rounding mode.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'docs/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Node-side code: API, packages, scripts, tooling config files
  {
    files: [
      'apps/api/**/*.ts',
      'packages/**/*.ts',
      '*.{js,mjs,cjs,ts}',
      'scripts/**/*.{js,mjs,cjs,ts}',
      '**/*.config.{js,mjs,cjs,ts}',
    ],
    languageOptions: { globals: { ...globals.node } },
  },

  // Calculation engine and API business code: strictest money rules
  {
    files: ['packages/engine/src/**/*.ts', 'apps/api/src/**/*.ts'],
    rules: noFloatMoney,
  },

  // Web app (browser, React)
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // shadcn/ui primitives export variants alongside components by design
  {
    files: ['apps/web/src/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  prettier,
);
