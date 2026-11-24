#!/bin/sh
set -eu
umask 077

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
fi

write_secret() {
  name=$1
  key=$(openssl rand -hex 32)
  awk -v name="$name" -v value="$key" '
    index($0, name "=") == 1 { print name "=" value; found=1; next }
    { print }
    END { if (!found) print name "=" value }
  ' .env > .env.tmp
  mv .env.tmp .env
}

if ! grep -Eq '^N8N_ENCRYPTION_KEY=.{32,}$' .env; then
  write_secret N8N_ENCRYPTION_KEY
fi

if ! grep -Eq '^TELEGRAM_FORWARD_SECRET=.{32,}$' .env; then
  write_secret TELEGRAM_FORWARD_SECRET
fi
chmod 600 .env

docker compose --profile quick-tunnel stop cloudflared
docker compose up -d --build n8n gotenberg

attempt=0
while [ "$attempt" -lt 60 ]; do
  if curl --silent --fail http://127.0.0.1:5678/ >/dev/null; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done

if [ "$attempt" -eq 60 ]; then
  echo "n8n did not become ready. Check: docker compose logs n8n" >&2
  exit 1
fi

if grep -Eq '^TELEGRAM_BOT_TOKEN=.{1,}$' .env; then
  if docker compose exec -T n8n n8n list:workflow --active=true | grep -q '|bot-router$'; then
    docker compose --profile telegram-poller up -d --build telegram-poller
    printf 'n8n is ready at http://localhost:5678\nTelegram polling is running.\n'
  else
    printf 'n8n is ready at http://localhost:5678\nImport and activate bot-router in n8n, then rerun this script to start Telegram polling.\n'
  fi
else
  printf 'n8n is ready at http://localhost:5678\nSet TELEGRAM_BOT_TOKEN in .env, then rerun this script to start Telegram polling.\n'
fi
