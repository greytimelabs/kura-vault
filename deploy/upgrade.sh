#!/bin/sh
# Kura Vault upgrader: moves an existing deployment (one made by install.sh or by
# hand from the release files) to another release. Read it before running it:
#
#   cd /path/to/kura-vault
#   curl -fsSLO https://github.com/greytimelabs/kura-vault/releases/latest/download/upgrade.sh
#   less upgrade.sh
#   sh upgrade.sh 1.2.0
#
# It downloads that release's deployment files into a temporary directory and
# checks them against its SHA256SUMS; on any mismatch it stops with nothing
# changed. Then it backs up the database, .env and the current files into
# backups/, puts the new files in place, sets KURA_VERSION in .env, pulls the
# images and restarts. It keeps .env and docker-compose.override.yml as they are,
# and asks before replacing a garage.toml that differs from the release's.
#
# Options (environment): KURA_DIR=path for the deployment directory (default:
# the current one). Run it as a user that can use docker (root, or the docker
# group). Read the release notes first: they call out anything you need to do.
set -eu

REPO="greytimelabs/kura-vault"
DIR="${KURA_DIR:-.}"
FILES="docker-compose.yml example.env garage.toml"

say() { printf '%s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required but was not found"; }

need curl
need docker
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required (docker compose ...)"

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  fail "sha256sum or shasum is required"
fi

version="${1:-}"
version="${version#v}"
[ -n "$version" ] || fail "usage: sh upgrade.sh X.Y.Z (the release to move to)"
printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$' \
  || fail "$version is not a semantic version (X.Y.Z or X.Y.Z-rc.N)"

cd "$DIR" || fail "$DIR does not exist"
{ [ -f docker-compose.yml ] && [ -f .env ]; } \
  || fail "$(pwd) holds no deployment (docker-compose.yml and .env). Run it there, or set KURA_DIR"
docker compose ps >/dev/null 2>&1 || fail "cannot reach Docker; run it as root or as a member of the docker group"

current=$(sed -n 's/^KURA_VERSION=//p' .env | tail -n 1)
say "Upgrading $(pwd) from ${current:-an unknown version} to $version"

# The override file wins over .env: an image named there would keep the old one
if [ -f docker-compose.override.yml ] && grep -Eq '^[[:space:]]*image:.*kura-vault' docker-compose.override.yml; then
  fail "docker-compose.override.yml names a kura-vault image; remove that line or update it first"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

base="https://github.com/$REPO/releases/download/v$version"
say "Downloading the deployment files from $base"
for file in $FILES SHA256SUMS; do
  curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/$file" "$base/$file" \
    || fail "could not download $file (is v$version released?)"
done

for file in $FILES; do
  expected=$(grep " $file\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)
  [ -n "$expected" ] || fail "$file is not listed in SHA256SUMS"
  [ "$(sha256 "$tmp/$file")" = "$expected" ] || fail "$file does not match its checksum; nothing was changed"
done
say "Checksums verified."

# garage.toml may carry local edits: show them and ask before replacing it
if [ -f garage.toml ] && ! cmp -s garage.toml "$tmp/garage.toml"; then
  say "garage.toml differs from the one in v$version:"
  diff -u garage.toml "$tmp/garage.toml" || true
  printf 'Replace garage.toml with the release version? [y/N] '
  read -r answer || answer=
  case "$answer" in
    y | Y | yes) ;;
    *) say "Keeping the current garage.toml."; cp garage.toml "$tmp/garage.toml" ;;
  esac
fi

# Backups hold .env and the database: only this user may read them
umask 077
backup="backups/$(date +%Y%m%d-%H%M%S)-from-${current:-unknown}"
mkdir -p "$backup"
say "Backing up the database and files to $(pwd)/$backup"
# Single quotes on purpose: the variables expand inside the postgres container
# shellcheck disable=SC2016
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$backup/db.dump" \
  || fail "the database backup failed (is postgres running?); nothing was changed"
[ -s "$backup/db.dump" ] || fail "the database backup is empty; nothing was changed"
for file in .env docker-compose.override.yml SHA256SUMS $FILES; do
  if [ -f "$file" ]; then cp -p "$file" "$backup/"; fi
done

for file in $FILES SHA256SUMS; do
  cp "$tmp/$file" "$file"
done
# Rewrite .env in place, so it keeps its owner and permissions
if grep -q '^KURA_VERSION=' .env; then
  sed "s/^KURA_VERSION=.*/KURA_VERSION=$version/" .env > "$tmp/env"
else
  { cat .env; printf 'KURA_VERSION=%s\n' "$version"; } > "$tmp/env"
fi
cat "$tmp/env" > .env

restore="restore the files from $(pwd)/$backup"
docker compose config -q || fail "the new compose configuration is invalid; $restore"

say "Pulling the images"
docker compose pull || fail "could not pull the v$version images; $restore"
say "Restarting (database migrations run as the server starts)"
if ! docker compose up -d --wait --wait-timeout 300; then
  docker compose logs --no-color --tail=80 server || true
  fail "the services did not become healthy (logs above). Going back after a migration needs the database dump: see docs/self-hosting.md, Upgrades. Backup: $(pwd)/$backup"
fi

bind=$(sed -n 's/^HTTP_BIND=//p' .env | tail -n 1)
port=$(sed -n 's/^HTTP_PORT=//p' .env | tail -n 1)
case "${bind:-}" in "" | 0.0.0.0) bind=127.0.0.1 ;; esac
if curl -fsS -o /dev/null "http://$bind:${port:-8080}/api/v1/health"; then
  say "Health check passed."
else
  fail "the health check on http://$bind:${port:-8080}/api/v1/health failed; see docker compose logs server. Backup: $(pwd)/$backup"
fi

say ""
say "Upgraded to $version. The backup is in $(pwd)/$backup; remove old ones when you no longer need them."
