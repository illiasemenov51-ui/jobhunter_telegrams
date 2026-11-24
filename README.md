# Job Swipe Agent

A self-hosted n8n bot for reviewing one vacancy at a time in Telegram. Accepting
a vacancy creates a tailored CV PDF and a Gmail **draft**. The workflow never
sends email or submits an application.

## Setup

1. Install Docker with Compose, then clone this repository:

   ```sh
   git clone <repository-url> jobhunter_telegrams
   cd jobhunter_telegrams
   cp .env.example .env
   ```

2. Edit `.env` and set `TELEGRAM_BOT_TOKEN`, `ALLOWED_CHAT_ID`, `SHEET_ID`,
   `CV_SOURCE`, and (if needed) `GOOGLE_DRIVE_CV_FILE_ID`. The start script
   generates `N8N_ENCRYPTION_KEY` and `TELEGRAM_FORWARD_SECRET` when missing.
   The default model is `claude-sonnet-5-5`; Anthropic bills API usage. Do not
   put credentials in workflow JSON or commit `.env`.
3. Start the stack and import the workflows:

   ```sh
   ./scripts/start.sh
   ./scripts/import.sh
   ```

   The script starts n8n, Gotenberg, and the Telegram polling service when the
   bot token is configured. Polling needs outbound HTTPS only, not a public URL
   or domain. The n8n editor remains bound to localhost.
4. Open `http://localhost:5678`, create the n8n owner account, and configure
   credentials in n8n:
   - **Telegram API:** create a bot with BotFather. Put its token in
     `TELEGRAM_BOT_TOKEN` for the polling service and add the same token as an
     n8n Telegram credential for outgoing messages. The inbound router uses a
     private Webhook node protected by `TELEGRAM_FORWARD_SECRET`.
   - **Anthropic Header Auth:** set header name `x-api-key` and the API key as
     its value. Assign it to the HTTP Request node in `llm-call`.
   - **Google Service Account:** assign the existing service-account credential
     to the Google Sheets nodes. `SHEET_ID` is the spreadsheet ID from its URL;
     share that spreadsheet with the service account's email as an editor.
     The Sheets nodes are configured for service-account authentication.
   - **Google Drive:** the Drive download node also uses service-account
     authentication when `CV_SOURCE=drive`. Share the selected PDF with the
     service account's email as a viewer.
   - **Gmail OAuth2:** configure and assign it to the Gmail Draft node.
5. Prepare the Google spreadsheet:
   - A `queue` tab with these headers in row 1:
     `id`, `url`, `status`, `source`, `title`, `company`, `location`,
     `added_at`, `decided_at`, `draft_link`, `notes`.
   - A `config` tab with `key` and `value` headers. Suggested keys are
     `preferred_keywords`, `excluded_keywords`, `languages`, and `seniority`.
      For tailored CVs, separate multiple values with commas, semicolons, or
      line breaks. These preferences guide emphasis and target seniority without
      overriding facts in the base CV or the vacancy's language.
6. Configure a real CV:
   - For local mode, copy `data/cv_base.example.md` to `data/cv_base.md` and
     replace the example with your own accurate CV. The file is git-ignored and
     mounted read-only into n8n.
   - For Drive mode, set `CV_SOURCE=drive` and `GOOGLE_DRIVE_CV_FILE_ID` to a
     PDF file ID, then make sure the Drive credential can read it.
7. In n8n, open the workflows and assign credentials to their nodes. Activate
   **only `bot-router`**; its private Webhook routes updates from the polling
   service to the inactive sub-workflows. Use the same bot configured above.
8. Send `/help` to see the bot commands, `/next` to review the next vacancy,
   or `/add https://...` to add a vacancy manually.

### Optional Gmail alerts (not enabled)

The repository also contains `workflows/ingest-job-alerts.json`, but the
current setup uses only manual `/add` and `/next`. Leave this optional workflow
inactive unless you later choose to enable Gmail-alert ingestion.

Never paste API keys, bot tokens, or your real CV into chat. Enter credentials
only in your local n8n UI and keep personal CV data out of git.

## Bot behavior

- `/next` and `/start` show one `new` queue row, fetch its URL, and send a card
  with Apply, Skip, and Stop buttons.
- `/help` lists the available commands and explains that applications remain
  drafts until you review and send them.
