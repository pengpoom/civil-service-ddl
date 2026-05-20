import fs from 'node:fs';

const items = JSON.parse(fs.readFileSync(new URL('../data/items.json', import.meta.url), 'utf8'));
const sources = JSON.parse(fs.readFileSync(new URL('../data/sources.json', import.meta.url), 'utf8'));
const errors = [];
const seenIds = new Set();

if (!Array.isArray(items) || items.length === 0) errors.push('items.json must contain at least one item');
if (!sources || !Array.isArray(sources.sourceFamilies)) errors.push('sources.json missing sourceFamilies');

for (const item of items) {
  for (const key of ['id', 'title', 'deadline', 'dateRange', 'url', 'source', 'status']) {
    if (!item[key]) errors.push(`${item.id || '<missing-id>'}: missing ${key}`);
  }
  if (item.id && seenIds.has(item.id)) errors.push(`${item.id}: duplicate id`);
  if (item.id) seenIds.add(item.id);
  if (item.deadline && Number.isNaN(Date.parse(item.deadline))) errors.push(`${item.id}: invalid deadline ${item.deadline}`);
  if (item.url && !/^https?:\/\//.test(item.url)) errors.push(`${item.id}: invalid url ${item.url}`);
  if (!['upcoming', 'ongoing', 'ended'].includes(item.status)) errors.push(`${item.id}: invalid status ${item.status}`);
  if (!Array.isArray(item.tags) || item.tags.length === 0) errors.push(`${item.id}: tags must be a non-empty array`);
  if (item.isDatePlaceholder && item.dateRange !== '以官方公告为准') {
    errors.push(`${item.id}: placeholder dates must use dateRange "以官方公告为准"`);
  }
  const text = JSON.stringify(item);
  if (/\?\?\?\?|�/.test(text)) errors.push(`${item.id}: contains mojibake placeholder`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`validated ${items.length} DDL items and ${sources.sourceFamilies.length} source families`);
