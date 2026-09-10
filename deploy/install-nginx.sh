#!/usr/bin/env bash
#
# Install deploy/nginx.conf (or nginx.bootstrap.conf) onto this host.
#
# Why this exists rather than a documented `cp`: deploy/nginx.conf is a
# TEMPLATE. It names the certificate as
#
#     /etc/letsencrypt/live/SERVER_NAME_HERE/fullchain.pem
#
# and the README says to sed that placeholder before reloading. On 2026-09-08 I
# copied the template over the live config and skipped the sed. `cp` succeeded,
# `scp` succeeded, and the breakage only appeared one step later at `nginx -t`.
# The running nginx kept serving from its in-memory config, so the site stayed
# up and nothing looked wrong — but the on-disk config was one `systemctl
# restart` or one reboot away from a host that could not start nginx at all.
# That is the worst shape a mistake can have here: invisible until the moment
# you most need the machine to come back up.
#
# So the copy is now the thing that checks. It writes only after substituting,
# only after `nginx -t` passes against the real file, and it keeps a timestamped
# backup of whatever it replaced — because the config it overwrote was the only
# copy of the certbot-substituted version, and I had to reconstruct it from the
# certificate's SAN list.
#
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: install-nginx.sh <server-name> [--bootstrap] [--reload]

  <server-name>  primary hostname, e.g. saha.ing. Extra names (www.) are read
                 from the certificate when one exists, so they are not lost.
  --bootstrap    install nginx.bootstrap.conf (plain :80, for the first ACME
                 challenge, before any certificate exists) instead of nginx.conf
  --reload       reload nginx after a successful `nginx -t`. Without this the
                 file is installed and tested but not activated.
USAGE
  exit 2
}

[ $# -ge 1 ] || usage
SERVER_NAME="$1"; shift
SOURCE="nginx.conf"
RELOAD=0
for arg in "$@"; do
  case "$arg" in
    --bootstrap) SOURCE="nginx.bootstrap.conf" ;;
    --reload)    RELOAD=1 ;;
    *)           usage ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/$SOURCE"
# Overridable ONLY so the rollback path can be exercised by a test against a
# scratch directory and a stub `nginx`. A safety net nobody has ever seen fire
# is a safety net nobody knows works — that is the same "green is a claim about
# what ran" problem this repo keeps running into. Defaults are the real paths,
# and the root check still applies whenever they are in use.
DEFAULT_DEST=/etc/nginx/sites-available/fxg-crew
DEST="${FXG_NGINX_SITE:-$DEFAULT_DEST}"
NGINX="${FXG_NGINX_BIN:-nginx}"
[ -f "$SRC" ] || { echo "no such template: $SRC" >&2; exit 1; }
if [ "$DEST" = "$DEFAULT_DEST" ] && [ "$(id -u)" != 0 ]; then
  echo "must run as root" >&2; exit 1
fi

# Every name on the existing certificate, so installing with just the apex does
# not silently drop www and start serving it a default vhost.
NAMES="$SERVER_NAME"
CERT="${FXG_CERT_DIR:-/etc/letsencrypt/live}/$SERVER_NAME/fullchain.pem"
if [ -f "$CERT" ]; then
  for san in $(openssl x509 -in "$CERT" -noout -ext subjectAltName 2>/dev/null \
                 | tr ',' '\n' | sed -n 's/.*DNS://p' | tr -d ' '); do
    case " $NAMES " in *" $san "*) ;; *) NAMES="$NAMES $san" ;; esac
  done
  echo "certificate covers: $NAMES"
else
  echo "no certificate at $CERT — installing for '$SERVER_NAME' only" >&2
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
sed -e "s#/etc/letsencrypt/live/SERVER_NAME_HERE/#/etc/letsencrypt/live/$SERVER_NAME/#g" \
    -e "s/server_name SERVER_NAME_HERE;/server_name $NAMES;/g" \
    -e "s/SERVER_NAME_HERE/$SERVER_NAME/g" "$SRC" > "$TMP"

# Refuse to install a config that still has a placeholder in it. This is the
# check whose absence caused the incident: an unsubstituted path is a file that
# nginx cannot start with.
if grep -n "SERVER_NAME_HERE" "$TMP"; then
  echo "placeholders remain after substitution — refusing to install" >&2
  exit 1
fi

if [ -f "$DEST" ]; then
  BACKUP="$DEST.$(date -u +%Y%m%dT%H%M%SZ).bak"
  cp -a "$DEST" "$BACKUP"
  echo "backed up existing config to $BACKUP"
fi

cp "$TMP" "$DEST"
if ! "$NGINX" -t; then
  if [ -n "${BACKUP:-}" ]; then
    cp -a "$BACKUP" "$DEST"
    echo "nginx -t failed — restored $BACKUP, nothing changed" >&2
  else
    rm -f "$DEST"
    echo "nginx -t failed — removed the config just written" >&2
  fi
  exit 1
fi

if [ "$RELOAD" = 1 ]; then
  systemctl reload nginx
  echo "reloaded"
else
  echo "installed and tested; not reloaded (pass --reload)"
fi
