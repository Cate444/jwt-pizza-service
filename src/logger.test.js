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

test('sanitize fully masks a malformed email', () => {
  expect(logger.sanitize({ email: 'nope' })).toEqual({ email: '*****' });
});

function sentLog() {
  const [url, options] = global.fetch.mock.calls[0];
  const stream = JSON.parse(options.body).streams[0];
  return { url, options, labels: stream.stream, timestamp: stream.values[0][0], line: JSON.parse(stream.values[0][1]) };
}

test('log sends a sanitized event to Loki', () => {
  logger.log('info', 'http', { path: '/api/auth', resBody: { token: 'abc' } });

  const { url, options, labels, timestamp, line } = sentLog();
  expect(url).toBe('https://grafana.test/loki/api/v1/push');
  expect(options.method).toBe('POST');
  expect(options.headers.Authorization).toBe('Bearer 123:key');
  expect(labels).toEqual({ source: 'jwt-pizza-service-test', level: 'info', type: 'http' });
  expect(timestamp).toMatch(/^\d{19}$/);
  expect(line).toEqual({ path: '/api/auth', resBody: { token: '*****' } });
});

test('log reports when Grafana rejects or fails', async () => {
  const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  global.fetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'unauthorized' });
  await logger.log('info', 'http', {});
  global.fetch.mockRejectedValueOnce(new Error('offline'));
  await logger.log('info', 'http', {});
  expect(consoleLog).toHaveBeenCalledTimes(2);
});

test('log does nothing without logging config', () => {
  delete require('./config.js').logging;
  logger.log('info', 'http', {});
  expect(global.fetch).not.toHaveBeenCalled();
});
