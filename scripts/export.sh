#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"
mkdir -p workflows

docker compose exec -T n8n n8n export:workflow --all --separate --output=/workflows
