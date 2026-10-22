#!/usr/bin/env bash
# Deploy the FriendoTube API to the Mac mini: rsync, (re)start the LaunchAgent, check it answers.
set -euo pipefail
HOST="${FRIENDOTUBE_HOST:-mac-mini}"
LABEL="com.collinrijock.friendotube"
cd "$(dirname "$0")/.."

rsync -rlc --delete --exclude data ./server/ "${HOST}:srv/friendotube/server/"
rsync -c deploy/${LABEL}.plist "${HOST}:Library/LaunchAgents/${LABEL}.plist"
ssh "${HOST}" "launchctl kickstart -k gui/\$(id -u)/${LABEL} 2>/dev/null || launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/${LABEL}.plist
  for i in \$(seq 1 20); do curl -sf -o /dev/null -w "origin %{http_code}\\n" http://127.0.0.1:4330/privacy && break; sleep 0.5; done"
curl -s -o /dev/null -w "https://friendotube.collinrijock.com/api/me signed out → %{http_code} (want 401)\n" https://friendotube.collinrijock.com/api/me
