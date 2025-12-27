import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';

export default [
  js.configs.recommended,
  prettierConfig,
  {
    files: ['**/*.js', '**/*.mjs'],
    plugins: {
      prettier: prettierPlugin,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        // Node.js 18+ globals
        fetch: 'readonly',
        // Runtime-specific globals
        Bun: 'readonly',
        Deno: 'readonly',
        // Bun test globals
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        // Node.js globals
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        // Web API globals available in modern runtimes
        Response: 'readonly',
        Request: 'readonly',
        ReadableStream: 'readonly',
        WritableStream: 'readonly',
        TransformStream: 'readonly',
      },
    },
    rules: {
      // Prettier integration
      'prettier/prettier': 'error',

      // Code quality rules
      // Note: Set to warn for now due to many pre-existing unused variables.
      // TODO: Gradually fix unused variables and change this to 'error'.
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off', // Allow console in this project
      'no-debugger': 'error',
      // Allow control characters in regex for ANSI escape detection
      'no-control-regex': 'off',

      // Best practices
      curly: ['error', 'all'],
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-arrow-callback': 'error',
      'no-duplicate-imports': 'error',

      // ES6+ features
      'arrow-body-style': ['error', 'as-needed'],
      'object-shorthand': ['error', 'always'],

      // Comments and documentation
      'spaced-comment': ['error', 'always', { markers: ['/'] }],

      // Relaxed rules for existing codebase
      // These are set to warn because fixing them in existing code would be disruptive
      eqeqeq: ['warn', 'always'], // Allow == for now
      'prefer-template': 'warn', // String concatenation is acceptable
      'no-empty': 'warn', // Empty blocks are sometimes intentional
      'no-useless-escape': 'warn', // Sometimes escape is for clarity
      'no-case-declarations': 'warn', // Lexical declarations in case blocks
      'no-async-promise-executor': 'warn', // Async promise executors
      'require-await': 'warn', // Async functions without await
      'require-yield': 'warn', // Generators without yield
      'no-prototype-builtins': 'warn', // Prototype method access
      'no-constant-binary-expression': 'warn', // Constant truthiness

      // Complexity rules - reasonable thresholds for maintainability
      complexity: ['warn', 15], // Cyclomatic complexity - allow more complex logic than strict 8
      'max-depth': ['warn', 5], // Maximum nesting depth - slightly more lenient than strict 4
      'max-lines-per-function': [
        'warn',
        {
          max: 150, // More reasonable than strict 50 lines per function
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      'max-params': ['warn', 6], // Maximum function parameters - slightly more lenient than strict 5
      'max-statements': ['warn', 60], // Maximum statements per function - reasonable limit for orchestration functions
      'max-lines': ['warn', 1500], // Maximum lines per file - set to warn for existing large files
    },
  },
  {
    // Test files have different requirements
    files: ['tests/**/*.js', 'tests/**/*.mjs', '**/*.test.js', '**/*.test.mjs'],
    rules: {
      'require-await': 'off', // Async functions without await are common in tests
    },
  },
  {
    // CommonJS compatibility (some files use require() for dynamic imports)
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      '*.min.js',
      '.eslintcache',
    ],
  },
];
