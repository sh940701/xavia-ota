# Xavia OTA Compute Engine 수동 배포 가이드 (.env.gcp / .env.aws 기준)

업데이트 날짜: **2026-02-24**

이 문서는 아래 운영 원칙으로 작성했습니다.

1. **인프라 레이어(Terraform)**: 고정 IP, DNS, Compute Engine, PostgreSQL DB/User, Bucket 생성만 담당
2. **애플리케이션 설정 레이어(.env)**: `xavia-ota` 런타임 값은 로컬 `.env.gcp`/`.env.aws`에서 관리
3. **배포 방식**: Cloud Build 없이 SSH 수동 배포
4. **DB 정책**: 기존 DB 백엔드 재사용 (PostgreSQL 또는 Supabase), 신규 데이터베이스 인프라 생성 최소화
5. **보안 정책**: 관리자 인증은 `xavia-ota` 서버측 auth(쿠키 세션) 사용, nginx Basic Auth 의존 제거

---

## 0. 핵심 결론

질문 주신 내용이 맞습니다.

- 기존 문서가 GCP/terraform 주입 중심으로 너무 기울어져 있었고,
- 현재 합의된 운영 방식은 **`.env.gcp` / `.env.aws` 중심**입니다.

따라서 이제 표준은 아래입니다.

- Terraform은 인프라만 만듭니다.
- 앱 비밀값은 Terraform variable/metadata/startup script로 주입하지 않습니다.
- 앱 실행은 `/etc/xavia-ota/ota.env` 1개 파일을 기준으로 합니다.
- `ota.env`는 로컬 `.env.gcp` 또는 `.env.aws`에서 만들어 VM으로 전달합니다.

---

## 1. 아키텍처(최종)

1. React Native 앱
- `updates.url = https://<OTA_DOMAIN>/api/manifest`
- OTA manifest/assets 조회

2. OTA 서버(Compute Engine)
- `xavia-ota` Next.js 앱 (`systemd`로 실행)
- nginx는 reverse proxy + TLS 담당

3. 데이터 계층
- DB: PostgreSQL 또는 Supabase DB 사용 가능
- Storage: GCS, S3, Supabase Storage 조합 가능

4. 인증
- `POST /api/login` -> `HttpOnly` 세션 쿠키 발급
- `/api/releases`, `/api/rollback`, `/api/tracking/*`, `/dashboard`, `/releases` 서버측 인증
- `/api/manifest`, `/api/assets`, `/api/upload` 공개 (단, `/api/upload`은 `UPLOAD_KEY` 필요)

---

## 2. 클라우드 중립 ENV 계약

아래 키 이름을 고정하면, 같은 코드로 GCP/AWS 모두 동작합니다.

## 2.1 공통 필수

```env
HOST=https://ota-dev.example.com
NODE_ENV=production
PORT=3000

BLOB_STORAGE_TYPE=
DB_TYPE=

ADMIN_PASSWORD=
ADMIN_SESSION_SECRET=
ADMIN_SESSION_MAX_AGE_SECONDS=43200
UPLOAD_KEY=
PRIVATE_KEY_BASE_64=
```

## 2.2 `DB_TYPE=postgres`일 때

```env
POSTGRES_HOST=
POSTGRES_PORT=5432
POSTGRES_DB=
POSTGRES_USER=
POSTGRES_PASSWORD=
```

## 2.3 `DB_TYPE=supabase`일 때

```env
SUPABASE_URL=
SUPABASE_API_KEY=
```

## 2.4 `BLOB_STORAGE_TYPE`별 추가 키

`gcs`:

```env
GCP_BUCKET_NAME=
```

`s3`:

```env
S3_REGION=
S3_ENDPOINT=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=
```

`supabase`:

```env
SUPABASE_BUCKET_NAME=expo-updates
```

## 2.5 조합 예시

1. GCP 기본형: `DB_TYPE=postgres` + `BLOB_STORAGE_TYPE=gcs`
2. AWS 기본형: `DB_TYPE=postgres` + `BLOB_STORAGE_TYPE=s3`
3. AWS + Supabase: `DB_TYPE=supabase` + `BLOB_STORAGE_TYPE=supabase`
4. 혼합형: `DB_TYPE=supabase` + `BLOB_STORAGE_TYPE=s3` (또는 반대)

---

## 3. `.env.gcp` / `.env.aws` 운영 규칙

1. 저장소에는 실파일 미커밋
- `.env.gcp`, `.env.aws`는 절대 커밋 금지

2. 예시 파일만 커밋
- `.env.gcp.example`, `.env.aws.example`만 커밋

3. 런타임은 단일 파일
- VM에는 최종적으로 `/etc/xavia-ota/ota.env`만 존재

