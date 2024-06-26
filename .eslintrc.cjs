module.exports = {
  overrides: [
    {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: __dirname,
      },
      files: ['src/**/*.ts', 'tests/**/*.ts'],
      extends: ['love', 'prettier'],
      rules: {
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
  ],
};
