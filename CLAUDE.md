# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Xavia OTA is a self-hosted Over-The-Air updates server for Expo/React Native apps. It implements the expo-updates protocol, serving update manifests and assets to mobile clients. Built with Next.js 15+ and TypeScript.

## Development Commands

```bash
npm run dev          # Start dev server (spins up Postgres via Docker, runs on port 3001)
npm run build        # Next.js production build
npm run start        # Production server
npm run lint         # ESLint on apiUtils/ and pages/
npm run test         # Jest tests (all)
npx jest __tests__/<file>.test.ts  # Run a single test file
```

Development requires Docker running (for the PostgreSQL container). The `npm run dev` command uses `scripts/dev/Makefile` which starts a Postgres container and waits for it to be healthy before launching Next.js.

## Architecture

### API Routes (`pages/api/`)

| Route | Purpose |
|-------|---------|
| `manifest` | Core endpoint - serves expo-updates protocol manifests with code signing |
| `assets` | Serves individual assets extracted from update zip bundles |
| `upload` | Receives new update bundles (protected by UPLOAD_KEY) |
| `releases` | Lists all releases with metadata |
| `rollback` | Creates rollback by copying a previous release with new timestamp |
| `login` | Password auth against ADMIN_PASSWORD env var |
| `tracking/all` | Aggregated download metrics |
| `tracking/[release_id]` | Per-release download metrics |

### Core Abstractions (`apiUtils/`)

**Database layer** (`apiUtils/database/`): `DatabaseInterface` with implementations selected by `DB_TYPE` env var via `DatabaseFactory` (singleton). Currently supports PostgreSQL (`LocalDatabase.ts`) and Supabase (`SupabaseDatabase.ts`).

**Storage layer** (`apiUtils/storage/`): `StorageInterface` with implementations selected by `BLOB_STORAGE_TYPE` env var via `StorageFactory`. Supports: `local` (filesystem), `supabase`, `gcs` (Google Cloud Storage), `s3` (AWS S3-compatible).

**Helpers** (`apiUtils/helpers/`):
- `UpdateHelper` - Resolves latest update paths, builds manifests, handles rollback/no-update directives
- `ZipHelper` - Caches and extracts zip files (5-min TTL cache)
- `ConfigHelper` - Extracts expo config from zip bundles
- `HashHelper` - SHA256/MD5 hashing, RSA-SHA256 signing, UUID conversion
- `DictionaryHelper` - Structured headers dictionary conversion

### Frontend (`pages/` + `components/`)

- `/` - Login page (password checked against ADMIN_PASSWORD env var)
- `/dashboard` - Metrics cards (total releases, downloads by platform)
- `/releases` - Release table with rollback actions

Auth is client-side only: `localStorage.isAuthenticated` checked by `ProtectedRoute` component.

### Database Schema

Two tables in PostgreSQL (`containers/database/schema/`):
- `releases` - id (UUID), runtime_version, path, timestamp, commit_hash, commit_message, update_id
- `releases_tracking` - id (UUID), release_id (FK), download_timestamp, platform

### Update Flow

1. Client sends GET to `/api/manifest` with runtime version, platform, and protocol version headers
2. Server finds latest release zip in `updates/{runtimeVersion}/` storage directory
3. Extracts `metadata.json` from zip, builds manifest with signed asset URLs
4. Client fetches assets from `/api/assets`
5. Downloads tracked in `releases_tracking` table

## Environment Variables

Key env vars (see `.env.example.local` for full list):
- `HOST` - Server URL (prod: `https://ota.fitters-log.com`)
- `PORT` - Internal listen port (prod container: `3000`, mapped to host `3001` in the MIG)
- `BLOB_STORAGE_TYPE` - `local` | `supabase` | `gcs` | `s3` (prod: `gcs`)
- `DB_TYPE` - `postgres` | `supabase` (prod: `supabase`)
- `GCP_BUCKET_NAME` - GCS bucket name (required when `BLOB_STORAGE_TYPE=gcs`)
- `SUPABASE_URL` / `SUPABASE_API_KEY` - Supabase connection (required when `DB_TYPE=supabase`)
- `ADMIN_PASSWORD` - Dashboard login password
- `UPLOAD_KEY` - Required in upload requests for auth
- `PRIVATE_KEY_BASE_64` - RSA private key for manifest code signing
- `POSTGRES_*` - PostgreSQL connection (USER, PASSWORD, DB, HOST, PORT) — only when `DB_TYPE=postgres` (e.g. local dev)

