#!/bin/sh
# Cuts a release: sets the version everywhere, dates the changelog, commits and
# tags vX.Y.Z on main. Pushing the tag runs .github/workflows/release.yml, which
# publishes the images as X.Y.Z, X.Y, X and latest.
#
# Usage: scripts/release.sh X.Y.Z [--dry-run]
#
# It never pushes. Afterwards: git push origin main vX.Y.Z

set -eu

REPO_URL=https://github.com/greytimelabs/kura-vault
PACKAGES="backend/package.json web/package.json migration-cli/package.json"
PUBSPEC=app/pubspec.yaml
CHANGELOG=CHANGELOG.md

fail() { echo "release: $*" >&2; exit 1; }

version=""
dry_run=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    -*) fail "unknown option $arg" ;;
    *) [ -z "$version" ] || fail "one version only"; version="$arg" ;;
  esac
done
[ -n "$version" ] || fail "usage: scripts/release.sh X.Y.Z [--dry-run]"
version="${version#v}"
echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$' \
  || fail "$version is not a semantic version (X.Y.Z or X.Y.Z-rc.N)"
tag="v$version"

cd "$(git rev-parse --show-toplevel)"

[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || $dry_run || fail "releases are cut from main"
[ -z "$(git status --porcelain)" ] || $dry_run || fail "the working tree has changes; commit or stash them"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && fail "$tag already exists"

previous=$(git tag --list 'v*.*.*' --sort=-v:refname | head -n 1)
if [ -n "$previous" ]; then
  highest=$(printf '%s\n%s\n' "${previous#v}" "$version" | sort -V | tail -n 1)
  [ "$highest" = "$version" ] || fail "$version is not above the latest release, $previous"
fi
# Before the first tag, the code's own version is the floor
code_version=$(sed -nE '1,/"version"/s/.*"version": *"([^"]*)".*/\1/p' backend/package.json)
lowest=$(printf '%s\n%s\n' "$code_version" "$version" | sort -V | head -n 1)
[ "$lowest" = "$code_version" ] || fail "$version is below the current version, $code_version"

grep -q '^## \[Unreleased\]' "$CHANGELOG" || fail "$CHANGELOG has no [Unreleased] section"

# Rewrites a file through a filter; in a dry run, shows the diff instead
rewrite() {
  file="$1"; shift
  tmp=$(mktemp)
  "$@" < "$file" > "$tmp"
  if $dry_run; then
    diff -u "$file" "$tmp" | sed "1,2s|$tmp|$file (new)|" || true
    rm -f "$tmp"
  else
    cat "$tmp" > "$file"; rm -f "$tmp"
  fi
}

for pkg in $PACKAGES; do
  rewrite "$pkg" sed -E "1,/\"version\"/s/(\"version\": *\")[^\"]*\"/\1$version\"/"
done

# The stores need the build number to rise with each new version
current=$(sed -nE 's/^version: *([^+ ]*).*/\1/p' "$PUBSPEC")
build=$(sed -nE 's/^version: *[^+]*\+([0-9]+).*/\1/p' "$PUBSPEC")
build=${build:-0}
[ "$current" = "$version" ] || build=$(( build + 1 ))
rewrite "$PUBSPEC" sed -E "s/^version: .*/version: $version+$build/"

today=$(date +%Y-%m-%d)
# Dates the Unreleased section, opens a fresh one, and keeps the link
# references together at the end, newest first
changelog_filter() {
  awk -v version="$version" -v today="$today" -v previous="$previous" -v repo="$REPO_URL" '
    /^## \[Unreleased\]/ && !done {
      body[++n] = "## [Unreleased]"; body[++n] = ""; body[++n] = "## [" version "] - " today
      done = 1; next
    }
    /^\[Unreleased\]: / { next }
    /^\[[^]]+\]: / { links = links $0 "\n"; next }
    { body[++n] = $0 }
    END {
      while (n > 0 && body[n] == "") n--
      for (i = 1; i <= n; i++) print body[i]
      print ""
      print "[Unreleased]: " repo "/compare/v" version "...HEAD"
      if (previous != "") print "[" version "]: " repo "/compare/" previous "...v" version
      else print "[" version "]: " repo "/releases/tag/v" version
      printf "%s", links
    }'
}
rewrite "$CHANGELOG" changelog_filter

if $dry_run; then
  echo
  echo "Dry run: nothing written. Would commit \"Release $tag\" and tag $tag."
  exit 0
fi

# shellcheck disable=SC2086
git add $PACKAGES "$PUBSPEC" "$CHANGELOG"
git commit -q -m "Release $tag"
git tag -a "$tag" -m "Release $tag"

echo "Committed and tagged $tag. Publish it with:"
echo "  git push origin main $tag"
