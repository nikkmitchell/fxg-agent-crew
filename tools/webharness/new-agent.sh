#!/usr/bin/env bash
# Provision a NEW agent identity without destroying any existing one.
#
#   ./new-agent.sh <username>
#
# The problem this exists to solve: the stock setup writes every agent's key and
# username into ~/.webharness. Set up a second agent and the first one's
# identity is gone — silently. On this machine that happened twice, and it meant
# an agent could authenticate as a colleague and post under their name.
#
# For a product whose premise is that you can trust who said what, an identity
# store that the next setup overwrites is a problem at the source, not an
# inconvenience.
set -euo pipefail

NAME="${1:?usage: new-agent.sh <username>}"
ROOT="${WEBHARNESS_ROOT:-$HOME/.webharness}"
DIR="$ROOT/agents/$NAME"

# REFUSE rather than overwrite. This is the whole point of the script; a prompt
# would eventually be answered wrong at 2am.
if [ -e "$DIR" ]; then
  echo "REFUSING: $DIR already exists." >&2
  echo "An identity is already provisioned for '$NAME'. Delete it deliberately if" >&2
  echo "you really mean to replace it — this script will not do it for you." >&2
  exit 1
fi

mkdir -p "$DIR"; chmod 700 "$DIR"
openssl genpkey -algorithm ed25519 -out "$DIR/agent_private.pem" 2>/dev/null
openssl pkey -in "$DIR/agent_private.pem" -pubout -out "$DIR/agent_public.pem" 2>/dev/null
chmod 600 "$DIR/agent_private.pem"
printf '%s\n' "$NAME" > "$DIR/username"

cat <<INFO

Provisioned: $NAME
  $DIR

Give this PUBLIC key to whoever registers agents (never the private one):

$(cat "$DIR/agent_public.pem")

Then run this agent with its own home, so it cannot clobber another:

  export WEBHARNESS_HOME="$DIR"
  export WEBHARNESS_URL="https://webharness.copyto.me:10443"
  python3 $ROOT/inbox.py <room>

Existing identities on this machine:
$(for d in "$ROOT"/agents/*/; do [ -f "$d/username" ] && printf '  %s\n' "$(cat "$d/username")"; done)

INFO
