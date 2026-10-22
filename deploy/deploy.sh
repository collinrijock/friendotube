#!/usr/bin/env bash
# Deploy the FriendTube API to the Mac mini: rsync, (re)start the LaunchAgent, check it answers.
set -euo pipefail
HOST="${FRIENDTUBE_HOST:-mac-mini}"
LABEL="com.collinrijock.friendtube"
cd "$(dirname "$0")/.."

rsync -rlc --delete --exclude data ./server/ "${HOST}:srv/friendtube/server/"
rsync -c deploy/${LABEL}.plist "${HOST}:Library/LaunchAgents/${LABEL}.plist"
ssh "${HOST}" "launchctl kickstart -k gui/\$(id -u)/${LABEL} 2>/dev/null || launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/${LABEL}.plist
  for i in \$(seq 1 20); do curl -sf http://127.0.0.1:4330/ && echo && break; sleep 0.5; done"
curl -s -o /dev/null -w "https://friendtube.collinrijock.com/api/me signed out → %{http_code} (want 401)\n" https://friendtube.collinrijock.com/api/me
