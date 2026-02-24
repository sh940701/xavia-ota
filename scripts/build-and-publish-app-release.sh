#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <runtimeVersion> <xavia-ota-url> <upload-key>"
  exit 1
fi

runtimeVersion="$1"
serverHost="$2"
uploadKey="$3"

commitHash=$(git rev-parse HEAD)
commitMessage=$(git log -1 --pretty=%B)

timestamp=$(date -u +%Y%m%d%H%M%S)
outputFolder="../ota-builds/${timestamp}"
uploadUrl="${serverHost%/}/api/upload"

echo "Output Folder: ${outputFolder}"
echo "Runtime Version: ${runtimeVersion}"
echo "Commit Hash: ${commitHash}"
echo "Commit Message: ${commitMessage}"
echo "Upload URL: ${uploadUrl}"

read -p "Do you want to proceed with these values? (y/n): " confirm
if [ "${confirm}" != "y" ]; then
  echo "Operation cancelled by the user."
  exit 1
fi

rm -rf "${outputFolder}"
mkdir -p "${outputFolder}"

npx expo export --output-dir "${outputFolder}"
jq '.expo' app.json > "${outputFolder}/expoconfig.json"

(
  cd "${outputFolder}"
  zip -q -r "${timestamp}.zip" .

  curl -X POST "${uploadUrl}" \
    -F "file=@${timestamp}.zip" \
    -F "runtimeVersion=${runtimeVersion}" \
    -F "commitHash=${commitHash}" \
    -F "commitMessage=${commitMessage}" \
    -F "uploadKey=${uploadKey}"
)

echo ""
echo "Uploaded to ${uploadUrl}"

rm -rf "${outputFolder}"
echo "Removed ${outputFolder}"
echo "Done"
