import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import next from '@next/eslint-plugin-next';
import globals from 'globals';
export default ts.config(
  { ignores: ['.next/**', 'data/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks, '@next/next': next },
    rules: {
      ...hooks.configs.flat.recommended.rules,
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
      '@next/next/no-img-element': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
);
