#!/bin/bash
# Runs a shell script as root on the Finance Close VM through AWS SSM and prints its output.
#
#   scripts/aws/ssm-run.sh <script-file> [timeout-seconds]
#
# AWS credentials: the usual environment variables / profile. Set AWS_CREDS_FILE to a file of
# "export AWS_..." lines to source it first (e.g. the SSO keys copied from the access portal).
# FC_INSTANCE_ID / AWS_REGION override the defaults below. Exits non-zero unless the script
# succeeded on the VM.
set -euo pipefail
INSTANCE_ID=${FC_INSTANCE_ID:-i-0eb7fc8a754dafc25}
export AWS_DEFAULT_REGION=${AWS_REGION:-us-east-1}
if [ -n "${AWS_CREDS_FILE:-}" ]; then source "$AWS_CREDS_FILE"; fi
[ -f "${1:-}" ] || { echo "usage: $0 <script-file> [timeout-seconds]"; exit 2; }

params=$(python3 -c 'import json,sys; print(json.dumps({"commands":[open(sys.argv[1]).read()],"executionTimeout":[sys.argv[2]]}))' "$1" "${2:-600}")
cid=$(aws ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
  --parameters "$params" --query Command.CommandId --output text)
while :; do
  st=$(aws ssm get-command-invocation --command-id "$cid" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || true)
  case "$st" in Success|Failed|Cancelled|TimedOut) break ;; esac
  sleep 3
done
aws ssm get-command-invocation --command-id "$cid" --instance-id "$INSTANCE_ID" \
  --query '[StandardOutputContent,StandardErrorContent]' --output text
echo "== $st"
[ "$st" = Success ]
