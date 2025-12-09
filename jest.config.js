/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/$1',
    '^react-native$': '<rootDir>/__mocks__/react-native.js'
  },
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: [],
};

