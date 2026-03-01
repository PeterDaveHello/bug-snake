module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  extends: ['eslint:recommended', 'plugin:import/recommended'],
  plugins: ['import'],
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js']
      }
    },
    'import/ignore': ['^https?://']
  },
  rules: {
    'import/extensions': ['error', 'ignorePackages', { js: 'always' }],
    'import/no-unresolved': ['error', { ignore: ['^https?://'] }],
    'import/order': [
      'warn',
      {
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true }
      }
    ],
    'no-unused-vars': ['error', { args: 'none' }]
  },
  overrides: [
    {
      files: ['scripts/tools/**/*.js', 'scripts/tests/**/*.js'],
      env: {
        node: true,
        browser: false
      }
    },
    {
      files: ['sw.js'],
      env: {
        serviceworker: true,
        browser: false
      }
    }
  ]
};
