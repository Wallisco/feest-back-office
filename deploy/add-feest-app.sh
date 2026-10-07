#!/usr/bin/env bash
# One-time: serve feest.app (FEEST Driver home, privacy, support, delete account) from this app.
# Point feest.app and www.feest.app (A records) at this server first. Run as root:
#   EMAIL=wahlied@scoothero.co.za bash deploy/add-feest-app.sh
set -euo pipefail
: "${EMAIL:?Set EMAIL for the SSL certificate}"
cat > /etc/nginx/sites-available/feest-app <<'NGINX'
server {
    listen 80;
    server_name feest.app www.feest.app;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    location / {
        proxy_pass http://127.0.0.1:3100;
        include /etc/nginx/proxy_params;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/feest-app /etc/nginx/sites-enabled/feest-app
nginx -t && systemctl reload nginx
certbot --nginx -d feest.app -d www.feest.app --non-interactive --agree-tos -m "$EMAIL" --redirect
echo "Done: https://feest.app"
echo "Fill in the company details in /var/www/feest-backoffice/shared/.env (SITE_COMPANY, SITE_COMPANY_REG,"
echo "SITE_COMPANY_ADDRESS, SITE_INFO_OFFICER; optional SITE_SUPPORT_WHATSAPP), then re-run the deploy."
