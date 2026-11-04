jest.mock('./config.js', () => ({
  logging: { source: 'jwt-pizza-service-test', endpointUrl: 'https://grafana.test/loki/api/v1/push', accountId: '123', apiKey: 'key' },
}));

let logger;

beforeEach(() => {
  jest.resetModules();
  logger = require('./logger.js');
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('sanitize masks secrets anywhere in an object', () => {
  const original = { password: 'pw', user: { token: 'abc', roles: [{ apiKey: 'k' }] }, jwt: 'j', Authorization: 'Bearer x', name: 'pizza diner' };
  const clean = logger.sanitize(original);
  expect(clean).toEqual({ password: '*****', user: { token: '*****', roles: [{ apiKey: '*****' }] }, jwt: '*****', Authorization: '*****', name: 'pizza diner' });
  expect(original.password).toBe('pw');
});

test('sanitize partially masks emails', () => {
  expect(logger.sanitize({ email: 'd@jwt.com' })).toEqual({ email: 'd***@jwt.com' });
  expect(logger.sanitize({ email: 'diner@jwt.com' })).toEqual({ email: 'd***@jwt.com' });
});

test('sanitize cleans JSON strings and leaves other values alone', () => {
  expect(logger.sanitize('{"token":"abc","id":1}')).toEqual({ token: '*****', id: 1 });
  expect(logger.sanitize('not json')).toBe('not json');
  expect(logger.sanitize(undefined)).toBeUndefined();
  expect(logger.sanitize(5)).toBe(5);
});
