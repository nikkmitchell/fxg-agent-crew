#!/usr/bin/env bash
#
# Restore from an off-host encrypted backup.
#
# This exists because a procedure that has only been described has not been
# tested. `backup.sh --verify` rehearses the local snapshot every night; this
# rehearses the off-host one, which is the copy you reach for on the day the
# disk is gone and nothing else is available.
#
#   BACKUP_IDENTITY=/path/to/age-key.txt deploy/restore.sh <bundle.tar.gz.age> <target-dir>
#
# The identity is the private key the bundle was encrypted TO. It does not live
# on saha.ing — that is the point. If you cannot find it, you cannot read these
# backups, and no amount of access to the server will help.
set -euo pipefail

BUNDLE=${1:?usage: restore.sh <bundle.tar.gz.age> <target-dir>}
TARGET=${2:?usage: restore.sh <bundle.tar.gz.age> <target-dir>}
: "${BACKUP_IDENTITY:?BACKUP_IDENTITY (path to the age private key) is required}"
[ -f "$BACKUP_IDENTITY" ] || { echo "no identity file at $BACKUP_IDENTITY" >&2; exit 1; }

mkdir -p "$TARGET"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

# age is AUTHENTICATED. A modified or truncated bundle fails here rather than
# producing plausible garbage, and there is no separate integrity file that an
# attacker could replace alongside the ciphertext.
#
# The previous version used openssl AES-CBC with a checksum shipped beside the
# bundle. Inkstone pointed out that this is not authenticated encryption:
# whoever can replace the bundle can replace the checksum too. It caught
# accidental corruption and nothing more, while being described as if it caught
# tampering.
if ! age -d -i "$BACKUP_IDENTITY" -o "$WORK/bundle.tar.gz" "$BUNDLE" 2>"$WORK/age.err"; then
  echo "FAILED: could not decrypt and authenticate the bundle." >&2
  sed "s/^/  /" "$WORK/age.err" >&2
  echo "Either this is the wrong identity or the backup has been altered. Not restoring." >&2
  exit 1
fi
echo "decrypted and authenticated"

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
