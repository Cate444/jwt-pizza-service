const config = require('./config.js');

const SECRET_KEYS = ['password', 'token', 'jwt', 'apikey', 'authorization'];
const MASK = '*****';

// Returns a copy of value with secrets masked and emails partially masked. JSON strings are parsed first.
function sanitize(value) {
  if (typeof value === 'string') {
    try {
      return sanitize(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, sanitizeField(key, v)]));
  }
  return value;
}

function sanitizeField(key, value) {
  const lowerKey = key.toLowerCase();
  if (SECRET_KEYS.includes(lowerKey)) {
    return MASK;
  }
  if (lowerKey === 'email' && typeof value === 'string') {
    return maskEmail(value);
  }
  return typeof value === 'object' ? sanitize(value) : value;
}

function maskEmail(email) {
  const [name, domain] = email.split('@');
  return domain ? `${name[0]}***@${domain}` : MASK;
}

// Sends one sanitized event to Grafana Loki, labeled so the dashboard can filter by level and type.
async function log(level, type, event) {
  const { source, endpointUrl, accountId, apiKey } = config.logging ?? {};
  if (!endpointUrl) {
    return;
  }
  const body = {
    streams: [{ stream: { source, level, type }, values: [[`${Date.now()}000000`, JSON.stringify(sanitize(event))]] }],
  };
  try {
    const res = await fetch(endpointUrl, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${accountId}:${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      console.log('Failed to send log to Grafana', res.status, await res.text());
    }
  } catch (error) {
    console.log('Error sending log', error);
  }
}

module.exports = { sanitize, log };
