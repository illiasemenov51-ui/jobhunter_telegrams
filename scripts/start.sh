#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
fi

if ! grep -Eq '^N8N_ENCRYPTION_KEY=.{32,}$' .env; then
  key=$(openssl rand -hex 32)
  awk -v value="$key" '
    /^N8N_ENCRYPTION_KEY=/ { print "N8N_ENCRYPTION_KEY=" value; found=1; next }
    { print }
    END { if (!found) print "N8N_ENCRYPTION_KEY=" value }
  ' .env > .env.tmp
  mv .env.tmp .env
fi

docker compose up -d

url=
attempt=0
while [ "$attempt" -lt 60 ]; do
  url=$(docker compose logs --no-color --tail=100 cloudflared 2>&1 |
    grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' |
    tail -n 1 || true)
  if [ -n "$url" ]; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done

if [ -z "$url" ]; then
  echo "Cloudflare Quick Tunnel URL was not found. Check: docker compose logs cloudflared" >&2
  exit 1
fi

awk -v value="$url/" '
  /^WEBHOOK_URL=/ { print "WEBHOOK_URL=" value; found=1; next }
  { print }
  END { if (!found) print "WEBHOOK_URL=" value }
' .env > .env.tmp
mv .env.tmp .env

docker compose up -d --force-recreate n8n

attempt=0
while [ "$attempt" -lt 60 ]; do
  if curl --silent --fail http://127.0.0.1:5678/ >/dev/null; then
    printf 'n8n is ready at http://localhost:5678\nQuick Tunnel: %s\n' "$url"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 1
done

echo "n8n did not become ready. Check: docker compose logs n8n" >&2
exit 1
