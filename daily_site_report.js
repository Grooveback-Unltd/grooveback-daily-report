#!/usr/bin/env node

/**
 * Daily Grooveback All Sites Report
 *
 * Pulls yesterday's GA4 metrics (users, sessions, pageviews) for 8 sites,
 * checks uptime + response time, and outputs JSON.
 *
 * Usage: GA4_SERVICE_ACCOUNT_JSON='{"type":"service_account"...}' node daily_site_report.js
 *
 * Output: JSON to stdout: { date, rows: [{domain, ...}], needsAttention: [...] }
 * Never prints the key or access token.
 */

const crypto = require('crypto');
const https = require('https');

// Sites to monitor: domain, GA4 property ID
const SITES = [
  { domain: 'embracefulfillment.com', propertyId: '560906748' },
  { domain: 'groovebackmedia.com', propertyId: '311881494' },
  { domain: 'groovebackunltd.com', propertyId: '311326766' },
  { domain: 'malindanorriscoaching.com', propertyId: '259575098' },
  { domain: 'snovalleymobilenotary.com', propertyId: '404510648' },
  { domain: 'thegravelriders.com', propertyId: '311905012' },
  { domain: 'untetheredabroad.com', propertyId: '504864766' },
  { domain: 'the-creative-awakening.com', propertyId: '560923660' },
];

const httpsRequest = (url, options, body) => {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
};

const mintGa4Token = (keyJson) => {
  const key = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson;

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;

  const claims = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp,
    iat: now,
  };

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const message = `${header}.${payload}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message);
  const signature = sign.sign(key.private_key, 'base64url');
  const jwt = `${message}.${signature}`;

  return new Promise((resolve, reject) => {
    const body = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`;
    const opts = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    httpsRequest(new URL('https://oauth2.googleapis.com/token'), opts, body)
      .then(res => {
        if (res.status !== 200) {
          reject(new Error(`Token exchange failed: ${res.status} ${res.body}`));
        } else {
          const tokenData = JSON.parse(res.body);
          resolve(tokenData.access_token);
        }
      })
      .catch(reject);
  });
};

const getYesterdayDateRange = () => {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const toIsoDate = (d) => d.toISOString().split('T')[0];
  return { startDate: toIsoDate(yesterday), endDate: toIsoDate(yesterday) };
};

const fetchGa4Report = async (token, propertyId) => {
  const { startDate, endDate } = getYesterdayDateRange();

  const body = JSON.stringify({
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'sessions' },
      { name: 'screenPageViews' },
    ],
  });

  const opts = {
    hostname: 'analyticsdata.googleapis.com',
    path: `/v1beta/properties/${propertyId}:runReport`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  try {
    const res = await httpsRequest(new URL(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`), opts, body);
    if (res.status !== 200) {
      return { error: `GA4 API: ${res.status}`, activeUsers: 0, sessions: 0, screenPageViews: 0 };
    }

    const data = JSON.parse(res.body);
    if (!data.rows || data.rows.length === 0) {
      return { activeUsers: 0, sessions: 0, screenPageViews: 0 };
    }

    const row = data.rows[0];
    return {
      activeUsers: parseInt(row.metricValues[0].value) || 0,
      sessions: parseInt(row.metricValues[1].value) || 0,
      screenPageViews: parseInt(row.metricValues[2].value) || 0,
    };
  } catch (err) {
    return { error: err.message, activeUsers: 0, sessions: 0, screenPageViews: 0 };
  }
};

const checkUptime = async (domain) => {
  const startMs = Date.now();
  const timeout = 20000;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ status: 0, responseTime: timeout, error: 'timeout' });
    }, timeout);

    const opts = {
      hostname: domain,
      path: '/',
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: timeout,
    };

    const req = https.request(opts, (res) => {
      clearTimeout(timer);
      const responseTime = Date.now() - startMs;
      resolve({ status: res.statusCode, responseTime, error: null });
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      // Try http fallback
      const opts2 = {
        hostname: domain,
        path: '/',
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: timeout,
      };
      const req2 = require('http').request(opts2, (res) => {
        const responseTime = Date.now() - startMs;
        resolve({ status: res.statusCode, responseTime, error: null });
      });
      req2.on('error', () => {
        resolve({ status: 0, responseTime: Date.now() - startMs, error: err.message });
      });
      req2.end();
    });

    req.end();
  });
};

const main = async () => {
  const keyJson = process.env.GA4_SERVICE_ACCOUNT_JSON;

  if (!keyJson || !keyJson.trim()) {
    console.log(JSON.stringify({ error: 'GA4_SERVICE_ACCOUNT_JSON is missing or empty' }));
    process.exit(0);
  }

  let token;
  try {
    token = await mintGa4Token(keyJson);
  } catch (err) {
    console.log(JSON.stringify({ error: `Failed to mint GA4 token: ${err.message}` }));
    process.exit(0);
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const rows = [];
  const needsAttention = [];

  for (const site of SITES) {
    const ga4Data = await fetchGa4Report(token, site.propertyId);
    const uptime = await checkUptime(site.domain);

    const isDown = uptime.status === 0 || uptime.status >= 500;
    const hasGa4Error = ga4Data.error ? true : false;
    const hasZeroTraffic = ga4Data.activeUsers === 0 && !isDown;

    rows.push({
      domain: site.domain,
      activeUsers: ga4Data.activeUsers || 0,
      sessions: ga4Data.sessions || 0,
      screenPageViews: ga4Data.screenPageViews || 0,
      uptimeStatus: isDown ? 'DOWN' : 'UP',
      responseTime: uptime.responseTime,
      ga4Error: ga4Data.error || null,
    });

    if (isDown) {
      needsAttention.push({ domain: site.domain, reason: 'Site is down', status: uptime.status });
    } else if (hasGa4Error) {
      needsAttention.push({ domain: site.domain, reason: `GA4 error: ${ga4Data.error}` });
    } else if (hasZeroTraffic) {
      needsAttention.push({ domain: site.domain, reason: 'Zero traffic on live site' });
    }
  }

  console.log(JSON.stringify({ date: dateStr, rows, needsAttention }, null, 0));
};

main().catch(err => {
  console.log(JSON.stringify({ error: `Unexpected error: ${err.message}` }));
  process.exit(1);
});
