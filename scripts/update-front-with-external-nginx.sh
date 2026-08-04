echo -e "Copying Fronend into /var/www/stealthnet..."
mkdir -p /var/www/stealthnet
docker compose cp frontend:/dist/. /var/www/stealthnet/ 2>/dev/null || {
  # Fallback: copying from volume
  docker run --rm -v stealthnet_frontend_dist:/src -v /var/www/stealthnet:/dst alpine sh -c "cp -r /src/* /dst/"
  }

# Copying static manifest anyway even when favicon is empty
curl -fsS http://127.0.0.1:5000/_spa -o /var/www/stealthnet/index.html || true
curl -fsS http://127.0.0.1:5000/api/public/manifest.webmanifest -o /var/www/stealthnet/manifest.webmanifest || true

echo -e "Frontend copied in /var/www/stealthnet/";