4. 벤더 의존은 로컬 오퍼레이션에서만
- 필요하면 로컬에서만 `gcloud`/`aws`로 값 조회
- VM 실행 스크립트에서는 벤더 CLI 호출 금지

---

## 4. GCP 인프라(Terraform) 예시에서 해야 할 일

작업 경로:
- `/Users/sunghyun/WebstormProjects/syeong-infra-gcp`

주의:
- AWS + Supabase 조합이면 이 절의 `GCS bucket`, `Cloud SQL(PostgreSQL)` 생성 단계는 생략하고,
  VM/고정 IP/DNS/보안그룹(방화벽)만 동일하게 적용하면 됩니다.

Terraform이 담당할 항목(권장):

1. Compute Engine VM (e2-micro 시작)
2. Static External IP + DNS A Record
3. Firewall
- 80/443: `0.0.0.0/0`
- 22: 운영자 고정 IP/VPN 대역만 허용
4. PostgreSQL 리소스 (GCP 예시에서는 Cloud SQL)
- OTA 전용 DB 1개
- OTA 전용 DB User 1개
- 기존 PostgreSQL 인스턴스는 그대로 사용
5. GCS bucket (GCP 배포 시)

Terraform에서 하지 않을 항목:

1. `ADMIN_PASSWORD`, `UPLOAD_KEY`, `PRIVATE_KEY_BASE_64`, `POSTGRES_PASSWORD` 주입
2. startup script로 앱 실운영 비밀값 작성
3. cloud provider 비밀값을 앱 코드 실행 경로에 하드코딩

---

## 5. VM 초기 설정

```bash
ssh debian@<OTA_STATIC_IP>

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx git jq unzip

# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

sudo mkdir -p /opt/xavia-ota /etc/xavia-ota
sudo chown -R debian:debian /opt/xavia-ota
```

`e2-micro` 빌드 OOM 대비(권장):

```bash
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi
```

---

## 6. xavia-ota 코드 배포

```bash
cd /opt/xavia-ota
git clone https://github.com/<YOUR_ORG>/xavia-ota.git current
cd current
git checkout main
npm ci
npm run build
```

---

## 7. `.env.gcp` 또는 `.env.aws` 작성 (로컬)

## 7.1 `.env.gcp` 예시

```env
HOST=https://ota-dev.syeong.com
NODE_ENV=production
PORT=3000

BLOB_STORAGE_TYPE=gcs
DB_TYPE=postgres
GCP_BUCKET_NAME=syeong-xavia-ota-assets-dev

POSTGRES_HOST=10.190.0.5
POSTGRES_PORT=5432
POSTGRES_DB=syeong_xavia_ota_dev
POSTGRES_USER=syeong_ota_dev
POSTGRES_PASSWORD=<DB_PASSWORD>

ADMIN_PASSWORD=<ADMIN_PASSWORD>
ADMIN_SESSION_SECRET=<LONG_RANDOM_SECRET>
ADMIN_SESSION_MAX_AGE_SECONDS=43200
UPLOAD_KEY=<UPLOAD_KEY>
PRIVATE_KEY_BASE_64=<PRIVATE_KEY_BASE64>
```

## 7.2 `.env.aws` 예시 (Supabase 조합)

```env
HOST=https://ota-dev.example.com
NODE_ENV=production
PORT=3000

BLOB_STORAGE_TYPE=supabase
DB_TYPE=supabase

SUPABASE_URL=
SUPABASE_API_KEY=
SUPABASE_BUCKET_NAME=expo-updates

ADMIN_PASSWORD=
ADMIN_SESSION_SECRET=
ADMIN_SESSION_MAX_AGE_SECONDS=43200
UPLOAD_KEY=
PRIVATE_KEY_BASE_64=
```

`AWS + S3 + PostgreSQL`를 쓰는 경우는 `.env.aws.example`의 주석 블록(Alternative profile)을 사용하면 됩니다.

---

## 8. 로컬 `.env.*` -> VM `ota.env` 반영

가장 안전한 방식은 **파일 자체를 전송**하는 것입니다.

GCP 환경 파일 배포:

```bash
scp ./.env.gcp debian@<OTA_STATIC_IP>:/tmp/ota.env
ssh debian@<OTA_STATIC_IP> "sudo install -m 600 /tmp/ota.env /etc/xavia-ota/ota.env && rm -f /tmp/ota.env"
```

AWS 환경 파일 배포:

```bash
scp ./.env.aws debian@<OTA_STATIC_IP>:/tmp/ota.env
ssh debian@<OTA_STATIC_IP> "sudo install -m 600 /tmp/ota.env /etc/xavia-ota/ota.env && rm -f /tmp/ota.env"
```

