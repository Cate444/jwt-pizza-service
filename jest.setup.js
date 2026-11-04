// Keep tests from sending logs to Grafana. logger.test.js unmocks this to test the real logger.
jest.mock('./src/logger.js', () => ({
  ...jest.requireActual('./src/logger.js'),
  httpLogger: (req, res, next) => next(),
  dbLogger: jest.fn(),
  factoryLogger: jest.fn(),
  unhandledErrorLogger: jest.fn(),
}));
