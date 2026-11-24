'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_WEBHOOK_URL = 'http://n8n:5678/webhook/telegram-updates';
const DEFAULT_OFFSET_FILE = '/state/offset';
const DEFAULT_LANGUAGE_FILE = '/state/languages.json';
const SUPPORTED_LANGUAGES = new Set(['en', 'pl', 'ru', 'uk']);

async function telegramApiCall(token, method, parameters, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(parameters),
    signal: AbortSignal.timeout(65_000)
  });

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Telegram ${method} returned invalid JSON (HTTP ${response.status})`);
  }
  if (!response.ok || result?.ok !== true) {
    throw new Error(`Telegram ${method} failed (HTTP ${result?.error_code || response.status})`);
  }
  return result.result;
}

async function forwardUpdate(update, {webhookUrl, secret, fetchImpl = fetch}) {
  const response = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-forward-secret': secret
    },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error(`n8n webhook failed (HTTP ${response.status})`);
  }
}

async function pollOnce({
  token,
  cursor,
  webhookUrl,
  secret,
  timeoutSeconds = 50,
  fetchImpl = fetch,
  saveOffset,
  languageFile,
  defaultLanguage = 'pl',
  allowedChatId = ''
}) {
  const updates = await telegramApiCall(token, 'getUpdates', {
    offset: cursor.offset,
    timeout: timeoutSeconds,
    allowed_updates: ['message', 'callback_query']
  }, fetchImpl);
  if (!Array.isArray(updates)) {
    throw new Error('Telegram getUpdates returned an invalid result');
  }

  for (const update of updates) {
    if (!Number.isSafeInteger(update.update_id) || update.update_id < cursor.offset) {
      throw new Error('Telegram returned an invalid update id');
    }
    const forwardedUpdate = languageFile
      ? await attachLanguage(update, {languageFile, defaultLanguage, allowedChatId})
      : update;
    await forwardUpdate(forwardedUpdate, {webhookUrl, secret, fetchImpl});
    const nextOffset = update.update_id + 1;
    await saveOffset(nextOffset);
    cursor.offset = nextOffset;
  }
  return cursor.offset;
}

function updateChatId(update) {
  return update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
}

async function attachLanguage(update, {languageFile, defaultLanguage = 'pl', allowedChatId = ''}) {
  const chatId = updateChatId(update);
  if (chatId === undefined) return {...update, ui_language: defaultLanguage};

  const languages = await loadLanguages(languageFile);
  const chatKey = String(chatId);
  const command = String(update.message?.text || '').match(/^\/lang(?:@\w+)?\s+(en|pl|ru|uk)\s*$/i);
  if (command && allowedChatId && chatKey === String(allowedChatId)) {
    languages[chatKey] = command[1].toLowerCase();
    await saveLanguages(languageFile, languages);
  }
  return {...update, ui_language: languages[chatKey] || defaultLanguage};
}

async function loadOffset(filePath = DEFAULT_OFFSET_FILE) {
  let contents;
  try {
    contents = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }

  const offset = Number(contents.trim());
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('Telegram polling offset file is invalid');
  }
  return offset;
}

async function loadLanguages(filePath = DEFAULT_LANGUAGE_FILE) {
  let contents;
  try {
    contents = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }

  let languages;
  try {
    languages = JSON.parse(contents);
  } catch {
    throw new Error('Telegram language preference file is invalid JSON');
  }
  if (!languages || typeof languages !== 'object' || Array.isArray(languages)
    || Object.entries(languages).some(([chatId, language]) =>
      !chatId || typeof language !== 'string' || !SUPPORTED_LANGUAGES.has(language))) {
    throw new Error('Telegram language preference file is invalid');
  }
  return languages;
}

async function saveLanguages(filePath, languages) {
  if (!languages || typeof languages !== 'object' || Array.isArray(languages)
    || Object.entries(languages).some(([chatId, language]) =>
      !chatId || typeof language !== 'string' || !SUPPORTED_LANGUAGES.has(language))) {
    throw new Error('Telegram language preferences are invalid');
  }
  await fs.mkdir(path.dirname(filePath), {recursive: true, mode: 0o700});
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(languages)}\n`, {mode: 0o600});
  await fs.rename(temporaryPath, filePath);
}

async function saveOffset(filePath, offset) {
  await fs.mkdir(path.dirname(filePath), {recursive: true, mode: 0o700});
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${offset}\n`, {mode: 0o600});
  await fs.rename(temporaryPath, filePath);
}

function readConfig(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = env.TELEGRAM_FORWARD_SECRET?.trim();
  const timeoutSeconds = Number(env.POLL_TIMEOUT_SECONDS || 50);
  const defaultLanguage = (env.BOT_DEFAULT_LANGUAGE || 'pl').trim().toLowerCase();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
  if (!secret || secret.length < 32) throw new Error('TELEGRAM_FORWARD_SECRET must contain at least 32 characters');
  if (!SUPPORTED_LANGUAGES.has(defaultLanguage)) {
    throw new Error('BOT_DEFAULT_LANGUAGE must be en, pl, ru, or uk');
  }
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 50) {
    throw new Error('POLL_TIMEOUT_SECONDS must be an integer from 1 to 50');
  }

  return {
    token,
    secret,
    webhookUrl: env.N8N_WEBHOOK_URL_INTERNAL || DEFAULT_WEBHOOK_URL,
    offsetFile: env.OFFSET_FILE || DEFAULT_OFFSET_FILE,
    languageFile: env.LANGUAGE_FILE || DEFAULT_LANGUAGE_FILE,
    defaultLanguage,
    allowedChatId: env.ALLOWED_CHAT_ID?.trim() || '',
    timeoutSeconds
  };
}

async function run() {
  const config = readConfig();
  const cursor = {offset: await loadOffset(config.offsetFile)};
  const persistOffset = offset => saveOffset(config.offsetFile, offset);

  await telegramApiCall(config.token, 'deleteWebhook', {drop_pending_updates: false});
  console.info('Telegram polling mode initialized');

  let retryDelay = 1_000;
  let connected = false;
  while (true) {
    try {
      const previousOffset = cursor.offset;
      await pollOnce({...config, cursor, saveOffset: persistOffset});
      if (!connected) {
        console.info('Telegram long polling connected');
        connected = true;
      }
      if (cursor.offset > previousOffset) {
        console.info(`Forwarded ${cursor.offset - previousOffset} Telegram update(s)`);
      }
      retryDelay = 1_000;
    } catch (error) {
      console.error(`Telegram polling error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 30_000);
    }
  }
}

if (require.main === module) {
  run().catch(error => {
    console.error(`Telegram poller stopped: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  forwardUpdate,
  attachLanguage,
  loadOffset,
  loadLanguages,
  pollOnce,
  readConfig,
  saveOffset,
  saveLanguages,
  telegramApiCall
};
