# Grooveback Daily Report

Automated daily GA4 analytics and uptime monitoring for 8 Grooveback properties.

## What it does

- Pulls yesterday's GA4 metrics (active users, sessions, pageviews) for 8 sites
- Checks uptime + response time for each domain
- Flags sites that are down, have GA4 errors, or show zero traffic despite being live
- Outputs structured JSON for the routine to convert to an email report

## Usage

```bash
GA4_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' node daily_site_report.js
```

Output: JSON to stdout with `{ date, rows: [...], needsAttention: [...] }`

The service account key must have Viewer access on all 8 GA4 properties.

## Sites monitored

- embracefulfillment.com
- groovebackmedia.com
- groovebackunltd.com
- malindanorriscoaching.com
- snovalleymobilenotary.com
- thegravelriders.com
- untetheredabroad.com
- the-creative-awakening.com

## Security

- Never prints the service account key or access token
- JWT signing happens in-memory only
- Intended to run in a sandboxed Claude Code cloud routine
