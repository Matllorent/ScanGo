// ESLint flat config mínima (solo backend: api/ + src/).
// No corre en `npm test`; uso manual: `npm run lint`.
export default [
  {
    files: ['api/**/*.js', 'src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs'
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-empty': ['warn', { allowEmptyCatch: false }]
    }
  }
];