검증:

```bash
ssh debian@<OTA_STATIC_IP> "sudo ls -l /etc/xavia-ota/ota.env && sudo sed -n '1,40p' /etc/xavia-ota/ota.env"
```

---

## 9. systemd 서비스 등록

```bash
ssh debian@<OTA_STATIC_IP> <<'EOF'
set -euo pipefail
sudo tee /etc/systemd/system/xavia-ota.service >/dev/null <<'UNIT'
[Unit]
Description=Xavia OTA Service
After=network.target

[Service]
Type=simple
User=debian
Group=debian
WorkingDirectory=/opt/xavia-ota/current
EnvironmentFile=/etc/xavia-ota/ota.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now xavia-ota
sudo systemctl status xavia-ota --no-pager
EOF
```

---

## 10. nginx + TLS (인증은 앱에서 처리)

nginx 역할:
- TLS 종단
- reverse proxy

nginx 비역할:
- 관리자 인증의 1차 방어선(앱 서버가 1차)

```bash
ssh debian@<OTA_STATIC_IP> <<'EOF'
set -euo pipefail
sudo tee /etc/nginx/sites-available/xavia-ota.conf >/dev/null <<'NGINX'
server {
  listen 80;
  server_name ota-dev.syeong.com;

  location ^~ /.well-known/acme-challenge/ {
    root /var/www/html;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
NGINX

sudo ln -sfn /etc/nginx/sites-available/xavia-ota.conf /etc/nginx/sites-enabled/xavia-ota.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
EOF
```

TLS 인증서:

```bash
ssh debian@<OTA_STATIC_IP> "sudo certbot --nginx -d ota-dev.syeong.com --non-interactive --agree-tos -m team@syeong.com --redirect"
```

---

## 11. 동작 검증

## 11.1 OTA 공개 endpoint

```bash
curl -i "https://ota-dev.syeong.com/api/manifest" \
  -H "expo-protocol-version: 1" \
  -H "expo-platform: ios" \
  -H "expo-runtime-version: 1.0.0"
```

기대:
- `200` 또는 no-update 응답

## 11.2 관리자 보호 endpoint

```bash
curl -i "https://ota-dev.syeong.com/api/releases"
```

기대:
- `401 Unauthorized`

## 11.3 로그인 후 관리자 API

```bash
# 로그인(쿠키 저장)
curl -i -c cookie.txt -X POST "https://ota-dev.syeong.com/api/login" \
  -H "Content-Type: application/json" \
  -d '{"password":"<ADMIN_PASSWORD>"}'

# 관리자 API 접근
curl -i -b cookie.txt "https://ota-dev.syeong.com/api/releases"
```

기대:
- 첫 호출 `200`
- 두 번째 호출 `200`

---

## 12. OTA 앱 번들 배포 (앱 레포 로컬에서 실행)

```bash
./scripts/build-and-publish-app-release.sh <runtimeVersion> https://ota-dev.syeong.com <UPLOAD_KEY>
```

예시:

```bash
./scripts/build-and-publish-app-release.sh 2.4.1 https://ota-dev.syeong.com <UPLOAD_KEY>
```

---

## 13. 서버 재배포(runbook)

```bash
ssh debian@<OTA_STATIC_IP> <<'EOF'
set -euo pipefail
cd /opt/xavia-ota/current
git fetch origin
git checkout main
git pull --ff-only origin main
npm ci
npm run build
sudo systemctl restart xavia-ota
sudo systemctl status xavia-ota --no-pager
EOF
```

---

## 14. 운영 체크리스트

1. `.env.gcp/.env.aws` 실파일 커밋 금지 확인
2. `ADMIN_SESSION_SECRET` 강도 확인 (긴 랜덤 문자열)
3. SSH 방화벽 CIDR 최소화
4. 사용하는 DB 백엔드(PostgreSQL/Supabase) 기준으로 권한 최소화 원칙 적용
5. 장애 시 우선 확인
- `sudo systemctl status xavia-ota`
- `sudo journalctl -u xavia-ota -n 200 --no-pager`

---

## 15. 참고

Google Cloud
- Static IP: https://cloud.google.com/compute/docs/ip-addresses/reserve-static-external-ip-address
- Cloud SQL private IP: https://cloud.google.com/sql/docs/postgres/private-ip
- Cloud DNS record: https://cloud.google.com/dns/docs/records

Expo
- Custom updates server: https://docs.expo.dev/distribution/custom-updates-server/
- Updates protocol: https://docs.expo.dev/technical-specs/expo-updates-1/

Xavia OTA
- https://github.com/xavia-io/xavia-ota
- https://github.com/xavia-io/xavia-ota/blob/main/docs/supportedStorageAlternatives.md
