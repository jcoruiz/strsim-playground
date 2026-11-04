#!/usr/bin/env bash
# Builds the site and publishes it as a manual deployment of the main branch
# of the AWS Amplify app, with the response headers of customHttp.yml.
#
#   AWS_PROFILE=personal scripts/deploy.sh
#
# AMPLIFY_APP_ID and AWS_REGION default to the app behind strsim.than.cl.
set -euo pipefail
cd "$(dirname "$0")/.."

app="${AMPLIFY_APP_ID:-d23fd405erpqcp}"
branch="${AMPLIFY_BRANCH:-main}"
export AWS_REGION="${AWS_REGION:-us-west-2}"

if [ -n "$(git status --porcelain)" ]; then
  echo "the working tree has uncommitted changes: commit them first" >&2
  exit 1
fi

npm run build

# Manual deployments do not read customHttp.yml; the app holds the headers.
aws amplify update-app --app-id "$app" --custom-headers "$(cat customHttp.yml)" > /dev/null

zip="$(mktemp -d)/site.zip"
(cd dist && python3 -m zipfile -c "$zip" ./*)

read -r job url < <(aws amplify create-deployment --app-id "$app" --branch-name "$branch" --query '[jobId, zipUploadUrl]' --output text)
curl -fsS --upload-file "$zip" "$url"
aws amplify start-deployment --app-id "$app" --branch-name "$branch" --job-id "$job" > /dev/null

while :; do
  status=$(aws amplify get-job --app-id "$app" --branch-name "$branch" --job-id "$job" --query 'job.summary.status' --output text)
  case "$status" in
    SUCCEED) break ;;
    FAILED | CANCELLED) echo "deployment $job: $status" >&2; exit 1 ;;
  esac
  sleep 5
done
echo "deployed $(git rev-parse --short HEAD) as job $job"
