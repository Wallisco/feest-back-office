#!/usr/bin/env bash
# One-time: add the FEEST back office to the ScootHero HostyAfrica VPS, which already has
# Node 22, PM2, Nginx, Postgres, certbot and the deploy user (from ScootHero's server-setup.sh).
# Run as root from a checkout of this repo:
#   DOMAIN=delivery-test.scoothero.co.za EMAIL=wahlied@quikr.co.za bash deploy/add-to-server.sh
set -euo pipefail

: "${DOMAIN:?Set DOMAIN, e.g. delivery-test.scoothero.co.za}"
: "${EMAIL:?Set EMAIL for the SSL certificate}"
APP=feest-backoffice
APP_USER=deploy
BASE=/var/www/$APP
HERE="$(cd "$(dirname "$0")" && pwd)"

for c in node pm2 nginx psql certbot; do command -v $c >/dev/null || { echo "$c is missing. Run ScootHero's deploy/server-setup.sh first." >&2; exit 1; }; done
id -u $APP_USER >/dev/null || { echo "User $APP_USER is missing. Run ScootHero's server-setup.sh first." >&2; exit 1; }

echo "== Folders"
mkdir -p $BASE/{releases,shared,storage,backups}
chown -R $APP_USER:$APP_USER $BASE
chmod 750 $BASE/storage $BASE/backups

echo "== Database (separate from ScootHero's)"
DB_PASS=$(openssl rand -base64 24 | tr -d '/+=')
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='feest'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE feest LOGIN PASSWORD '$DB_PASS';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='feest_backoffice'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE feest_backoffice OWNER feest;"

if [ ! -f $BASE/shared/.env ]; then
  cat > $BASE/shared/.env <<ENV
NODE_ENV=production
PORT=3100
DATABASE_URL=postgres://feest:$DB_PASS@127.0.0.1:5432/feest_backoffice
SESSION_SECRET=$(openssl rand -hex 32)
STORAGE_DIR=$BASE/storage
STORAGE_SIGNING_SECRET=$(openssl rand -hex 32)
APP_URL=https://$DOMAIN
# Email for agreement packs (cPanel mail, Microsoft 365 or any SMTP). Without these, reps download and send the PDF themselves.
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
# MAIL_FROM="FEEST <sales@feest.co.za>"
ENV
  chown $APP_USER:$APP_USER $BASE/shared/.env && chmod 600 $BASE/shared/.env
  echo "Wrote $BASE/shared/.env (database password generated; not shown)."
fi

echo "== Nginx"
sed "s/__DOMAIN__/$DOMAIN/g" "$HERE/nginx.conf" > /etc/nginx/sites-available/$APP
ln -sf /etc/nginx/sites-available/$APP /etc/nginx/sites-enabled/$APP
nginx -t && systemctl reload nginx

echo "== SSL"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || \
  echo "certbot failed: point $DOMAIN's DNS at this server, then run: certbot --nginx -d $DOMAIN"

echo "== GitHub read access (its own deploy key; GitHub allows a key on one repo only)"
KEY=/home/$APP_USER/.ssh/id_ed25519_feest
if [ ! -f $KEY ]; then
  sudo -u $APP_USER ssh-keygen -t ed25519 -N "" -C "feest-backoffice-server" -f $KEY
fi
grep -q "Host github-feest" /home/$APP_USER/.ssh/config 2>/dev/null || cat >> /home/$APP_USER/.ssh/config <<CFG
Host github-feest
  HostName github.com
  User git
  IdentityFile $KEY
  IdentitiesOnly yes
CFG
chown $APP_USER:$APP_USER /home/$APP_USER/.ssh/config && chmod 600 /home/$APP_USER/.ssh/config
sudo -u $APP_USER sh -c "grep -q github.com ~/.ssh/known_hosts 2>/dev/null || ssh-keyscan github.com >> ~/.ssh/known_hosts"

echo "== Deploy and backup scripts"
install -m 750 -o $APP_USER -g $APP_USER "$HERE/deploy.sh" $BASE/deploy.sh
install -m 750 -o $APP_USER -g $APP_USER "$HERE/backup.sh" $BASE/backup.sh
{ crontab -u $APP_USER -l 2>/dev/null | grep -v "$BASE/backup.sh" || true; echo "15 2 * * * $BASE/backup.sh >> $BASE/backups/backup.log 2>&1"; } | crontab -u $APP_USER -

echo
echo "Done. Next:"
echo "  1. Add this key to github.com/Wallisco/feest-back-office → Settings → Deploy keys (read-only):"
cat $KEY.pub
echo "  2. In the repo's GitHub Actions secrets set SSH_HOST, SSH_USER=deploy and SSH_KEY"
echo "     (the same Actions key the ScootHero back office uses is fine)."
echo "  3. Push to main. After the first deploy, create the first login:"
echo "     sudo -u $APP_USER bash -c 'cd $BASE/current && set -a && . ../shared/.env && node scripts/create-user.js --name \"Wahlied Cole\" --email wahlied@scoothero.co.za --role ceo'"
