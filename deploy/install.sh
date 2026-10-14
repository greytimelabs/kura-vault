#!/bin/sh
# Kura Vault installer: downloads one release's deployment files into a new
# directory, checks them against the release's SHA256SUMS, and writes a .env with
# freshly generated secrets. It changes nothing outside that directory, needs no
# root, and starts nothing without asking. Read it before running it:
#
#   curl -fsSLO https://github.com/greytimelabs/kura-vault/releases/latest/download/install.sh
#   less install.sh
#   sh install.sh
#
# Options (environment): KURA_VERSION=1.2.0 for a given release (default: latest),
# KURA_DIR=path for the directory to create (default: ./kura-vault),
# PUBLIC_URL=https://... to skip the question.
set -eu

REPO="greytimelabs/kura-vault"
DIR="${KURA_DIR:-kura-vault}"
FILES="docker-compose.yml example.env garage.toml"

say() { printf '%s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required but was not found"; }

need curl
need openssl
need docker
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required (docker compose ...)"

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  fail "sha256sum or shasum is required"
fi

[ -e "$DIR" ] && fail "$DIR already exists. Remove it, or set KURA_DIR to another directory"

if [ -n "${KURA_VERSION:-}" ]; then
  base="https://github.com/$REPO/releases/download/v$KURA_VERSION"
else
  base="https://github.com/$REPO/releases/latest/download"
fi

mkdir -p "$DIR"
# Secrets are written here: only this user may read anything created from now on
umask 077
cd "$DIR"

say "Downloading the deployment files from $base"
for file in $FILES SHA256SUMS; do
  curl -fsSL --proto '=https' --tlsv1.2 -o "$file" "$base/$file" || fail "could not download $file"
done

for file in $FILES; do
  expected=$(grep " $file\$" SHA256SUMS | cut -d' ' -f1)
  [ -n "$expected" ] || fail "$file is not listed in SHA256SUMS"
  [ "$(sha256 "$file")" = "$expected" ] || fail "$file does not match its checksum; not using it"
done
say "Checksums verified."

url="${PUBLIC_URL:-}"
while :; do
  if [ -z "$url" ]; then
    printf 'Address users will open (https://...): '
    read -r url || fail "no address given"
  fi
  url="${url%/}"
  case "$url" in
    https://*/*) say "Enter the origin only, without a path (e.g. https://vault.example.com)" ;;
    https://?*)
      # Host and optional port only: the value is written into .env as is
      printf '%s\n' "$url" | grep -Eq '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$' && break
      say "That is not a valid address (e.g. https://vault.example.com or https://vault.example.com:8443)"
      ;;
    *) say "The address must start with https:// (browsers only allow the web client's encryption on https)" ;;
  esac
  url=""
done

hex() { openssl rand -hex "$1"; }
setup_key=$(openssl rand -base64 33 | tr -d '\n' | tr '+/' '-_')

# Every value is generated here: hex and base64url only, so none needs quoting
sed \
  -e "s|^PUBLIC_URL=.*|PUBLIC_URL=$url|" \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(hex 24)|" \
  -e "s|^JWT_SECRET=.*|JWT_SECRET=$(hex 32)|" \
  -e "s|^SETUP_KEY=.*|SETUP_KEY=$setup_key|" \
  -e "s|^AWS_ACCESS_KEY_ID=CHANGE_ME|AWS_ACCESS_KEY_ID=GK$(hex 12)|" \
  -e "s|^AWS_SECRET_ACCESS_KEY=CHANGE_ME|AWS_SECRET_ACCESS_KEY=$(hex 32)|" \
  -e "s|^GARAGE_RPC_SECRET=.*|GARAGE_RPC_SECRET=$(hex 32)|" \
  example.env > .env

grep -q '^KURA_VERSION=CHANGE_ME' .env && fail "example.env names no release; set KURA_VERSION"

say ""
say "Ready in $(pwd)"
say "  .env holds your secrets (readable only by you). Back it up somewhere safe."
say "  Setup key, for creating the owner account in the web client:"
say "    $setup_key"
say ""
printf 'Start Kura Vault now? [y/N] '
read -r answer || answer=
case "$answer" in
  y | Y | yes) docker compose up -d --wait ;;
  *) say "Start it later with: cd $DIR && docker compose up -d" ;;
esac

port=$(grep '^HTTP_PORT=' .env | cut -d= -f2)
say ""
say "Next: point your HTTPS reverse proxy for $url at 127.0.0.1:${port:-8080},"
say "then open $url and create the owner account with the setup key above."
say "Guide: https://github.com/$REPO/blob/main/docs/self-hosting.md"
