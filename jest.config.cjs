/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  transform: {
    '.ts$': ['ts-jest', { tsconfig: './tsconfig.jest.json' }],
  },
};
