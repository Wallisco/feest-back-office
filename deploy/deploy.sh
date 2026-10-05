#!/usr/bin/env bash
# Runs on the server as the deploy user, called by GitHub Actions. Zero-downtime release with rollback.
# Same as the ScootHero back office's deploy.sh, for the feest-backoffice app on port 3100.
#   deploy.sh <git-sha>
set -euo pipefail
SHA=${1:?git sha}
APP=feest-backoffice
BASE=/var/www/$APP
REPO=${REPO_URL:-git@github-feest:Wallisco/feest-back-office.git}
REL=$BASE/releases/$(date +%Y%m%d%H%M%S)-${SHA:0:7}

git clone --quiet --depth 50 "$REPO" "$REL"
cd "$REL" && git checkout --quiet "$SHA"
ln -sfn $BASE/shared/.env "$REL/.env"
npm ci --omit=dev --no-audit --no-fund

set -a; . $BASE/shared/.env; set +a
node scripts/migrate.js

PREV=$(readlink -f $BASE/current 2>/dev/null || true)
ln -sfn "$REL" $BASE/current
export APP_VERSION=${SHA:0:7}
if pm2 describe $APP >/dev/null 2>&1; then
  pm2 reload $BASE/current/ecosystem.config.js --update-env
else
  pm2 start $BASE/current/ecosystem.config.js --update-env && pm2 save
fi

# Health check; roll back the code if the new release doesn't come up.
for i in {1..20}; do
  if curl -fsS http://127.0.0.1:${PORT:-3100}/healthz >/dev/null; then
    echo "Healthy: $APP_VERSION"
    ls -1dt $BASE/releases/* | tail -n +6 | xargs -r rm -rf   # keep 5 releases
    exit 0
  fi
  sleep 2
done
echo "Health check failed; rolling back to $PREV"
[ -n "$PREV" ] && ln -sfn "$PREV" $BASE/current && pm2 reload $BASE/current/ecosystem.config.js --update-env
exit 1
