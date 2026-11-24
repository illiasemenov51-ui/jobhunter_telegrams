const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflows', 'ingest-job-alerts.json'), 'utf8'));
const extractCode = workflow.nodes.find(node => node.name === 'Extract vacancy links').parameters.jsCode;

const extract = messages => new Function('$input', 'require', extractCode)(
  {all: () => messages.map(json => ({json}))},
  require
).map(item => item.json);

test('extracts, normalizes, and deduplicates recognized vacancy links', () => {
  const url = 'https://www.linkedin.com/jobs/view/12345?utm_source=email&ref=alert';
  const result = extract([{html: `<a href="${url}">Role</a>`}, {text: url}]);
  const normalized = 'https://www.linkedin.com/jobs/view/12345';

  assert.equal(result.length, 1);
  assert.equal(result[0].url, normalized);
  assert.equal(result[0].source, 'linkedin');
  assert.equal(result[0].id, crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12));
});

test('ignores unrelated and non-vacancy links', () => {
  const result = extract([{html: 'https://example.com/jobs/1 https://linkedin.com/help/jobs'}]);
  assert.deepEqual(result, []);
});

test('workflow filters existing IDs before writing the queue', () => {
  const filter = workflow.nodes.find(node => node.name === 'Keep only new vacancies');
  assert.ok(filter.parameters.jsCode.includes('existing.has'));
  assert.equal(workflow.connections['Extract vacancy links'].main[0][0].node, 'Read existing queue');
});
