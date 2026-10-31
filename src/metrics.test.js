const EventEmitter = require('events');

jest.mock('./config.js', () => ({
  metrics: { source: 'jwt-pizza-service-test', endpointUrl: 'https://grafana.test/otlp/v1/metrics', accountId: '123', apiKey: 'key' },
}));

let metrics;
let config;

beforeEach(() => {
  // Fresh module state so counters from one test don't leak into another.
  jest.resetModules();
  config = require('./config.js');
  metrics = require('./metrics.js');
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function simulateRequest(method, originalUrl, statusCode = 200, user = undefined) {
  const req = { method, originalUrl, user };
  const res = new EventEmitter();
  res.statusCode = statusCode;
  const next = jest.fn();
  metrics.requestTracker(req, res, next);
  expect(next).toHaveBeenCalled();
  res.emit('finish');
}

function findMetrics(payload, name) {
  return payload.resourceMetrics[0].scopeMetrics[0].metrics.filter((m) => m.name === name);
}

function pointValue(metric) {
  const point = (metric.sum ?? metric.gauge).dataPoints[0];
  return point.asInt ?? point.asDouble;
}

function attribute(metric, key) {
  const point = (metric.sum ?? metric.gauge).dataPoints[0];
  return point.attributes.find((a) => a.key === key)?.value.stringValue;
}

function valueWith(payload, name, key, value) {
  return pointValue(findMetrics(payload, name).find((m) => attribute(m, key) === value));
}

test('counts total requests and requests by method', () => {
  simulateRequest('GET', '/api/order/menu');
  simulateRequest('GET', '/api/order/menu');
  simulateRequest('POST', '/api/order');
  simulateRequest('PUT', '/api/order/menu');
  simulateRequest('DELETE', '/api/franchise/1');
  simulateRequest('OPTIONS', '/api/order');

  const payload = metrics.buildMetrics();
  expect(valueWith(payload, 'http_requests', 'method', 'ALL')).toBe(6);
  expect(valueWith(payload, 'http_requests', 'method', 'GET')).toBe(2);
  expect(valueWith(payload, 'http_requests', 'method', 'POST')).toBe(1);
  expect(valueWith(payload, 'http_requests', 'method', 'PUT')).toBe(1);
  expect(valueWith(payload, 'http_requests', 'method', 'DELETE')).toBe(1);
});

test('counters are cumulative sums tagged with the configured source', () => {
  simulateRequest('GET', '/');
  const [metric] = findMetrics(metrics.buildMetrics(), 'http_requests');
  expect(metric.sum.isMonotonic).toBe(true);
  expect(metric.sum.aggregationTemporality).toBe(2);
  expect(metric.sum.dataPoints[0].startTimeUnixNano).toMatch(/^\d+000000$/);
  expect(attribute(metric, 'source')).toBe('jwt-pizza-service-test');
});

test('records successful and failed logins', () => {
  simulateRequest('PUT', '/api/auth', 200);
  simulateRequest('PUT', '/api/auth', 404);
  simulateRequest('PUT', '/api/auth?x=1', 404);
  simulateRequest('POST', '/api/auth', 200); // registration is not a login attempt

  const payload = metrics.buildMetrics();
  expect(valueWith(payload, 'auth_attempts', 'status', 'success')).toBe(1);
  expect(valueWith(payload, 'auth_attempts', 'status', 'failure')).toBe(2);
});

test('tracks active users and removes them on logout', () => {
  simulateRequest('GET', '/api/order', 200, { id: 1 });
  simulateRequest('GET', '/api/order', 200, { id: 1 });
  simulateRequest('GET', '/api/order', 200, { id: 2 });
  simulateRequest('GET', '/api/order/menu');
  expect(pointValue(findMetrics(metrics.buildMetrics(), 'active_users')[0])).toBe(2);

  simulateRequest('DELETE', '/api/auth', 200, { id: 2 });
  expect(pointValue(findMetrics(metrics.buildMetrics(), 'active_users')[0])).toBe(1);
});

test('users drop out of active users after five minutes of inactivity', () => {
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  simulateRequest('GET', '/api/order', 200, { id: 1 });

  Date.now.mockReturnValue(now + 5 * 60 * 1000 + 1);
  expect(pointValue(findMetrics(metrics.buildMetrics(), 'active_users')[0])).toBe(0);
});

test('reports average service latency per interval and resets it', () => {
  const now = Date.now();
  const spy = jest.spyOn(Date, 'now');
  spy.mockReturnValueOnce(now).mockReturnValueOnce(now + 100);
  simulateRequest('GET', '/');
  spy.mockReturnValueOnce(now).mockReturnValueOnce(now + 300);
  simulateRequest('GET', '/');
  spy.mockRestore();

  expect(pointValue(findMetrics(metrics.buildMetrics(), 'service_latency_ms')[0])).toBe(200);
  expect(findMetrics(metrics.buildMetrics(), 'service_latency_ms')).toHaveLength(0);
});

test('records pizza sales, revenue, failures, and creation latency', () => {
  metrics.pizzaPurchase(true, 100, 0.05, 2);
  metrics.pizzaPurchase(true, 300, 0.0038, 1);
  metrics.pizzaPurchase(false, 2000, 0, 21);

  const payload = metrics.buildMetrics();
  expect(pointValue(findMetrics(payload, 'pizzas_sold')[0])).toBe(3);
  expect(pointValue(findMetrics(payload, 'pizza_creation_failures')[0])).toBe(1);
  expect(pointValue(findMetrics(payload, 'pizza_revenue')[0])).toBeCloseTo(0.0538);
  expect(findMetrics(payload, 'pizza_revenue')[0].sum.dataPoints[0]).toHaveProperty('asDouble');
  expect(pointValue(findMetrics(payload, 'pizza_creation_latency_ms')[0])).toBe(800);
});

test('reports cpu and memory usage percentages', () => {
  const payload = metrics.buildMetrics();
  const cpu = pointValue(findMetrics(payload, 'cpu_usage_percent')[0]);
  const memory = pointValue(findMetrics(payload, 'memory_usage_percent')[0]);
  expect(cpu).toBeGreaterThanOrEqual(0);
  expect(memory).toBeGreaterThan(0);
  expect(memory).toBeLessThanOrEqual(100);
});

test('sendMetrics posts the OTLP payload to Grafana', async () => {
  fetch.mockResolvedValue({ ok: true });
  await metrics.sendMetrics();

  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('https://grafana.test/otlp/v1/metrics');
  expect(options.method).toBe('POST');
  expect(options.headers.Authorization).toBe('Bearer 123:key');
  expect(JSON.parse(options.body).resourceMetrics).toBeDefined();
});

test('sendMetrics logs when Grafana rejects the payload', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  fetch.mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' });
  await metrics.sendMetrics();
  expect(log).toHaveBeenCalledWith('Failed to push metrics to Grafana', 401, 'unauthorized');
});

test('sendMetrics logs network errors instead of throwing', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  fetch.mockRejectedValue(new Error('network down'));
  await expect(metrics.sendMetrics()).resolves.toBeUndefined();
  expect(log).toHaveBeenCalledWith('Error sending metrics', expect.any(Error));
});

test('sendMetrics does nothing when metrics are not configured', async () => {
  delete config.metrics;
  await metrics.sendMetrics();
  expect(fetch).not.toHaveBeenCalled();
});

test('sendMetricsPeriodically sends on every interval', async () => {
  jest.useFakeTimers();
  fetch.mockResolvedValue({ ok: true });
  const timer = metrics.sendMetricsPeriodically(10000);

  jest.advanceTimersByTime(30000);
  expect(fetch).toHaveBeenCalledTimes(3);
  clearInterval(timer);
});
