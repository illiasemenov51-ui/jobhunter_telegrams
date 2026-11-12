#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

if ! find workflows -maxdepth 1 -type f -name '*.json' -print -quit | grep -q .; then
  echo "No workflow JSON files found in ./workflows" >&2
  exit 1
fi

docker compose exec -T n8n n8n import:workflow --separate --input=/workflows