- Skip marks the vacancy `skipped` and immediately requests the next card.
- Apply marks the row `applied_pending` after a Gmail draft is created, attaches
  the generated PDF, and sends a draft link. The user must review and send it.
- If the vacancy page cannot be read or parsed, the bot still provides a manual
  review card. Apply then asks for `/text <id> <vacancy text>` or offers to use
  the unmodified CV without tailoring.
- `/add` accepts HTTPS URLs and deduplicates by the first 12 hexadecimal
  characters of SHA-256 over the URL. Use `/add` rather than manually entering
  rows without a valid ID.
- The router silently ignores chats other than `ALLOWED_CHAT_ID`. Stop ends the
  current sequence; `/next` resumes it.

## Operations and tests

```sh
docker compose ps
docker compose logs --tail=100 n8n
docker compose --profile telegram-poller logs --tail=100 telegram-poller
./scripts/export.sh
docker compose exec -T n8n node --test /tests/*.test.cjs
docker compose --profile telegram-poller run --rm --build --no-deps telegram-poller node --test /app/index.test.cjs
```

`scripts/export.sh` writes separate workflow JSON files to `workflows/`.
`scripts/import.sh` imports all JSON files in that directory. Review exported
workflow changes before committing them. The generated `N8N_ENCRYPTION_KEY`
must be preserved with the n8n data volume; losing either can make stored
credentials unreadable.

## Always-on VPS

The polling service keeps Telegram connected without a domain or inbound
firewall ports. The VPS must still stay powered on and reachable. No VPS is
created by this repository; provision one yourself, install Docker Compose, and
copy the project, `.env`, and your private CV file to it. Do not expose port
5678 publicly. Use an SSH port forward to open the n8n editor from your
computer:

```sh
ssh -L 5678:127.0.0.1:5678 <user>@<vps-address>
```

Then open `http://localhost:5678`, configure the n8n credentials, import the
workflows, and activate only `bot-router`. Keep the same `N8N_ENCRYPTION_KEY`
with its n8n data volume when moving an existing installation. VPS hosting and
Anthropic API usage may incur charges.

## Troubleshooting

- **No Telegram response:** check `TELEGRAM_BOT_TOKEN`, the poller logs, the
  `TELEGRAM_FORWARD_SECRET` value, and that `bot-router` is active. The
  outgoing Telegram credential must also be assigned in n8n.
- **No vacancy card:** check that the `queue` headers are exact and that at
  least one row has `status=new`, an HTTPS `url`, and a 12-character lowercase
  hex `id`. A missing or malformed queue row is reported rather than silently
  selected.
- **The card says the page could not be read:** the site may block automated
  requests or require JavaScript/login. Review the link manually, paste its
  text with `/text`, or use the unmodified-CV option.
- **LLM request fails:** check the `llm-call` Header Auth credential, its
  `x-api-key` header, and that `LLM_MODEL` names a model available to the
  configured Anthropic account.
- **PDF or draft fails:** check that Gotenberg is running, the base CV is
  readable, and the Gmail credential has draft-creation access. Apply errors
  are reported to Telegram; no email is sent automatically.
- **Credentials disappear after a restore:** restore both the n8n data volume
  and the matching `N8N_ENCRYPTION_KEY`.

## Known gaps

- Real Telegram, Anthropic, Sheets, Drive, and Gmail OAuth credentials and a
  user CV are intentionally not included. The full Gmail-draft end-to-end flow
  has not been exercised with real OAuth credentials.
- Gotenberg HTML-to-PDF conversion and the workflow's draft-only shape are
  covered by local tests. Gmail's live attachment handling and returned draft
  URL have not been verified against a configured account.
- Direct crawling and automatic Gmail-alert ingestion are not part of the
  current manual `/add` and `/next` setup. The optional alert workflow remains
  inactive. The official source review in [docs/sources.md](./docs/sources.md)
  explains why the bot does not poll undocumented job-board APIs.
- Real Telegram, Anthropic, Sheets, Drive, and Gmail credentials still need to
  be configured in `.env` or the n8n UI. Real Telegram and Anthropic API
  requests have not been tested end-to-end.
- Google OAuth credential fields and Gmail node response details can vary by
  n8n version; configure and verify the nodes in the n8n UI before relying on
  the live application-draft flow.
