/** Pure-logic tests only (no React Native runtime needed). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { strict: true, module: 'commonjs', target: 'es2020', esModuleInterop: true, types: ['jest', 'node'] }, diagnostics: true }],
  },
};
