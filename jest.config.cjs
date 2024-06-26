/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  rootDir: './tests',

  resolver: 'jest-ts-webcompat-resolver',

  transform: {
    '.ts$': ['ts-jest', { tsconfig: './tsconfig.jest.json' }],
  },
};
