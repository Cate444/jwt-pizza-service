const os = require('os');
const config = require('./config.js');

const ACTIVE_USER_WINDOW_MS = 5 * 60 * 1000;
const TRACKED_METHODS = ['GET', 'PUT', 'POST', 'DELETE'];
const AGGREGATION_TEMPORALITY_CUMULATIVE = 2;

// Counters are cumulative for the life of the process; Grafana turns them into per-minute rates.
const startTimeUnixNano = toUnixNano(Date.now());
const requests = { total: 0, GET: 0, PUT: 0, POST: 0, DELETE: 0 };
const auth = { success: 0, failure: 0 };
const pizzas = { sold: 0, failures: 0, revenue: 0 };
const activeUsers = new Map(); // userId -> last time seen

// Latency is averaged over each reporting interval and then reset.
let serviceLatency = { sum: 0, count: 0 };
let pizzaLatency = { sum: 0, count: 0 };

// Express middleware that records request, latency, auth, and active user metrics.
function requestTracker(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    requests.total++;
    if (TRACKED_METHODS.includes(req.method)) {
      requests[req.method]++;
    }
    serviceLatency.sum += Date.now() - start;
    serviceLatency.count++;

    const isAuthEndpoint = req.originalUrl.split('?')[0] === '/api/auth';
    if (isAuthEndpoint && req.method === 'PUT') {
      auth[res.statusCode === 200 ? 'success' : 'failure']++;
    }

    if (req.user) {
      if (isAuthEndpoint && req.method === 'DELETE' && res.statusCode === 200) {
        activeUsers.delete(req.user.id);
      } else {
        activeUsers.set(req.user.id, Date.now());
      }
    }
  });
  next();
}

// Called by the order router whenever the pizza factory responds to an order.
function pizzaPurchase(success, latencyMs, price, count) {
  if (success) {
    pizzas.sold += count;
    pizzas.revenue += price;
  } else {
    pizzas.failures++;
  }
  pizzaLatency.sum += latencyMs;
  pizzaLatency.count++;
}

function getCpuUsagePercentage() {
  return (os.loadavg()[0] / os.cpus().length) * 100;
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  return ((totalMemory - os.freemem()) / totalMemory) * 100;
}

function getActiveUserCount() {
  const cutoff = Date.now() - ACTIVE_USER_WINDOW_MS;
  for (const [userId, lastSeen] of activeUsers) {
    if (lastSeen < cutoff) {
      activeUsers.delete(userId);
    }
  }
  return activeUsers.size;
}

// Builds an OTLP metrics payload from the current values and resets the interval latency averages.
function buildMetrics() {
  const now = toUnixNano(Date.now());
  const metrics = [];

  const sum = (name, value, attributes = {}, type = 'asInt') => {
    metrics.push({
      name,
      sum: { dataPoints: [dataPoint(now, value, attributes, type, true)], aggregationTemporality: AGGREGATION_TEMPORALITY_CUMULATIVE, isMonotonic: true },
    });
  };
  const gauge = (name, value, attributes = {}, type = 'asDouble') => {
    metrics.push({ name, gauge: { dataPoints: [dataPoint(now, value, attributes, type, false)] } });
  };

  sum('http_requests', requests.total, { method: 'ALL' });
  TRACKED_METHODS.forEach((method) => sum('http_requests', requests[method], { method }));

  sum('auth_attempts', auth.success, { status: 'success' });
  sum('auth_attempts', auth.failure, { status: 'failure' });

  gauge('active_users', getActiveUserCount(), {}, 'asInt');
  gauge('cpu_usage_percent', getCpuUsagePercentage());
  gauge('memory_usage_percent', getMemoryUsagePercentage());

  sum('pizzas_sold', pizzas.sold);
  sum('pizza_creation_failures', pizzas.failures);
  sum('pizza_revenue', pizzas.revenue, {}, 'asDouble');

  if (serviceLatency.count > 0) {
    gauge('service_latency_ms', serviceLatency.sum / serviceLatency.count);
  }
  if (pizzaLatency.count > 0) {
    gauge('pizza_creation_latency_ms', pizzaLatency.sum / pizzaLatency.count);
  }
  serviceLatency = { sum: 0, count: 0 };
  pizzaLatency = { sum: 0, count: 0 };

  return { resourceMetrics: [{ scopeMetrics: [{ metrics }] }] };
}

function dataPoint(timeUnixNano, value, attributes, type, cumulative) {
  const allAttributes = { source: config.metrics?.source ?? 'jwt-pizza-service', ...attributes };
  return {
    [type]: value,
    timeUnixNano,
    ...(cumulative && { startTimeUnixNano }),
    attributes: Object.entries(allAttributes).map(([key, v]) => ({ key, value: { stringValue: v } })),
  };
}

// Nanosecond timestamps exceed Number.MAX_SAFE_INTEGER, so OTLP JSON accepts them as strings.
function toUnixNano(ms) {
  return `${ms}000000`;
}

async function sendMetrics() {
  const { endpointUrl, accountId, apiKey } = config.metrics ?? {};
  if (!endpointUrl) {
    return;
  }
  try {
    const res = await fetch(endpointUrl, {
      method: 'POST',
      body: JSON.stringify(buildMetrics()),
      headers: { Authorization: `Bearer ${accountId}:${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      console.log('Failed to push metrics to Grafana', res.status, await res.text());
    }
  } catch (error) {
    console.log('Error sending metrics', error);
  }
}

function sendMetricsPeriodically(period) {
  return setInterval(sendMetrics, period);
}

module.exports = { requestTracker, pizzaPurchase, buildMetrics, sendMetrics, sendMetricsPeriodically };
