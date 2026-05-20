import fs from 'node:fs';

const items = JSON.parse(fs.readFileSync(new URL('../data/items.json', import.meta.url), 'utf8'));
const strict = process.env.STRICT_LINK_CHECK === '1';
const TIMEOUT = Number(process.env.LINK_CHECK_TIMEOUT_MS) || 7000;
const CONCURRENCY = Number(process.env.LINK_CHECK_CONCURRENCY) || 4;
const urls = [...new Map(items.map(item => [item.url, item])).entries()];
const failures = [];
const RETRY_STATUSES = new Set([403, 404, 405, 406, 429, 500, 502, 503]);

async function checkUrl(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    clearTimeout(timer);
    if (res.status < 400) return { ok: true, method: 'HEAD', status: res.status };
    if (!RETRY_STATUSES.has(res.status)) return { ok: false, method: 'HEAD', status: res.status };
  } catch {
    // Some government sites reject HEAD or modern TLS clients. Fall through to GET.
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Range: 'bytes=0-2047',
        'User-Agent': 'Just-DDL-LinkCheck/1.0'
      }
    });
    clearTimeout(timer);
    if (res.status < 400 || res.status === 206) return { ok: true, method: 'GET', status: res.status };
    return { ok: false, method: 'GET', status: res.status };
  } catch (error) {
    return { ok: false, method: 'GET', status: 0, error: error.message };
  }
}

for (let i = 0; i < urls.length; i += CONCURRENCY) {
  const batch = urls.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map(async ([url, item]) => {
    const result = await checkUrl(url);
    return { url, item, result };
  }));
  for (const { url, item, result } of results) {
    if (!result.ok) {
      const statusPart = result.status ? String(result.status) : 'ERR';
      const errorPart = result.error ? ` :: ${result.error}` : '';
      failures.push(`[${result.method}:${statusPart}] ${url} (${item.title})${errorPart}`);
    }
  }
}

if (failures.length) {
  console.warn(failures.join('\n'));
  if (strict) process.exit(1);
}

console.log(`checked ${urls.length} unique links; failures=${failures.length}; strict=${strict}; timeout=${TIMEOUT}ms; concurrency=${CONCURRENCY}`);
