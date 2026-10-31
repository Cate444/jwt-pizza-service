const { app, request } = require('./testHelpers');
const version = require('./version.json');
const metrics = require('./metrics.js');

test('welcome', async () => {
  const res = await request(app).get('/');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ message: 'welcome to JWT Pizza', version: version.version });
});

test('docs', async () => {
  const res = await request(app).get('/api/docs');
  expect(res.status).toBe(200);
  expect(res.body.version).toBe(version.version);
  expect(res.body.endpoints.length).toBeGreaterThan(0);
  expect(res.body.config).toHaveProperty('factory');
  expect(res.body.config).toHaveProperty('db');
});

test('unknown endpoint', async () => {
  const res = await request(app).get('/api/does-not-exist');
  expect(res.status).toBe(404);
  expect(res.body.message).toBe('unknown endpoint');
});

test('requests are recorded in metrics', async () => {
  const requestCount = () => {
    const all = metrics.buildMetrics().resourceMetrics[0].scopeMetrics[0].metrics.find((m) => m.name === 'http_requests');
    return all.sum.dataPoints[0].asInt;
  };
  const before = requestCount();
  await request(app).get('/');
  expect(requestCount()).toBe(before + 1);
});
