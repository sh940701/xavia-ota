#!/usr/bin/env bash
set -euo pipefail

TARGET_FILE="${1:-.env.aws}"
SOURCE_FILE="${2:-.env.local}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required but not installed"
  exit 1
fi

if [ -f "$SOURCE_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$SOURCE_FILE"
  set +a
fi

HOST_VALUE="${HOST:-https://ota-dev.example.com}"
BLOB_STORAGE_TYPE_VALUE="${BLOB_STORAGE_TYPE:-s3}"
DB_TYPE_VALUE="${DB_TYPE:-supabase}"

S3_REGION_VALUE="${S3_REGION:-ap-northeast-2}"
S3_ENDPOINT_VALUE="${S3_ENDPOINT:-}"
S3_ACCESS_KEY_ID_VALUE="${S3_ACCESS_KEY_ID:-}"
S3_SECRET_ACCESS_KEY_VALUE="${S3_SECRET_ACCESS_KEY:-}"
S3_SESSION_TOKEN_VALUE="${S3_SESSION_TOKEN:-}"
S3_BUCKET_NAME_VALUE="${S3_BUCKET_NAME:-}"

SUPABASE_URL_VALUE="${SUPABASE_URL:-}"
SUPABASE_API_KEY_VALUE="${SUPABASE_API_KEY:-}"
SUPABASE_BUCKET_NAME_VALUE="${SUPABASE_BUCKET_NAME:-expo-updates}"

POSTGRES_HOST_VALUE="${POSTGRES_HOST:-}"
POSTGRES_PORT_VALUE="${POSTGRES_PORT:-5432}"
POSTGRES_DB_VALUE="${POSTGRES_DB:-}"
POSTGRES_USER_VALUE="${POSTGRES_USER:-}"
POSTGRES_PASSWORD_VALUE="${POSTGRES_PASSWORD:-}"

ADMIN_PASSWORD_VALUE="$(openssl rand -hex 24)"
ADMIN_SESSION_SECRET_VALUE="$(openssl rand -hex 64)"
UPLOAD_KEY_VALUE="$(openssl rand -hex 32)"
PRIVATE_KEY_BASE_64_VALUE="${PRIVATE_KEY_BASE_64:-}"

cat > "$TARGET_FILE" <<EOF
HOST=${HOST_VALUE}
NODE_ENV=production
PORT=3000

BLOB_STORAGE_TYPE=${BLOB_STORAGE_TYPE_VALUE}
DB_TYPE=${DB_TYPE_VALUE}

S3_REGION=${S3_REGION_VALUE}
S3_ENDPOINT=${S3_ENDPOINT_VALUE}
S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID_VALUE}
S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY_VALUE}
S3_SESSION_TOKEN=${S3_SESSION_TOKEN_VALUE}
S3_BUCKET_NAME=${S3_BUCKET_NAME_VALUE}

SUPABASE_URL=${SUPABASE_URL_VALUE}
SUPABASE_API_KEY=${SUPABASE_API_KEY_VALUE}
SUPABASE_BUCKET_NAME=${SUPABASE_BUCKET_NAME_VALUE}

POSTGRES_HOST=${POSTGRES_HOST_VALUE}
POSTGRES_PORT=${POSTGRES_PORT_VALUE}
POSTGRES_DB=${POSTGRES_DB_VALUE}
POSTGRES_USER=${POSTGRES_USER_VALUE}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD_VALUE}

ADMIN_PASSWORD=${ADMIN_PASSWORD_VALUE}
ADMIN_SESSION_SECRET=${ADMIN_SESSION_SECRET_VALUE}
ADMIN_SESSION_MAX_AGE_SECONDS=43200
UPLOAD_KEY=${UPLOAD_KEY_VALUE}
PRIVATE_KEY_BASE_64=${PRIVATE_KEY_BASE_64_VALUE}
EOF

chmod 600 "$TARGET_FILE"

echo "Generated $TARGET_FILE"
echo "- secrets rotated: ADMIN_PASSWORD, ADMIN_SESSION_SECRET, UPLOAD_KEY"
echo "- defaults loaded from: $SOURCE_FILE (if present)"

if [ "$BLOB_STORAGE_TYPE_VALUE" = "s3" ]; then
  if [ -z "$S3_BUCKET_NAME_VALUE" ]; then
    echo "- warning: S3_BUCKET_NAME is empty. Fill it before deploy."
  fi

  if [ -n "$S3_ACCESS_KEY_ID_VALUE" ] && [ -z "$S3_SECRET_ACCESS_KEY_VALUE" ]; then
    echo "- warning: S3_ACCESS_KEY_ID is set but S3_SECRET_ACCESS_KEY is empty. Set both or neither."
  fi

  if [ -z "$S3_ACCESS_KEY_ID_VALUE" ] && [ -n "$S3_SECRET_ACCESS_KEY_VALUE" ]; then
    echo "- warning: S3_SECRET_ACCESS_KEY is set but S3_ACCESS_KEY_ID is empty. Set both or neither."
  fi

  if [ -z "$S3_ACCESS_KEY_ID_VALUE" ] && [ -z "$S3_SECRET_ACCESS_KEY_VALUE" ]; then
    echo "- info: S3 static credentials are empty. Runtime will use IAM/default AWS credential chain."
  fi
fi

if [ "$DB_TYPE_VALUE" = "supabase" ]; then
  if [ -z "$SUPABASE_URL_VALUE" ] || [ -z "$SUPABASE_API_KEY_VALUE" ]; then
    echo "- warning: SUPABASE_URL or SUPABASE_API_KEY is empty. Fill them before deploy."
  fi
fi

if [ "$DB_TYPE_VALUE" = "postgres" ]; then
  if [ -z "$POSTGRES_HOST_VALUE" ] || [ -z "$POSTGRES_DB_VALUE" ] || [ -z "$POSTGRES_USER_VALUE" ] || [ -z "$POSTGRES_PASSWORD_VALUE" ]; then
    echo "- warning: PostgreSQL connection values are incomplete. Fill them before deploy."
  fi
fi

if [ -z "$PRIVATE_KEY_BASE_64_VALUE" ]; then
  echo "- warning: PRIVATE_KEY_BASE_64 is empty. Set existing signing key before deploy."
fi
