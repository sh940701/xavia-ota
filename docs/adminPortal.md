# Admin Portal Documentation

The admin portal provides a web interface for managing your OTA updates.

## Dashboard Overview

![Dashboard Overview](./images/dashboard-page.png)

The main dashboard provides:

- Total number of releases
- Total number of downloads for all platforms
- Total number of downloads by platform

## Publishing and Rolling Back Updates

![Releases Page](./images/releases-page.png)

The release page provides:

- List of all releases with metadata
- Rollback functionality to a previous release

## Security Notes

Admin authentication is now enforced on the server side with signed `HttpOnly` session cookies.

### How auth works

- `POST /api/login` verifies `ADMIN_PASSWORD` and issues `xavia_admin_session` cookie.
- Cookie is signed with `ADMIN_SESSION_SECRET` (fallback: `ADMIN_PASSWORD`) and validated on every protected request.
- Cookie attributes: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age` from `ADMIN_SESSION_MAX_AGE_SECONDS` (default 12h).
- `POST /api/logout` clears the session cookie.

### Endpoint protection matrix

- Public OTA endpoints:
  - `GET /api/manifest`
  - `GET /api/assets`
  - `POST /api/upload` (protected by `UPLOAD_KEY`)
- Admin-protected endpoints:
  - `GET /api/releases`
  - `POST /api/rollback`
  - `GET /api/tracking/*`
- Admin UI pages (`/dashboard`, `/releases`) are server-side protected with `getServerSideProps` auth check.

### Production recommendations

- Set a strong `ADMIN_SESSION_SECRET` (required in production).
- Use HTTPS so cookie security flags are effective (`Secure` in production mode).
- If you keep a reverse proxy, it should only be an extra hardening layer, not the primary auth mechanism.
