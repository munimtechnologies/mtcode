#!/usr/bin/env bash
# End-to-end smoke test for the MT Teams service against a live deployment.
# Usage: ./scripts/e2e.sh [https://<name>.convex.site]
set -euo pipefail

SITE="${1:-https://reminiscent-ibis-360.convex.site}"
RUN="$(date +%s)"
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

step() { printf '\n== %s\n' "$1"; }
jsonget() { python3 -c "import sys,json;print(json.load(sys.stdin)$2)" <<<"$1"; }

# expect_status <expected> <method> <path> <token> [body]
# Asserts the HTTP status and echoes the response body.
expect_status() {
  local expected="$1" method="$2" path="$3" token="$4" body="${5:-}"
  local status
  status=$(curl -sS -o "$BODY_FILE" -w '%{http_code}' -X "$method" "$SITE$path" \
    -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    ${body:+-d "$body"})
  cat "$BODY_FILE"; echo
  if [ "$status" != "$expected" ]; then
    echo "FAIL: expected HTTP $expected from $method $path, got $status" >&2
    exit 1
  fi
}

MATE_EMAIL="mate-$RUN@example.com"
STRANGER_EMAIL="stranger-$RUN@example.com"

step "sign up owner"
OWNER_RES=$(curl -fsS -X POST "$SITE/api/auth/sign-up/email" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Owner $RUN\",\"email\":\"owner-$RUN@example.com\",\"password\":\"password1234\"}")
OWNER=$(jsonget "$OWNER_RES" '["token"]')
echo "token: $OWNER"

step "create team (no inviteCode in response)"
TEAM_RES=$(curl -fsS -X POST "$SITE/api/teams/create" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d '{"name":"E2E Team"}')
echo "$TEAM_RES"
TEAM_ID=$(jsonget "$TEAM_RES" '["teamId"]')
python3 -c "import json,sys; body=json.loads(sys.argv[1]); assert 'inviteCode' not in body, 'inviteCode leaked'" "$TEAM_RES"

step "legacy /api/teams/join returns 410"
expect_status 410 POST /api/teams/join "$OWNER" '{"inviteCode":"ABCDEFGH"}'

step "invite mate by email (mixed case in, lowercased out) + idempotency"
INV_RES=$(curl -fsS -X POST "$SITE/api/teams/invite" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d "{\"teamId\":\"$TEAM_ID\",\"email\":\"  Mate-$RUN@Example.com \"}")
echo "$INV_RES"
INVITE_ID=$(jsonget "$INV_RES" '["inviteId"]')
INV_AGAIN=$(curl -fsS -X POST "$SITE/api/teams/invite" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d "{\"teamId\":\"$TEAM_ID\",\"email\":\"$MATE_EMAIL\"}")
INVITE_ID_AGAIN=$(jsonget "$INV_AGAIN" '["inviteId"]')
[ "$INVITE_ID" = "$INVITE_ID_AGAIN" ] || { echo "FAIL: re-invite minted a new invite ($INVITE_ID vs $INVITE_ID_AGAIN)"; exit 1; }

step "team invite list shows the pending invite"
LIST_RES=$(curl -fsS "$SITE/api/teams/invites?teamId=$TEAM_ID" -H "Authorization: Bearer $OWNER")
echo "$LIST_RES"
python3 -c "
import json,sys
body=json.loads(sys.argv[1])
[inv]=body['invites']
assert inv['email']==sys.argv[2], inv
assert inv['inviteId']==sys.argv[3], inv
assert isinstance(inv['createdAt'], (int,float)) and inv['createdAt']>1_000_000_000_000, inv
assert inv['invitedByName'].startswith('Owner'), inv
" "$LIST_RES" "$MATE_EMAIL" "$INVITE_ID"

step "sign up mate + invite appears in /api/invites/mine"
MATE_RES=$(curl -fsS -X POST "$SITE/api/auth/sign-up/email" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Mate $RUN\",\"email\":\"$MATE_EMAIL\",\"password\":\"password1234\"}")
MATE=$(jsonget "$MATE_RES" '["token"]')
MINE_RES=$(curl -fsS "$SITE/api/invites/mine" -H "Authorization: Bearer $MATE")
echo "$MINE_RES"
python3 -c "
import json,sys
[inv]=json.loads(sys.argv[1])['invites']
assert inv['inviteId']==sys.argv[2] and inv['teamId']==sys.argv[3], inv
assert inv['teamName']=='E2E Team', inv
" "$MINE_RES" "$INVITE_ID" "$TEAM_ID"

step "stranger cannot accept someone else's invite (403)"
STRANGER_RES=$(curl -fsS -X POST "$SITE/api/auth/sign-up/email" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Stranger $RUN\",\"email\":\"$STRANGER_EMAIL\",\"password\":\"password1234\"}")
STRANGER=$(jsonget "$STRANGER_RES" '["token"]')
expect_status 403 POST /api/invites/accept "$STRANGER" "{\"inviteId\":\"$INVITE_ID\"}"

step "mate accepts"
ACCEPT_RES=$(curl -fsS -X POST "$SITE/api/invites/accept" -H "Authorization: Bearer $MATE" \
  -H 'Content-Type: application/json' -d "{\"inviteId\":\"$INVITE_ID\"}")
