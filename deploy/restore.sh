#!/usr/bin/env bash
#
# Restore from an off-host encrypted backup.
#
# This exists because a procedure that has only been described has not been
# tested. `backup.sh --verify` rehearses the local snapshot every night; this
# rehearses the off-host one, which is the copy you reach for on the day the
# disk is gone and nothing else is available.
#
#   BACKUP_PASSPHRASE=... deploy/restore.sh <bundle.tar.gz.enc> <target-dir>
#
set -euo pipefail

BUNDLE=${1:?usage: restore.sh <bundle.tar.gz.enc> <target-dir>}
TARGET=${2:?usage: restore.sh <bundle.tar.gz.enc> <target-dir>}
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"

mkdir -p "$TARGET"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -pass env:BACKUP_PASSPHRASE -in "$BUNDLE" -out "$WORK/bundle.tar.gz"

# CHECK BEFORE TRUSTING. AES-CBC is unauthenticated, so a wrong passphrase or a
# corrupted file decrypts to garbage and exits 0. Comparing against the
# plaintext checksum taken at backup time is what turns "it produced output"
# into "it produced the right output".
if [ -f "$BUNDLE.sha256" ]; then
  EXPECTED=$(cat "$BUNDLE.sha256")
  ACTUAL=$(shasum -a 256 "$WORK/bundle.tar.gz" | awk '{print $1}')
  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "FAILED: decrypted bundle does not match its checksum." >&2
    echo "  expected $EXPECTED" >&2
    echo "  actual   $ACTUAL" >&2
    echo "Either the passphrase is wrong or the backup is corrupt. Not restoring." >&2
    exit 1
  fi
  echo "checksum matches the plaintext recorded at backup time"
else
  echo "WARNING: no .sha256 beside the bundle — cannot tell a good decrypt from a bad one" >&2
fi

tar -xzf "$WORK/bundle.tar.gz" -C "$WORK"
gunzip -c "$WORK"/db/saha-*.db.gz > "$TARGET/saha.db"
SNAPSHOT=$(find "$WORK" -maxdepth 1 -type d -name '20*' | head -1)
[ -n "$SNAPSHOT" ] && { mkdir -p "$TARGET/blobs"; cp -R "$SNAPSHOT"/. "$TARGET/blobs/"; }

# Read it. "The file exists" is not "the data is there".
COUNTS=$(sqlite3 "$TARGET/saha.db" \
  "SELECT (SELECT COUNT(*) FROM projects) || ' projects, ' ||
          (SELECT COUNT(*) FROM tasks)    || ' tasks, ' ||
          (SELECT COUNT(*) FROM comments) || ' comments, ' ||
          (SELECT COUNT(*) FROM blobs)    || ' blobs';")
echo "restored to $TARGET: $COUNTS"

MISSING=0
while read -r sha mime; do
  [ -z "$sha" ] && continue
  case "$mime" in
    image/png) ext=png ;; image/jpeg) ext=jpg ;; image/gif) ext=gif ;;
    image/webp) ext=webp ;; application/pdf) ext=pdf ;; *) ext=bin ;;
  esac
  [ -f "$TARGET/blobs/${sha:0:2}/${sha:2:2}/$sha.$ext" ] || MISSING=$((MISSING + 1))
done < <(sqlite3 -separator ' ' "$TARGET/saha.db" "SELECT sha256, mime FROM blobs;")

if [ "$MISSING" -gt 0 ]; then
  echo "FAILED: $MISSING blob(s) referenced by the restored database have no bytes" >&2
  exit 1
fi
echo "every blob referenced by the restored database is present"
