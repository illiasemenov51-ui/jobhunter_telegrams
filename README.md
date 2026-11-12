# Job Swipe Agent

A self-hosted n8n bot for reviewing one vacancy at a time in Telegram. Accepting
a vacancy creates a tailored CV PDF and a Gmail **draft**. The workflow never
sends email or submits an application.

## Setup

1. Install Docker Desktop with Compose, then clone this repository:

   ```sh
   git clone <repository-url> jobhunter_telegrams
   cd jobhunter_telegrams
   cp .env.example .env
   ```

2. Edit `.env` and set `ALLOWED_CHAT_ID`, `SHEET_ID`, `CV_SOURCE`, and (if
   needed) `GOOGLE_DRIVE_CV_FILE_ID` and `LLM_MODEL`. Leave
   `N8N_ENCRYPTION_KEY` blank; the start script generates it. Do not put
   credentials in workflow JSON or commit `.env`.
3. Start the stack and import the workflows:

   ```sh
   ./scripts/start.sh
   ./scripts/import.sh
   ```

   The script prints the n8n UI address and a temporary HTTPS Cloudflare Quick
   Tunnel URL. Quick Tunnel URLs can change after a restart; rerun
   `./scripts/start.sh` to refresh `WEBHOOK_URL`.
4. Open `http://localhost:5678`, create the n8n owner account, and configure
   credentials in n8n:
   - **Telegram API:** create a bot with BotFather and add its token as an n8n
     Telegram credential. Assign it to the Telegram Trigger and Telegram nodes.
     The `TELEGRAM_BOT_TOKEN` variable is only a placeholder/reference; the
     imported workflows use n8n credentials.
   - **Anthropic Header Auth:** set header name `x-api-key` and the API key as
     its value. Assign it to the HTTP Request node in `llm-call`.
   - **Google Sheets OAuth2:** authorize access and assign it to the Sheets
     nodes. `SHEET_ID` is the spreadsheet ID from its URL.
   - **Google Drive OAuth2:** configure and assign it to the Drive download
     node when `CV_SOURCE=drive`.
   - **Gmail OAuth2:** configure and assign it to the Gmail Draft node.
5. Prepare the Google spreadsheet:
   - A `queue` tab with these headers in row 1:
     `id`, `url`, `status`, `source`, `title`, `company`, `location`,
     `added_at`, `decided_at`, `draft_link`, `notes`.
   - A `config` tab with `key` and `value` headers. Suggested keys are
     `preferred_keywords`, `excluded_keywords`, `languages`, and `seniority`.
     Current workflows do not yet read these values.
6. Configure a real CV:
   - For local mode, copy `data/cv_base.example.md` to `data/cv_base.md` and
     replace the example with your own accurate CV. The file is git-ignored and
     mounted read-only into n8n.
   - For Drive mode, set `CV_SOURCE=drive` and `GOOGLE_DRIVE_CV_FILE_ID` to a
     PDF file ID, then make sure the Drive credential can read it.
7. In n8n, open the workflows and assign credentials to their nodes. Activate
   **only `bot-router`**; its single Telegram Trigger routes messages and
   callbacks to the inactive sub-workflows. Use the same bot configured above.
8. Send `/next` to the bot. Use `/add https://...` to add a vacancy manually.

Never paste API keys, bot tokens, or your real CV into chat. Enter credentials
only in your local n8n UI and keep personal CV data out of git.

## Bot behavior

- `/next` and `/start` show one `new` queue row, fetch its URL, and send a card
  with Apply, Skip, and Stop buttons.
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
docker compose logs --tail=100 cloudflared
./scripts/export.sh
docker compose exec -T n8n node --test /tests/*.test.cjs
```

`scripts/export.sh` writes separate workflow JSON files to `workflows/`.
`scripts/import.sh` imports all JSON files in that directory. Review exported
workflow changes before committing them. The generated `N8N_ENCRYPTION_KEY`
must be preserved with the n8n data volume; losing either can make stored
credentials unreadable.

## Troubleshooting

- **Telegram trigger does not activate:** check the Quick Tunnel URL printed by
  `scripts/start.sh`, confirm n8n is reachable on `http://localhost:5678`, and
  check the Telegram credential and n8n logs. Only one Telegram Trigger for a
  bot is supported; keep it in `bot-router`.
- **Quick Tunnel URL changed:** run `./scripts/start.sh` again, then verify the
  trigger is active in n8n. Quick Tunnels are temporary and intended for
  personal testing, not a stable production endpoint.
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
- The `config` sheet is documented but preferred/excluded keywords,
  languages, and seniority are not yet applied by the workflows.
- No `fill-queue` crawler is included. The official source review in
  [docs/sources.md](./docs/sources.md) found no listing feed/API with both
  verifiable terms and permitted use. Continue with manual `/add` until a
  source's official integration and applicable terms are confirmed.
- Google OAuth credential fields, Gmail node response details, and Telegram
  webhook activation can vary by n8n version; configure and verify the nodes in
  the n8n UI before relying on live operation.
