#!/usr/bin/env bash
# End-to-end smoke test for the MT Teams service against a live deployment.
# Usage: ./scripts/e2e.sh [https://<name>.convex.site]
set -euo pipefail

SITE="${1:-https://reminiscent-ibis-360.convex.site}"
RUN="$(date +%s)"

step() { printf '\n== %s\n' "$1"; }
jsonget() { python3 -c "import sys,json;print(json.load(sys.stdin)$2)" <<<"$1"; }

step "sign up owner"
OWNER_RES=$(curl -fsS -X POST "$SITE/api/auth/sign-up/email" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Owner $RUN\",\"email\":\"owner-$RUN@example.com\",\"password\":\"password1234\"}")
OWNER=$(jsonget "$OWNER_RES" '["token"]')
echo "token: $OWNER"

step "create team"
TEAM_RES=$(curl -fsS -X POST "$SITE/api/teams/create" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d '{"name":"E2E Team"}')
echo "$TEAM_RES"
TEAM_ID=$(jsonget "$TEAM_RES" '["teamId"]')
INVITE=$(jsonget "$TEAM_RES" '["inviteCode"]')

step "register environment"
ENV_RES=$(curl -fsS -X POST "$SITE/api/environments/register" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d '{"label":"e2e-machine"}')
echo "$ENV_RES"
ENV_ID=$(jsonget "$ENV_RES" '["environmentId"]')
ENV_KEY=$(jsonget "$ENV_RES" '["environmentKey"]')

step "sign up teammate + join via invite code"
MATE_RES=$(curl -fsS -X POST "$SITE/api/auth/sign-up/email" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Mate $RUN\",\"email\":\"mate-$RUN@example.com\",\"password\":\"password1234\"}")
MATE=$(jsonget "$MATE_RES" '["token"]')
curl -fsS -X POST "$SITE/api/teams/join" -H "Authorization: Bearer $MATE" \
  -H 'Content-Type: application/json' -d "{\"inviteCode\":\"$INVITE\"}"

step "share a thread"
SHARE_RES=$(curl -fsS -X POST "$SITE/api/threads/share" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' \
  -d "{\"teamId\":\"$TEAM_ID\",\"environmentId\":\"$ENV_ID\",\"threadId\":\"thread-$RUN\",\"title\":\"E2E thread\"}")
echo "$SHARE_RES"
SHARED_ID=$(jsonget "$SHARE_RES" '["sharedThreadId"]')

step "bridge publish status=working"
curl -fsS -X POST "$SITE/api/bridge/publish" -H "X-Environment-Key: $ENV_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"threads\":[{\"threadId\":\"thread-$RUN\",\"title\":\"E2E thread\",\"status\":\"working\",\"updatedAt\":$(($RUN * 1000))}]}"

step "teammate sees the thread"
curl -fsS "$SITE/api/threads/shared?teamId=$TEAM_ID" -H "Authorization: Bearer $MATE"

step "teammate sends a message"
MSG_RES=$(curl -fsS -X POST "$SITE/api/messages/send" -H "Authorization: Bearer $MATE" \
  -H 'Content-Type: application/json' -d "{\"sharedThreadId\":\"$SHARED_ID\",\"text\":\"hello from e2e\"}")
echo "$MSG_RES"
MSG_ID=$(jsonget "$MSG_RES" '["messageId"]')

step "bridge inbox + ack"
curl -fsS "$SITE/api/bridge/inbox" -H "X-Environment-Key: $ENV_KEY"
curl -fsS -X POST "$SITE/api/bridge/ack" -H "X-Environment-Key: $ENV_KEY" \
  -H 'Content-Type: application/json' -d "{\"messageIds\":[\"$MSG_ID\"]}"
INBOX_AFTER=$(curl -fsS "$SITE/api/bridge/inbox" -H "X-Environment-Key: $ENV_KEY")
[ "$INBOX_AFTER" = '{"messages":[]}' ] || { echo "inbox not drained: $INBOX_AFTER"; exit 1; }

step "teams/me + environments/mine"
curl -fsS "$SITE/api/teams/me" -H "Authorization: Bearer $OWNER"
curl -fsS "$SITE/api/environments/mine" -H "Authorization: Bearer $OWNER"

step "unshare"
curl -fsS -X POST "$SITE/api/threads/unshare" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d "{\"sharedThreadId\":\"$SHARED_ID\"}"

printf '\nE2E OK\n'
