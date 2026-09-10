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
# RECOVERY OBJECTIVES, stated rather than implied:
#
#   RPO — how much work a restore can lose.  UP TO 24 HOURS on the nightly
#         timer alone. That is a real number and somebody should be unhappy
#         with it: an image uploaded at 03:31 is gone if the disk dies at
#         03:29 the next morning. Run this by hand before anything risky.
#
#   RTO — how long a restore takes.  MINUTES, and only because the data is
#         small: gunzip a file, rsync a tree, start the service. This is not a
#         claim about a rehearsed procedure — it is a claim about the size of
#         the data. The rehearsal is `--verify`, which restores every night.
#
# OFF-HOST is not optional. A backup on the same disk as the thing it backs up
# is not a backup; it is a second copy that dies at the same moment. Set
# BACKUP_REMOTE to somewhere else and this ships an encrypted copy there.
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

# Off-host, encrypted.
#
# Encrypted BEFORE it leaves, so the destination never holds readable copies of
# people's boards and images. A passphrase in the environment is a modest
# secret, and it is the difference between "somebody else has our data" and
# "somebody else has our ciphertext".
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
    echo "BACKUP_REMOTE is set but BACKUP_PASSPHRASE is not — refusing to ship plaintext off-host" >&2
    exit 1
  fi
  BUNDLE="$DEST/offsite-$STAMP.tar.gz.enc"
  PLAIN="$DEST/offsite-$STAMP.tar.gz"
  tar -czf "$PLAIN" -C "$DEST" "db/saha-$STAMP.db.gz" -C "$DEST/blobs" "$STAMP"

  # The checksum is of the PLAINTEXT, and it is what makes this detectable
  # rather than merely private.
  #
  # openssl enc uses AES-CBC, which is unauthenticated: decrypting with the
  # wrong key, or decrypting a corrupted file, produces GARBAGE rather than an
  # error. I checked — a wrong passphrase returned noise and exit 0. Without
  # this line you would discover a bad backup by restoring it and finding a
  # database full of rubbish, at the exact moment you least want a surprise.
  shasum -a 256 "$PLAIN" | awk '{print $1}' > "$BUNDLE.sha256"

  openssl enc -aes-256-cbc -pbkdf2 -iter 250000 -salt -pass env:BACKUP_PASSPHRASE -in "$PLAIN" -out "$BUNDLE"
  rm -f "$PLAIN"
  rsync -a --remove-source-files "$BUNDLE" "$BUNDLE.sha256" "$BACKUP_REMOTE/" \
    && echo "shipped encrypted copy to $BACKUP_REMOTE (with plaintext checksum for restore)"
else
  # Said out loud every run. A backup that lives on the same disk as the data
  # is one disk failure from being no backup at all, and a warning nobody sees
  # is the same as no warning.
  echo "WARNING: BACKUP_REMOTE not set — every copy is on the same disk as the data." >&2
fi

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
