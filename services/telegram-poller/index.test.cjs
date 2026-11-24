'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  pollOnce,
  readConfig,
  telegramApiCall
} = require('./index');

const token = 'test-token';
const secret = 'a'.repeat(32);
const makeResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});

test('pollOnce forwards updates in order and persists each acknowledged offset', async () => {
  const forwarded = [];
  const savedOffsets = [];
  const requests = [];
  const updates = [
    {update_id: 17, message: {text: '/next'}},
    {update_id: 18, callback_query: {data: 'skip:abcdef123456'}}
  ];
  const fetchImpl = async (url, options) => {
    requests.push({url, options});
    if (url.endsWith('/getUpdates')) return makeResponse({ok: true, result: updates});
    forwarded.push(JSON.parse(options.body));
    return makeResponse({ok: true, result: {}});
  };
  const cursor = {offset: 17};

  await pollOnce({
    token,
    cursor,
    webhookUrl: 'http://n8n:5678/webhook/telegram-updates',
    secret,
    fetchImpl,
    saveOffset: async offset => savedOffsets.push(offset)
  });

  assert.deepEqual(forwarded, updates);
  assert.deepEqual(savedOffsets, [18, 19]);
  assert.equal(cursor.offset, 19);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    offset: 17,
    timeout: 50,
    allowed_updates: ['message', 'callback_query']
  });
  assert.equal(requests[1].options.headers['x-telegram-forward-secret'], secret);
});

test('pollOnce does not advance past an update that n8n did not accept', async () => {
  let deliveryCount = 0;
  const savedOffsets = [];
  const fetchImpl = async url => {
    if (url.endsWith('/getUpdates')) {
      return makeResponse({ok: true, result: [
        {update_id: 31, message: {text: '/next'}},
        {update_id: 32, message: {text: '/help'}}
      ]});
    }
    deliveryCount += 1;
    return makeResponse({}, deliveryCount === 1 ? 200 : 503);
  };
  const cursor = {offset: 31};

  await assert.rejects(pollOnce({
    token,
    cursor,
    webhookUrl: 'http://n8n:5678/webhook/telegram-updates',
    secret,
    fetchImpl,
    saveOffset: async offset => savedOffsets.push(offset)
  }), /n8n webhook failed \(HTTP 503\)/);

  assert.deepEqual(savedOffsets, [32]);
  assert.equal(cursor.offset, 32);
});

test('readConfig requires the bot token and a long random forwarding secret', () => {
  assert.throws(() => readConfig({TELEGRAM_FORWARD_SECRET: secret}), /TELEGRAM_BOT_TOKEN is required/);
  assert.throws(() => readConfig({TELEGRAM_BOT_TOKEN: token, TELEGRAM_FORWARD_SECRET: 'short'}), /at least 32 characters/);
  assert.throws(() => readConfig({
    TELEGRAM_BOT_TOKEN: token,
    TELEGRAM_FORWARD_SECRET: secret,
    POLL_TIMEOUT_SECONDS: '51'
  }), /from 1 to 50/);
  assert.equal(readConfig({TELEGRAM_BOT_TOKEN: token, TELEGRAM_FORWARD_SECRET: secret}).webhookUrl,
    'http://n8n:5678/webhook/telegram-updates');
});

test('polling offset survives restart and rejects corrupt state', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-poller-'));
  const offsetFile = path.join(directory, 'offset');
  t.after(() => fs.rm(directory, {recursive: true, force: true}));

  assert.equal(await require('./index').loadOffset(offsetFile), 0);
  await require('./index').saveOffset(offsetFile, 73);
  assert.equal(await require('./index').loadOffset(offsetFile), 73);
  await fs.writeFile(offsetFile, 'invalid');
  await assert.rejects(require('./index').loadOffset(offsetFile), /offset file is invalid/);
});

test('Telegram API errors never include the bot token in their message', async () => {
  await assert.rejects(telegramApiCall(token, 'getUpdates', {}, async () => makeResponse({
    ok: false,
    error_code: 401,
    description: 'unauthorized'
  }, 401)), error => {
    assert.match(error.message, /HTTP 401/);
    assert.ok(!error.message.includes(token));
    return true;
  });
});