echo "$ACCEPT_RES"
[ "$(jsonget "$ACCEPT_RES" '["teamId"]')" = "$TEAM_ID" ] || { echo "FAIL: accept returned wrong teamId"; exit 1; }

step "re-inviting a member returns 409; invite is consumed"
expect_status 409 POST /api/teams/invite "$OWNER" "{\"teamId\":\"$TEAM_ID\",\"email\":\"$MATE_EMAIL\"}"
MINE_AFTER=$(curl -fsS "$SITE/api/invites/mine" -H "Authorization: Bearer $MATE")
[ "$MINE_AFTER" = '{"invites":[]}' ] || { echo "FAIL: invite not consumed: $MINE_AFTER"; exit 1; }

step "both are members (teams/me, no inviteCode)"
ME_RES=$(curl -fsS "$SITE/api/teams/me" -H "Authorization: Bearer $OWNER")
echo "$ME_RES"
MATE_USER_ID=$(python3 -c "
import json,sys
[team]=json.loads(sys.argv[1])['teams']
assert 'inviteCode' not in team, team
emails=sorted(m['email'] for m in team['members'])
assert emails==sorted([sys.argv[2],sys.argv[3]]), emails
print(next(m['userId'] for m in team['members'] if m['email']==sys.argv[3]))
" "$ME_RES" "owner-$RUN@example.com" "$MATE_EMAIL")

step "register environment"
ENV_RES=$(curl -fsS -X POST "$SITE/api/environments/register" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d '{"label":"e2e-machine"}')
echo "$ENV_RES"
ENV_ID=$(jsonget "$ENV_RES" '["environmentId"]')
ENV_KEY=$(jsonget "$ENV_RES" '["environmentKey"]')

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

step "unshare"
curl -fsS -X POST "$SITE/api/threads/unshare" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d "{\"sharedThreadId\":\"$SHARED_ID\"}"

step "revoke: invite stranger, then revoke it"
REV_INV=$(curl -fsS -X POST "$SITE/api/teams/invite" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d "{\"teamId\":\"$TEAM_ID\",\"email\":\"$STRANGER_EMAIL\"}")
REV_ID=$(jsonget "$REV_INV" '["inviteId"]')
curl -fsS -X POST "$SITE/api/teams/invites/revoke" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d "{\"inviteId\":\"$REV_ID\"}"
STRANGER_MINE=$(curl -fsS "$SITE/api/invites/mine" -H "Authorization: Bearer $STRANGER")
[ "$STRANGER_MINE" = '{"invites":[]}' ] || { echo "FAIL: revoked invite still visible: $STRANGER_MINE"; exit 1; }

step "decline: invite stranger again, stranger declines"
DEC_INV=$(curl -fsS -X POST "$SITE/api/teams/invite" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d "{\"teamId\":\"$TEAM_ID\",\"email\":\"$STRANGER_EMAIL\"}")
DEC_ID=$(jsonget "$DEC_INV" '["inviteId"]')
curl -fsS -X POST "$SITE/api/invites/decline" -H "Authorization: Bearer $STRANGER" \
  -H 'Content-Type: application/json' -d "{\"inviteId\":\"$DEC_ID\"}"
STRANGER_MINE=$(curl -fsS "$SITE/api/invites/mine" -H "Authorization: Bearer $STRANGER")
[ "$STRANGER_MINE" = '{"invites":[]}' ] || { echo "FAIL: declined invite still visible: $STRANGER_MINE"; exit 1; }

step "self-remove via members/remove is rejected"
OWNER_USER_ID=$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['user']['id'])" "$ME_RES")
expect_status 400 POST /api/teams/members/remove "$OWNER" "{\"teamId\":\"$TEAM_ID\",\"userId\":\"$OWNER_USER_ID\"}"

step "mate leaves the team"
curl -fsS -X POST "$SITE/api/teams/leave" -H "Authorization: Bearer $MATE" \
  -H 'Content-Type: application/json' -d "{\"teamId\":\"$TEAM_ID\"}"
ME_AFTER_LEAVE=$(curl -fsS "$SITE/api/teams/me" -H "Authorization: Bearer $OWNER")
python3 -c "
import json,sys
[team]=json.loads(sys.argv[1])['teams']
assert len(team['members'])==1, team['members']
" "$ME_AFTER_LEAVE"

step "re-invite + accept, then owner removes mate via members/remove"
RE_INV=$(curl -fsS -X POST "$SITE/api/teams/invite" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d "{\"teamId\":\"$TEAM_ID\",\"email\":\"$MATE_EMAIL\"}")
RE_ID=$(jsonget "$RE_INV" '["inviteId"]')
curl -fsS -X POST "$SITE/api/invites/accept" -H "Authorization: Bearer $MATE" \
  -H 'Content-Type: application/json' -d "{\"inviteId\":\"$RE_ID\"}"
curl -fsS -X POST "$SITE/api/teams/members/remove" -H "Authorization: Bearer $OWNER" \
  -H 'Content-Type: application/json' -d "{\"teamId\":\"$TEAM_ID\",\"userId\":\"$MATE_USER_ID\"}"
ME_AFTER_REMOVE=$(curl -fsS "$SITE/api/teams/me" -H "Authorization: Bearer $OWNER")
python3 -c "
import json,sys
[team]=json.loads(sys.argv[1])['teams']
assert len(team['members'])==1, team['members']
" "$ME_AFTER_REMOVE"

printf '\nE2E OK\n'
