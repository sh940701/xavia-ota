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
- `HOST` - Server URL
- `BLOB_STORAGE_TYPE` - `local` | `supabase` | `gcs` | `s3`
- `DB_TYPE` - `postgres` | `supabase`
- `ADMIN_PASSWORD` - Dashboard login password
- `UPLOAD_KEY` - Required in upload requests for auth
- `PRIVATE_KEY_BASE_64` - RSA private key for manifest code signing
- `POSTGRES_*` - Database connection (USER, PASSWORD, DB, HOST, PORT)

## Testing

Jest 27 with `next/jest`. Test files in `__tests__/`. Environment setup in `.jest/setEnvVars.js` sets HOSTNAME, DB_TYPE=postgres, UPLOAD_KEY. Tests mock the helper/storage/database layers.

## Docker

- **Dev DB**: `containers/database/docker-compose.yml` - PostgreSQL 14 with schema auto-init
- **Production**: `containers/prod/docker-compose.yml` - Uses `xaviaio/xavia-ota` image on port 3000
- **Dockerfile**: Multi-stage Node 18-alpine build with standalone output

## Conventions

- UI uses Chakra UI v2 + Tailwind CSS (custom primary color `#5655D7`)
- Logging via Winston (`apiUtils/logger.ts`) with module-name prefixing
- Factory pattern for pluggable storage/database backends - add new implementations by implementing the interface and updating the factory
- Next.js Pages Router (not App Router)