#!/bin/bash
# Deploys the current working tree to the Finance Close VM (finance-close.aistra.com).
#
#   AWS_CREDS_FILE=/path/to/aws-keys scripts/aws/deploy.sh
#
# 1. Packs the repo (no node_modules, dist, data, .env files or docs/ – docs holds the client's
#    confidential workbook) and uploads it over SSM in chunks (md5 checked).
# 2. On the VM: builds it in /opt/finance-close-new while the current version keeps running,
#    applies pending database migrations (prisma migrate deploy; secrets from Secrets Manager),
#    swaps it in, and checks /api/health. If the new version is not healthy it rolls back to
#    the previous one (kept in /opt/finance-close-prev).
#
# Server layout (see docs/Finance_Close_Deployment_Tracker.xlsx): code /opt/finance-close, user
# finclose, service finance-close (systemd), settings /etc/finance-close-app/app.env (no
# secrets), uploads /var/lib/finance-close/uploads, secrets in AWS Secrets Manager.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
RUN="$ROOT/scripts/aws/ssm-run.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "→ packing $ROOT"
(cd "$ROOT" && COPYFILE_DISABLE=1 tar czf "$WORK/fc.tgz" --no-xattrs \
  --exclude node_modules --exclude dist --exclude .git --exclude ./data --exclude ./docs \
  --exclude '.env' --exclude '.env.local' --exclude .DS_Store --exclude '*.tsbuildinfo' \
  --exclude playwright-report --exclude test-results --exclude ./.claude --exclude ./.planning .)
MD5=$( (md5 -q "$WORK/fc.tgz" 2>/dev/null) || md5sum "$WORK/fc.tgz" | cut -d' ' -f1)
echo "  $(du -h "$WORK/fc.tgz" | cut -f1), md5 $MD5"

echo "→ uploading"
mkdir "$WORK/parts"
base64 < "$WORK/fc.tgz" | tr -d '\n' | split -b 40000 - "$WORK/parts/p_"
echo 'rm -rf /tmp/fcup && mkdir -p /tmp/fcup' > "$WORK/init.sh"
"$RUN" "$WORK/init.sh" 60 > /dev/null
export RUN
ls "$WORK"/parts/p_* | xargs -P 6 -I{} bash -c '
  n=$(basename {}); printf "printf %%s %s > /tmp/fcup/%s\n" "$(cat {})" "$n" > {}.sh
  "$RUN" {}.sh 60 > /dev/null || { echo "upload of $n failed"; exit 255; }'
echo "  $(ls "$WORK"/parts/p_* | grep -vc '\.sh$') parts sent"

cat > "$WORK/remote.sh" <<EOF
set -e
cd /tmp/fcup && cat p_* | base64 -d > fc.tgz
[ "\$(md5sum fc.tgz | cut -d' ' -f1)" = "$MD5" ] || { echo "checksum mismatch – nothing changed"; exit 1; }
rm -rf /opt/finance-close-new && mkdir -p /opt/finance-close-new
tar xzf fc.tgz -C /opt/finance-close-new --no-same-owner 2>/dev/null
chown -R finclose:finclose /opt/finance-close-new
cd /opt/finance-close-new
sudo -u finclose -H env HOME=/opt/finance-close npm ci --no-audit --no-fund --loglevel=error 2>&1 | grep -v 'npm notice' | tail -2
sudo -u finclose -H env HOME=/opt/finance-close npm run build 2>&1 | grep -E 'error|built in' | head -5
[ -f apps/api/dist/main.js ] && [ -f apps/web/dist/index.html ] || { echo "build failed – nothing changed"; exit 1; }
set -a; . /etc/finance-close-app/app.env; set +a
sudo -u finclose --preserve-env env HOME=/opt/finance-close \
  node scripts/with-aws-secrets.mjs npm run db:migrate:deploy 2>&1 \
  | grep -vE '^\[secrets\]|://' | tail -3
systemctl stop finance-close.service
rm -rf /opt/finance-close-prev && mv /opt/finance-close /opt/finance-close-prev && mv /opt/finance-close-new /opt/finance-close
systemctl start finance-close.service; sleep 15
health=\$(curl -s --max-time 10 http://127.0.0.1:3000/api/health || true)
if [ "\$health" != '{"status":"ok","db":"ok"}' ]; then
  echo "new version not healthy (\$health) – rolling back"
  journalctl -u finance-close.service --no-pager -o cat --since "-30s" | tail -5
  systemctl stop finance-close.service
  rm -rf /opt/finance-close-failed && mv /opt/finance-close /opt/finance-close-failed && mv /opt/finance-close-prev /opt/finance-close
  systemctl start finance-close.service; sleep 12
  echo "rolled back · health: \$(curl -s http://127.0.0.1:3000/api/health)"; exit 1
fi
rm -rf /tmp/fcup
echo "deployed · health: \$health · via nginx: \$(curl -sk -o /dev/null -w '%{http_code}' --resolve finance-close.aistra.com:443:127.0.0.1 https://finance-close.aistra.com/)"
EOF
echo "→ building and switching on the VM"
"$RUN" "$WORK/remote.sh" 900
