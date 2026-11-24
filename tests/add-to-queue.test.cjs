const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const loadWorkflow = name => JSON.parse(fs.readFileSync(path.join(root, 'workflows', `${name}.json`), 'utf8'));
const addCode = loadWorkflow('add-to-queue').nodes.find(node => node.name === 'Validate URL and hash').parameters.jsCode;
const routerCode = loadWorkflow('bot-router').nodes.find(node => node.name === 'Authorize and classify').parameters.jsCode;
const searchWorkflow = loadWorkflow('search-public-jobs');
const searchCode = searchWorkflow.nodes.find(node => node.name === 'Build official search links').parameters.jsCode;
const forwardSecret = 'test-forward-secret-' + 'a'.repeat(32);
const runAdd = (url, ui_language = 'pl') => new Function('$json', 'require', addCode)({vacancy_url: url, ui_language}, require).json;
const executeRouter = (envelope, env) => new Function('$json', '$env', routerCode)(envelope, env);
const runRouter = (event, env) => executeRouter({
  body: event,
  headers: {'x-telegram-forward-secret': forwardSecret}
}, {...env, TELEGRAM_FORWARD_SECRET: forwardSecret});
const runSearch = (event, env = {JOB_LOCATION: 'Warszawa'}) => new Function('$json', '$', '$env', searchCode)(
  event,
  name => ({first: () => ({json: event})}),
  env
).json;

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

test('router rejects webhook requests without the poller secret', () => {
  const env = {ALLOWED_CHAT_ID: '99', TELEGRAM_FORWARD_SECRET: forwardSecret};
  const body = {body: {message: {chat: {id: 99}, text: '/next'}}};
  assert.deepEqual(executeRouter(body, env), []);
  assert.deepEqual(executeRouter({
    ...body,
    headers: {'x-telegram-forward-secret': 'wrong-secret'}
  }, env), []);
});

test('router accepts the configured chat and stable callback IDs', () => {
  const event = {callback_query: {id: 'callback-id', data: 'skip:abcdef123456', message: {chat: {id: 99}}}};
  const result = runRouter(event, {ALLOWED_CHAT_ID: '99'})[0].json;
  assert.equal(result.route, 'skip');
  assert.equal(result.id, 'abcdef123456');
  assert.equal(result.chat_id, '99');
});

test('router carries pasted vacancy text with the stable id', () => {
  const event = {message: {chat: {id: 99}, text: '/text abcdef123456 Python and PostgreSQL are required.'}};
  const result = runRouter(event, {ALLOWED_CHAT_ID: '99'})[0].json;
  assert.equal(result.route, 'text');
  assert.equal(result.id, 'abcdef123456');
  assert.equal(result.vacancy_text, 'Python and PostgreSQL are required.');
  assert.equal(result.chat_id, '99');
});

test('router retains /next and /add routes', () => {
  const next = runRouter({message: {chat: {id: 99}, text: '/next'}}, {ALLOWED_CHAT_ID: '99'})[0].json;
  const add = runRouter({message: {chat: {id: 99}, text: '/add https://pracuj.pl/praca/example'}}, {ALLOWED_CHAT_ID: '99'})[0].json;

  assert.equal(next.route, 'next');
  assert.equal(add.route, 'add');
  assert.equal(add.vacancy_url, 'https://pracuj.pl/praca/example');
});

test('router accepts a Markdown-formatted link after /add', () => {
  const url = 'https://www.pracuj.pl/praca/example?searchId=123';
  const event = {message: {chat: {id: 99}, text: `/add [${url}](${url})`}};
  const result = runRouter(event, {ALLOWED_CHAT_ID: '99'})[0].json;

  assert.equal(result.route, 'add');
  assert.equal(result.vacancy_url, url);
});

test('router recognizes the unmodified CV choice', () => {
  const event = {callback_query: {id: 'callback-id', data: 'unmodified:abcdef123456', message: {chat: {id: 99}}}};
  const result = runRouter(event, {ALLOWED_CHAT_ID: '99'})[0].json;
  assert.equal(result.route, 'unmodified');
  assert.equal(result.id, 'abcdef123456');
});

