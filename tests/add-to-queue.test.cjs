const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const loadWorkflow = name => JSON.parse(fs.readFileSync(path.join(root, 'workflows', `${name}.json`), 'utf8'));
const addCode = loadWorkflow('add-to-queue').nodes.find(node => node.name === 'Validate URL and hash').parameters.jsCode;
const routerCode = loadWorkflow('bot-router').nodes.find(node => node.name === 'Authorize and classify').parameters.jsCode;
const runAdd = url => new Function('$json', 'require', addCode)({vacancy_url: url}, require).json;
const runRouter = (event, env) => new Function('$json', '$env', routerCode)(event, env);

test('normalizes and hashes an accepted vacancy URL', () => {
  const result = runAdd('https://www.justjoin.it/offers/python-role');
  const expectedId = crypto.createHash('sha256')
    .update('https://www.justjoin.it/offers/python-role')
    .digest('hex')
    .slice(0, 12);

  assert.equal(result.valid, true);
  assert.equal(result.id, expectedId);
  assert.equal(result.id.length, 12);
  assert.equal(result.source, 'justjoinit');
  assert.equal(result.status, 'new');
});

for (const url of [
  'http://example.com/job',
  'javascript:alert(1)',
  'https://user:pass@example.com/job',
  'https://127.0.0.1/job',
  'https://localhost/job',
  'not a URL'
]) {
  test(`rejects unsafe or invalid URL: ${url}`, () => {
    assert.equal(runAdd(url).valid, false);
  });
}

test('router silently ignores chats outside the allowlist', () => {
  const result = runRouter({message: {chat: {id: 42}, text: '/next'}}, {ALLOWED_CHAT_ID: '99'});
  assert.deepEqual(result, []);
});

test('router accepts the configured chat and stable callback IDs', () => {
  const event = {callback_query: {id: 'callback-id', data: 'skip:abcdef123456', message: {chat: {id: 99}}}};
  const result = runRouter(event, {ALLOWED_CHAT_ID: '99'})[0].json;
  assert.equal(result.route, 'skip');
  assert.equal(result.id, 'abcdef123456');
});

test('router carries pasted vacancy text with the stable id', () => {
  const event = {message: {chat: {id: 99}, text: '/text abcdef123456 Python and PostgreSQL are required.'}};
  const result = runRouter(event, {ALLOWED_CHAT_ID: '99'})[0].json;
  assert.equal(result.route, 'text');
  assert.equal(result.id, 'abcdef123456');
  assert.equal(result.vacancy_text, 'Python and PostgreSQL are required.');
});

test('router recognizes the unmodified CV choice', () => {
  const event = {callback_query: {id: 'callback-id', data: 'unmodified:abcdef123456', message: {chat: {id: 99}}}};
  const result = runRouter(event, {ALLOWED_CHAT_ID: '99'})[0].json;
  assert.equal(result.route, 'unmodified');
  assert.equal(result.id, 'abcdef123456');
});
