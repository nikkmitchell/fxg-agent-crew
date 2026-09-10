#!/usr/bin/env bash
#
# Back up saha.ing's database and blobs.
#
# This ships WITH the storage change, not after it. Until now saha.ing was
# disposable: everything on it could be rebuilt by replaying chat, so losing the
# box cost uptime and nothing else. Uploaded bytes exist nowhere else, so from
# the moment the first image lands, a lost disk is lost work. That makes backups
# a correctness requirement rather than hygiene.
#
#   deploy/backup.sh              run one backup
#   deploy/backup.sh --verify     also restore it to a temp file and read it
#
set -euo pipefail

DB=${DATABASE_PATH:-/var/lib/fxg-crew/saha.db}
BLOBS=${BLOB_ROOT:-/var/lib/fxg-crew/blobs}
DEST=${BACKUP_ROOT:-/var/backups/fxg-crew}
KEEP=${BACKUP_KEEP:-14}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

mkdir -p "$DEST/db" "$DEST/blobs"

# sqlite3 .backup, NOT cp.
#
# Copying a live SQLite file gives you whatever was on disk mid-write, and with
# WAL enabled the copy can be missing committed transactions that live in the
# -wal file. `.backup` takes a consistent snapshot through the database engine
# while the service keeps running.
sqlite3 "$DB" ".backup '$DEST/db/saha-$STAMP.db'"
gzip -f "$DEST/db/saha-$STAMP.db"

# Blobs are content-addressed, so a file never changes once written and this is
# always an append. --link-dest makes each run a hard-linked snapshot: cheap on
# disk, and each one is a complete tree rather than a chain of increments that
# all have to survive.
LATEST="$DEST/blobs/latest"
rsync -a --delete \
  ${LATEST:+--link-dest="$LATEST"} \
  "$BLOBS/" "$DEST/blobs/$STAMP/"
ln -sfn "$DEST/blobs/$STAMP" "$LATEST"

# Prune by count, oldest first.
ls -1dt "$DEST"/db/saha-*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1dt "$DEST"/blobs/*/ 2>/dev/null | grep -v "/latest/$" | tail -n +$((KEEP + 1)) | xargs -r rm -rf

SIZE=$(du -sh "$DEST" | cut -f1)
echo "backed up to $DEST ($SIZE total, keeping $KEEP)"

if [ "${1:-}" = "--verify" ]; then
  # A BACKUP NOBODY HAS RESTORED IS NOT A BACKUP. This restores the snapshot
  # just taken and reads from it, so "the file exists and is non-zero" is not
  # mistaken for "the data is there".
  TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
  gunzip -c "$DEST/db/saha-$STAMP.db.gz" > "$TMP/restored.db"
  COUNTS=$(sqlite3 "$TMP/restored.db" \
    "SELECT (SELECT COUNT(*) FROM projects) || ' projects, ' ||
            (SELECT COUNT(*) FROM tasks)    || ' tasks, ' ||
            (SELECT COUNT(*) FROM comments) || ' comments, ' ||
            (SELECT COUNT(*) FROM blobs)    || ' blobs';")
  echo "restored and read back: $COUNTS"

  # Every blob row must have its bytes in the snapshot. A database that
  # references files the backup does not contain restores into a board full of
  # broken images, which is the failure this check exists to catch.
  MISSING=0
  while read -r sha mime; do
    [ -z "$sha" ] && continue
    case "$mime" in
      image/png) ext=png ;; image/jpeg) ext=jpg ;; image/gif) ext=gif ;;
      image/webp) ext=webp ;; application/pdf) ext=pdf ;; *) ext=bin ;;
    esac
    [ -f "$DEST/blobs/$STAMP/${sha:0:2}/${sha:2:2}/$sha.$ext" ] || MISSING=$((MISSING + 1))
  done < <(sqlite3 -separator ' ' "$TMP/restored.db" "SELECT sha256, mime FROM blobs;")

  if [ "$MISSING" -gt 0 ]; then
    echo "FAILED: $MISSING blob(s) referenced by the database are missing from the backup" >&2
    exit 1
  fi
  echo "every blob referenced by the database is present in the backup"
fi