test('router sends /help to the authorized Telegram chat', () => {
  const workflow = loadWorkflow('bot-router');
  const event = {message: {chat: {id: 99}, text: '/help'}};
  const result = runRouter(event, {ALLOWED_CHAT_ID: '99'})[0].json;
  const router = workflow.nodes.find(node => node.name === 'Route action');
  const helpExpression = workflow.nodes.find(node => node.name === 'Send help').parameters.text.slice(3, -2);
  const helpFor = language => new Function('$json', `return (${helpExpression})`)({ui_language: language});

  assert.equal(result.route, 'help');
  assert.equal(workflow.nodes[0].type, 'n8n-nodes-base.webhook');
  assert.equal(workflow.nodes[0].parameters.path, 'telegram-updates');
  assert.ok(router.parameters.output.includes("'unmodified', 'help', 'search', 'lang'"));
  assert.equal(workflow.connections['Route action'].main[7][0].node, 'Send help');
  assert.match(helpFor('pl'), /\/search <fraza> \[\| <miasto>\]/);
  assert.match(helpFor('ru'), /\/search <запрос>/);
});

test('router sends /search to official-site links without replacing queue commands', () => {
  const workflow = loadWorkflow('bot-router');
  const event = {message: {chat: {id: 99}, text: '/search junior Java'}};
  const result = runRouter(event, {ALLOWED_CHAT_ID: '99'})[0].json;

  assert.equal(result.route, 'search');
  assert.equal(result.search_query, 'junior Java');
  assert.equal(result.chat_id, '99');
  assert.equal(workflow.connections['Route action'].main[8][0].node, 'Search official sites');
  assert.equal(workflow.connections['Route action'].main[0][0].node, 'Send next card');
  assert.equal(workflow.connections['Route action'].main[1][0].node, 'Add to queue');
});

test('router accepts language changes and defaults unknown locale metadata to Polish', () => {
  const workflow = loadWorkflow('bot-router');
  const event = {ui_language: 'ru', message: {chat: {id: 99}, text: '/lang uk'}};
  const result = runRouter(event, {ALLOWED_CHAT_ID: '99'})[0].json;

  assert.equal(result.route, 'lang');
  assert.equal(result.requested_language, 'uk');
  assert.equal(result.ui_language, 'ru');
  assert.equal(workflow.connections['Route action'].main[9][0].node, 'Confirm language');
});

test('search links use verified official sites and safely encode query text', () => {
  const result = runSearch({
    chat_id: '99',
    ui_language: 'en',
    search_query: '<java & sql> | Kraków'
  });

  assert.match(result.text, /pracuj\.pl\/praca\/krakow;wp\?kw=%3Cjava%20%26%20sql%3E/);
  assert.match(result.text, /justjoin\.it\/job-offers\/krakow\?keyword=%3Cjava%20%26%20sql%3E/);
  assert.match(result.text, /olx\.pl\/praca\/krakow\/q-%3Cjava%20%26%20sql%3E\//);
  assert.match(result.text, /linkedin\.com\/jobs\/search\/\?keywords=%3Cjava%20%26%20sql%3E&amp;location=Krak%C3%B3w/);
  assert.match(result.text, /keyword=%3Cjava%20%26%20sql%3E%20remote/);
  assert.match(result.text, /keyword=%3Cjava%20%26%20sql%3E%20praca%20zdalna/);
  assert.match(result.text, /bot does not download listings/);
  assert.match(result.text, /&lt;java &amp; sql&gt;/);
  assert.ok(!result.text.includes('<java & sql>'));
  assert.equal(searchWorkflow.nodes.some(node => node.type === 'n8n-nodes-base.httpRequest'), false);
  assert.equal(searchWorkflow.nodes.find(node => node.name === 'Send search results').type, 'n8n-nodes-base.telegram');
});

test('search without keywords returns localized usage text', () => {
  const result = runSearch({chat_id: '99', ui_language: 'uk', search_query: ''});
  assert.match(result.text, /Використання: \/search.*місто/);
});

test('vacancy URL errors use the selected bot language', () => {
  assert.match(runAdd('not-a-url', 'en').error, /valid HTTPS URL/);
  assert.match(runAdd('http://example.com/job', 'uk').error, /лише публічні HTTPS-посилання/);
});
