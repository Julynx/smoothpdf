import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        ignores: ['node_modules/**', 'dist/**', 'build/**', 'eslint.config.mjs'],
    },
    js.configs.recommended,
    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            'indent': ['error', 4],
            'linebreak-style': ['error', 'windows'],
            'quotes': ['error', 'single'],
            'semi': ['error', 'always'],
            'no-unused-vars': 'warn',
        },
    },
    {
        files: ['renderer.js'],
        languageOptions: {
            globals: {
                ...globals.browser,
            },
        },
    },
    {
        files: ['main.js', 'preload.js'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
];
