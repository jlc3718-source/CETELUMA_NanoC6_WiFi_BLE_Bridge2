#!/usr/bin/env bash
set -euo pipefail

IP="150.136.245.51"
APP="http://127.0.0.1:8080"
CERT_NAME="jason-home-ip"
WEBROOT="/var/www/html"

echo
echo "=== JASON HOME ORACLE HTTPS SETUP ==="
echo "Public IP: $IP"
echo

cd "$(dirname "$0")"

echo "1) Verifying Jason Home backend..."
curl -fsS "$APP/api/health" >/tmp/jh-health.json
python3 -m json.tool </tmp/jh-health.json

echo
echo "2) Installing nginx + snapd..."
sudo apt update
sudo apt install -y nginx snapd
sudo systemctl enable --now snapd.socket

if ! command -v certbot >/dev/null 2>&1; then
  echo
  echo "3) Installing current Certbot..."
  sudo snap install core >/dev/null 2>&1 || true
  sudo snap refresh core >/dev/null 2>&1 || true
  sudo snap install --classic certbot
  sudo ln -sf /snap/bin/certbot /usr/local/bin/certbot
else
  echo
  echo "3) Certbot already installed."
fi

CERTBOT_VER="$(certbot --version 2>&1 || true)"
echo "$CERTBOT_VER"

echo
echo "4) Creating HTTP validation/reverse-proxy configuration..."
sudo mkdir -p "$WEBROOT/.well-known/acme-challenge"

sudo tee /etc/nginx/sites-available/jason-home >/dev/null <<'NGINXHTTP'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type text/plain;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto http;
    }
}
NGINXHTTP

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/jason-home /etc/nginx/sites-enabled/jason-home
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

echo
echo "5) Verifying HTTP from the public address..."
curl -fsS "http://$IP/api/health" >/tmp/jh-public-http.json
python3 -m json.tool </tmp/jh-public-http.json

echo
echo "6) Requesting trusted Let's Encrypt IP certificate..."
if [ ! -f "/etc/letsencrypt/live/$CERT_NAME/fullchain.pem" ]; then
  sudo certbot certonly     --non-interactive     --agree-tos     --register-unsafely-without-email     --preferred-profile shortlived     --webroot     --webroot-path "$WEBROOT"     --cert-name "$CERT_NAME"     --ip-address "$IP"
else
  echo "Existing certificate found; keeping it."
fi

echo
echo "7) Enabling HTTPS reverse proxy..."
sudo tee /etc/nginx/sites-available/jason-home >/dev/null <<NGINXFULL
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location ^~ /.well-known/acme-challenge/ {
        root $WEBROOT;
        default_type text/plain;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;

    ssl_certificate /etc/letsencrypt/live/$CERT_NAME/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$CERT_NAME/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass $APP;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
NGINXFULL

sudo nginx -t
sudo systemctl reload nginx

echo
echo "8) Installing automatic certificate reload hook..."
sudo mkdir -p /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null <<'HOOK'
#!/usr/bin/env bash
systemctl reload nginx
HOOK
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

echo
echo "9) Enabling Certbot renewal..."
sudo systemctl enable --now snap.certbot.renew.timer 2>/dev/null || true

echo
echo "10) Final HTTPS health test..."
curl -fsS "https://$IP/api/health" >/tmp/jh-public-https.json
python3 -m json.tool </tmp/jh-public-https.json

echo
echo "=== HTTPS READY ==="
echo "Jason Home API:"
echo "  https://$IP"
echo
echo "Certificate:"
sudo certbot certificates | sed -n "/Certificate Name: $CERT_NAME/,+7p"
echo
echo "The Android app can now be moved from Cloudflare to Oracle."