> For the fitters-log production deployment, these are set by the GCP MIG cloud-init + Secret Manager — see "Deployment (fitters-log / GCP)".

## Testing

Jest 27 with `next/jest`. Test files in `__tests__/`. Environment setup in `.jest/setEnvVars.js` sets HOSTNAME, DB_TYPE=postgres, UPLOAD_KEY. Tests mock the helper/storage/database layers.

## Docker

- **Dev DB**: `containers/database/docker-compose.yml` - PostgreSQL 14 with schema auto-init
- **Dockerfile**: Multi-stage Node 18-alpine build with standalone output; container listens on internal port 3000 (`EXPOSE 3000`, `CMD ["node", "server.js"]`)
- **Upstream reference only**: `containers/prod/docker-compose.yml` uses the upstream `xaviaio/xavia-ota` image on port 3000. fitters-log does NOT use this compose file — see "Deployment (fitters-log / GCP)" below for the live deployment.

## Deployment (fitters-log / GCP)

> **Source of truth for the deployed config: `fitters-log-infra-gcp/modules/mig/cloud-init.yaml.tftpl`.** AWS is fully decommissioned (the `docs/aws-deployment-guide.md` and `docs/XAVIA_OTA_COMPUTE_SETUP*.md` guides are archived under `docs/archive/`).

- **Image build**: `cloudbuild.yaml` builds `linux/amd64` and pushes to Artifact Registry `asia-northeast3-docker.pkg.dev/syeong-root/fitters-log-containers/ota:{SHORT_SHA,latest}` (region `asia-northeast3`).
- **Manual deploy only**: there is **no Cloud Build trigger** for this repo (the api/landing/admin repos auto-deploy on push to `main`; OTA does not). Build and ship with `gcloud builds submit --config=cloudbuild.yaml .`. The build's `roll-mig` step rolling-replaces the `fitters-log-api-mig` MIG (`--max-surge=1 --max-unavailable=0`) and `wait-stable` blocks until the MIG is healthy.
- **Runtime host**: the OTA container runs **inside the shared `fitters-log-api-mig` MIG VM** (the same VM as the Go API), launched by the VM's cloud-init systemd unit `fitters-log-ota.service`. No SSH, no EC2. Port mapping is `-p 3001:3000`: container listens on internal `3000`, exposed on **host port 3001** (the Go API takes host port 3000).
- **Runtime env (set by cloud-init)**: `BLOB_STORAGE_TYPE=gcs`, `DB_TYPE=supabase`, `PORT=3000`, `GCP_BUCKET_NAME=<ota-assets bucket>`, `HOST=https://ota.fitters-log.com`. Secrets are mounted from GCP Secret Manager: `ota-upload-key` (`UPLOAD_KEY`), `ota-private-key-base64` (`PRIVATE_KEY_BASE_64`), `ota-admin-password` (`ADMIN_PASSWORD`), `ota-admin-session-secret` (`ADMIN_SESSION_SECRET`), `ota-supabase-url` (`SUPABASE_URL`), `ota-supabase-api-key` (`SUPABASE_API_KEY`).
- **Health check**: the GCP MIG/LB health check hits `GET /api/health` (see `pages/api/health.ts`) on **host port 3001** and expects a `2xx` with no storage/DB dependency.
- **Storage backend**: GCS via `apiUtils/storage/GCSStorage.ts`, which requires `GCP_BUCKET_NAME`. **Database backend**: Supabase via `apiUtils/database/SupabaseDatabase.ts` (`SUPABASE_URL` + `SUPABASE_API_KEY`).
- **`dev` tier decommissioned**: only `prod` exists. `ota-dev.fitters-log.com` and the `.env.aws.*`/`.env.gcp.dev` files are dead.
- **Publishing OTA updates** (from `fitters-log-app`): `./scripts/publish-ota.sh` HTTPS-POSTs the bundle to `/api/upload`, authenticated by `UPLOAD_KEY` (must match the `ota-upload-key` secret). DB caps `commit_message` at `varchar(255)`.

## Conventions

- UI uses Chakra UI v2 + Tailwind CSS (custom primary color `#5655D7`)
- Logging via Winston (`apiUtils/logger.ts`) with module-name prefixing
- Factory pattern for pluggable storage/database backends - add new implementations by implementing the interface and updating the factory
- Next.js Pages Router (not App Router)