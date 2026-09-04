#!/usr/bin/env bash
# First-time provisioning for a fresh Ubuntu 24.04 host.
#
# Safe to re-run: every step is idempotent. Run as root.
#
# It deliberately does NOT start the service — the operator fills in
# /etc/fxg-crew/env first, because starting without a real SESSION_SECRET is
# exactly the failure loadConfig() refuses to allow.
set -euo pipefail

log() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

log "Node 24"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node --version

log "nginx + certbot"
apt-get install -y nginx certbot python3-certbot-nginx

log "service account"
# No login shell, no home: this account exists to run one process. If the
# service is compromised, the attacker gets no shell.
id -u fxgcrew >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin fxgcrew

log "directories"
install -d -o fxgcrew -g fxgcrew -m 0755 /opt/fxg-crew
install -d -o fxgcrew -g fxgcrew -m 0700 /var/lib/fxg-crew   # holds session tokens
install -d -o root    -g root    -m 0700 /etc/fxg-crew       # holds the secret

log "firewall"
# Only 22/80/443. The Node process listens on loopback and must never be
# reachable directly.
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status verbose

log "ssh hardening"
# The root password for this host was exposed in a chat transcript, and a
# public box with password auth is the most brute-forced thing on the internet.
# Keys only, no root password login.
sshd_conf=/etc/ssh/sshd_config.d/99-fxg-hardening.conf
cat > "$sshd_conf" <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
SSHD
# Refuse to lock ourselves out: only apply if a key is actually installed.
if [ -s /root/.ssh/authorized_keys ]; then
  sshd -t && systemctl reload ssh
  echo "password auth disabled; key auth verified present"
else
  rm -f "$sshd_conf"
  echo "REFUSED to disable password auth: /root/.ssh/authorized_keys is empty."
  echo "Install the deploy public key first, then re-run."
fi

log "next steps"
cat <<'NEXT'
1. Secrets:
     cp deploy/env.example /etc/fxg-crew/env
     sed -i "s|SESSION_SECRET=REPLACE_ME|SESSION_SECRET=$(openssl rand -base64 48)|" /etc/fxg-crew/env
     chmod 600 /etc/fxg-crew/env
   APP_BASE_PATH and SESSION_STORE_PATH must both be set. The service mounts at
   the default and serves "/" without the first, and crashes on a read-only path
   without the second.

2. TLS: FOLLOW deploy/README.md SECTION 3. Do not improvise this.

   Deliberately NOT repeated here as a one-liner, because the order matters and
   a copy of it in two places is a copy that goes stale. In short: an HTTP-only
   bootstrap config, THEN `certbot certonly --webroot`, THEN the real TLS config.

   This script used to say `certbot --nginx -d your.hostname` at this point.
   That was wrong twice over: the nginx plugin rewrites the config, so the file
   that runs is not the file that was reviewed; and installing the TLS config
   first deadlocks the host, because it references certificate files that do not
   exist yet, so `nginx -t` fails, so nginx will not start, so it cannot serve
   the ACME challenge that would create them.

3. Ship and verify from a checkout:
     deploy/release.sh root@your.hostname
NEXT
