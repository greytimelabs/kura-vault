#!/bin/sh
# Renders the per-deployment nginx snippets included by default.conf. Every value
# ends up inside nginx configuration or a response header, so each is checked
# against a strict pattern first: a bad value stops the container with a message
# instead of producing a config nobody meant.
set -eu

out=/etc/nginx/conf.d

fail() {
  echo "kura-vault: $*" >&2
  exit 1
}

# --- Content-Security-Policy ------------------------------------------------
# S3_ORIGIN: where browsers fetch blobs from, when that is not this origin.
# Empty for the bundled Garage; e.g. https://<account-id>.r2.cloudflarestorage.com
# for an external bucket, or `https:` for a client that talks to any server.
s3_origin="${S3_ORIGIN:-}"
for source in $s3_origin; do
  echo "$source" | grep -Eq '^https?:(//[A-Za-z0-9*][A-Za-z0-9.*-]*(:[0-9]{1,5})?)?$' \
    || fail "S3_ORIGIN has an invalid entry: $source (expected an origin such as https://bucket.example.com)"
done

csp="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src blob:; connect-src 'self'${s3_origin:+ $s3_origin}; worker-src 'self' blob:; font-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"

cat > "$out/kura-headers.inc" <<EOF
add_header Content-Security-Policy "$csp" always;
add_header Referrer-Policy "no-referrer" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Strict-Transport-Security "max-age=31536000" always;
EOF

# --- Trusted proxies ----------------------------------------------------------
# Addresses allowed to tell us the client's address in X-Forwarded-For. Defaults to
# private and loopback ranges, where a reverse proxy on the same host or LAN sits.
trusted="${TRUSTED_PROXIES:-127.0.0.1/32 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 ::1/128 fc00::/7}"
: > "$out/kura-realip.inc"
for cidr in $(echo "$trusted" | tr ',' ' '); do
  echo "$cidr" | grep -Eq '^[0-9A-Fa-f:.]+(/[0-9]{1,3})?$' \
    || fail "TRUSTED_PROXIES has an invalid entry: $cidr (expected an address or CIDR range)"
  echo "set_real_ip_from $cidr;" >> "$out/kura-realip.inc"
done

# --- Bucket on this origin --------------------------------------------------
# S3_PROXY_UPSTREAM (e.g. http://garage:3900) serves the bucket at /<S3_BUCKET_NAME>/.
# Path-style pre-signed URLs sign the host and the path, so neither is rewritten.
upstream="${S3_PROXY_UPSTREAM:-}"
: > "$out/kura-storage.inc"
if [ -n "$upstream" ]; then
  echo "$upstream" | grep -Eq '^https?://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?$' \
    || fail "S3_PROXY_UPSTREAM must be scheme, host and optional port, such as http://garage:3900"
  bucket="${S3_BUCKET_NAME:-}"
  echo "$bucket" | grep -Eq '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' \
    || fail "S3_BUCKET_NAME must be a valid bucket name (lowercase letters, digits, dots and hyphens)"
  case "$bucket" in
    api | assets | healthz) fail "S3_BUCKET_NAME cannot be '$bucket': that path is used by the web client" ;;
  esac

  cat > "$out/kura-storage.inc" <<EOF
location ^~ /$bucket/ {
  set \$kura_storage $upstream;
  proxy_pass \$kura_storage;
  # Exactly the host the URL was signed for, port included
  proxy_set_header Host \$http_host;
  proxy_http_version 1.1;
  # Originals can be large: stream both ways instead of buffering in memory
  client_max_body_size 0;
  proxy_request_buffering off;
  proxy_buffering off;
  proxy_read_timeout 300s;
  proxy_send_timeout 300s;
}
EOF
fi
