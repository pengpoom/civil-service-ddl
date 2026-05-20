import crypto from 'node:crypto';
import fs from 'node:fs';

const CRAWL_TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS) || 20000;
const REACHABILITY_TIMEOUT_MS = Number(process.env.REACHABILITY_TIMEOUT_MS) || Math.min(7000, CRAWL_TIMEOUT_MS);
const DETAIL_LIMIT = Number(process.env.BEIJING_PUBLIC_RECRUITMENT_DETAIL_LIMIT) || 24;
const USER_AGENT = 'Just-DDL-Crawler/1.0 (+https://just-agent.github.io/just-ddl/)';

const sourceFamilies = JSON.parse(fs.readFileSync(new URL('../data/sources.json', import.meta.url), 'utf8')).sourceFamilies;
const existingItemsUrl = new URL('../data/items.json', import.meta.url);
const existingItems = JSON.parse(fs.readFileSync(existingItemsUrl, 'utf8'));
const existingSourceBoardItems = existingItems.filter(item => item.isDatePlaceholder);
const previousParsedItems = existingItems.filter(item => !item.isDatePlaceholder);

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim().slice(0, 200) : null;
}

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function htmlToText(html) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMeta(html, name) {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${name}["']`, 'i')
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtml(match[1]).trim();
  }
  return null;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function toIsoDeadline(year, month, day, meridiem, rawHour, rawMinute) {
  let hour = rawHour == null ? 23 : Number(rawHour);
  const minute = rawMinute == null ? (rawHour == null ? 59 : 0) : Number(rawMinute);

  if (/下午|晚上|晚间/.test(meridiem || '') && hour < 12) hour += 12;
  if (/上午/.test(meridiem || '') && hour === 12) hour = 0;

  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+08:00`;
}

function parseChineseDeadline(text, fallbackYear = new Date().getFullYear()) {
  const compact = text.replace(/\s+/g, '');
  const patterns = [
    /报名[^。；;]{0,120}(?:至|到|截至|截止(?:时间)?(?:为|：)?)(\d{4})年(\d{1,2})月(\d{1,2})日(?:（[^）]*）|\([^)]*\))?(?:(上午|下午|晚上|晚间)?(\d{1,2})(?:[:：](\d{1,2}))?时?)?(?:前|止)?/,
    /(?:报名截止|截止时间)[^。；;]{0,40}(\d{4})年(\d{1,2})月(\d{1,2})日(?:（[^）]*）|\([^)]*\))?(?:(上午|下午|晚上|晚间)?(\d{1,2})(?:[:：](\d{1,2}))?时?)?(?:前|止)?/,
    /(?:于|至|到)(\d{4})年(\d{1,2})月(\d{1,2})日(?:（[^）]*）|\([^)]*\))?(?:(上午|下午|晚上|晚间)?(\d{1,2})(?:[:：](\d{1,2}))?时?)?(?:前|之前|止)[^。；;]{0,80}(?:发送|提交|报名|投递)/,
    /报名[^。；;]{0,120}(?:至|到)(\d{1,2})月(\d{1,2})日(?:（[^）]*）|\([^)]*\))?(?:(上午|下午|晚上|晚间)?(\d{1,2})(?:[:：](\d{1,2}))?时?)?(?:前|止)?/
  ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (!match) continue;
    const hasYear = match[1].length === 4;
    const year = hasYear ? match[1] : fallbackYear;
    const month = hasYear ? match[2] : match[1];
    const day = hasYear ? match[3] : match[2];
    const meridiem = hasYear ? match[4] : match[3];
    const hour = hasYear ? match[5] : match[4];
    const minute = hasYear ? match[6] : match[5];
    return {
      iso: toIsoDeadline(year, month, day, meridiem, hour, minute),
      label: `报名截止：${year}年${Number(month)}月${Number(day)}日 ${hour ? `${Number(hour)}:${pad(minute || 0)}` : '23:59'}`
    };
  }
  return null;
}

function statusForDeadline(isoDeadline) {
  return Date.parse(isoDeadline) < Date.now() ? 'ended' : 'upcoming';
}

function stableId(prefix, url) {
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
  return `${prefix}-${hash}`;
}

function buildTags(title) {
  const tags = ['事业单位', '招聘', '报名'];
  if (/教师|学校|教育/.test(title)) tags.push('教师');
  if (/医院|卫生|医科|医疗/.test(title)) tags.push('医疗');
  return tags.slice(0, 5);
}

function parseBeijingPublicRecruitmentList(html, baseUrl) {
  const items = [];
  const pattern = /<li><i><\/i><a href="([^"]+)"[^>]*title="([^"]+)"[\s\S]*?<span>(\d{4}-\d{2}-\d{2})<\/span><\/li>/g;
  let match;
  while ((match = pattern.exec(html))) {
    const [, href, rawTitle, publishedAt] = match;
    const title = decodeHtml(rawTitle).trim();
    if (!/公开招聘|事业单位|人才引进/.test(title)) continue;
    items.push({
      title,
      url: new URL(href, baseUrl).toString(),
      publishedAt
    });
  }
  return items;
}

async function parseBeijingPublicRecruitment(source, listHtml) {
  const pageUrls = [source.url, new URL('index_1.html', source.url).toString()];
  const pageHtmls = [listHtml];
  for (const pageUrl of pageUrls.slice(1)) {
    try {
      pageHtmls.push(await fetchText(pageUrl, CRAWL_TIMEOUT_MS));
    } catch {
      // Keep the first page useful even if older pages are temporarily unavailable.
    }
  }
  const dedupedCandidates = new Map();
  for (let index = 0; index < pageHtmls.length; index += 1) {
    for (const candidate of parseBeijingPublicRecruitmentList(pageHtmls[index], pageUrls[index])) {
      dedupedCandidates.set(candidate.url, candidate);
    }
  }
  const candidates = [...dedupedCandidates.values()].slice(0, DETAIL_LIMIT);
  const parsedItems = [];
  const errors = [];

  for (const candidate of candidates) {
    try {
      const detailHtml = await fetchText(candidate.url, CRAWL_TIMEOUT_MS);
      const text = htmlToText(detailHtml);
      const title = extractMeta(detailHtml, 'ArticleTitle') || candidate.title;
      const pubDate = extractMeta(detailHtml, 'PubDate') || candidate.publishedAt;
      const fallbackYear = pubDate ? Number(pubDate.slice(0, 4)) : new Date().getFullYear();
      const deadline = parseChineseDeadline(text, fallbackYear);
      if (!deadline) continue;

      parsedItems.push({
        id: stableId('civil-service-ddl-beijing-public-recruitment', candidate.url),
        title,
        deadline: deadline.iso,
        dateRange: deadline.label,
        location: '北京',
        isOnline: true,
        tags: buildTags(title),
        url: candidate.url,
        status: statusForDeadline(deadline.iso),
        description: `北京公开招聘公告，已解析报名截止时间。`,
        stage: '报名截止',
        source: source.name,
        type: 'program',
        publishedAt: pubDate
      });
    } catch (error) {
      errors.push(`${candidate.url}: ${error.message}`);
    }
  }

  return { items: parsedItems, errors, candidateCount: candidates.length };
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    });
    const text = await res.text();
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSourcePage(source) {
  const report = {
    sourceId: source.id,
    source: source.name,
    url: source.url,
    items: [],
    reachable: false,
    httpStatus: null,
    finalUrl: null,
    title: null,
    contentLength: null,
    fetchedAt: new Date().toISOString(),
    parsedItemCount: 0,
    invalidItemCount: 0,
    parserHealthy: source.adapter !== 'beijingPublicRecruitmentAdapter',
    note: 'Source reachability check only; curated data/items.json preserved unless a source-specific parser emits valid items.',
    error: null
  };

  try {
    const res = await fetch(source.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS),
      headers: { 'User-Agent': USER_AGENT }
    });
    report.httpStatus = res.status;
    report.finalUrl = res.url;
    const text = await res.text();
    report.contentLength = text.length;
    report.title = extractTitle(text);
    report.reachable = res.status >= 200 && res.status < 400;

    if (report.reachable && source.adapter === 'beijingPublicRecruitmentAdapter') {
      const parsed = await parseBeijingPublicRecruitment(source, text);
      report.items = parsed.items;
      report.parsedItemCount = parsed.items.length;
      report.invalidItemCount = Math.max(0, parsed.candidateCount - parsed.items.length);
      report.parserHealthy = parsed.items.length > 0;
      report.parseErrors = parsed.errors;
      report.note = parsed.items.length > 0
        ? `Parsed ${parsed.items.length} real recruitment deadline items from ${parsed.candidateCount} candidates.`
        : `No real deadline parsed from ${parsed.candidateCount} candidates; curated data/items.json will be preserved.`;
      return report;
    }

    report.note = report.reachable
      ? 'Source reachable. Curated data/items.json preserved unless a source-specific parser emits valid items.'
      : `Source returned HTTP ${res.status}. Curated data/items.json preserved.`;
  } catch (err) {
    report.error = err.name === 'AbortError' ? `Timeout after ${REACHABILITY_TIMEOUT_MS}ms` : err.message;
    report.note = `Source fetch failed: ${report.error}. Curated data/items.json preserved.`;
  }
  return report;
}

const reports = await Promise.all(sourceFamilies.map(fetchSourcePage));
const reachableCount = reports.filter(report => report.reachable).length;
const parsedItems = reports.flatMap(report => report.items || []);
const previousParsedItemCount = previousParsedItems.length;
const parserDropOk = previousParsedItemCount === 0 || parsedItems.length >= Math.ceil(previousParsedItemCount * 0.5);
const shouldWriteParsedItems = parsedItems.length > 0 && parserDropOk;
const nextItems = shouldWriteParsedItems
  ? [...existingSourceBoardItems, ...parsedItems]
  : existingItems;

if (shouldWriteParsedItems) {
  fs.writeFileSync(existingItemsUrl, JSON.stringify(nextItems, null, 2) + '\n', 'utf8');
}

fs.writeFileSync(new URL('../data/crawl-report.json', import.meta.url), JSON.stringify({
  topicId: 'civil-service-ddl',
  generatedAt: new Date().toISOString(),
  adapterCount: reports.length,
  reachableCount,
  parsedItemCount: parsedItems.length,
  previousParsedItemCount,
  parserHealthy: reports.every(report => report.parserHealthy !== false),
  parserDropOk,
  wroteItems: shouldWriteParsedItems,
  adapters: reports
}, null, 2) + '\n', 'utf8');

console.log(shouldWriteParsedItems
  ? `parser emitted ${parsedItems.length} items; wrote ${nextItems.length} total items to data/items.json`
  : `parser emitted ${parsedItems.length} items; preserving ${existingItems.length} existing items in data/items.json`);
console.log(`reachability: ${reachableCount}/${reports.length} sources reachable`);
