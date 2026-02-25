# Xavia OTA — AWS 배포 완료 가이드 (fitters-log dev 기준)

업데이트 날짜: **2026-02-25**

이 문서는 fitters-log 프로젝트에 xavia-ota를 AWS에 배포한 전체 과정을 기록합니다.
prod 배포 및 GCP(Syeong) 배포 시 참고용입니다.

---

## 0. 전체 아키텍처

```
[fitters-log 모바일 앱 (Expo/RN)]
   │  expo-updates protocol
   │  GET /api/manifest (expo-runtime-version 헤더로 버전 구분)
   ▼
[EC2 — xavia-ota] ota-dev.fitters-log.com
   ├── nginx (TLS + reverse proxy, port 443 → 3000)
   ├── Next.js standalone (systemd, port 3000)
   ├── S3 bucket (fitters-log-ota-assets-dev, OTA 번들 저장)
   └── Supabase (releases + releases_tracking 테이블)

[관리자]
   ├── 브라우저: https://ota-dev.fitters-log.com (로그인 → 대시보드)
   └── CLI: ./scripts/publish-ota.sh dev (OTA 번들 업로드)
```

### 엔드포인트

| 환경 | OTA 서버 | API 서버 | CDN |
|------|---------|---------|-----|
| Dev | `ota-dev.fitters-log.com` | `api-dev.fitters-log.com` | `files-dev.fitters-log.com` |
| Prod | `ota.fitters-log.com` | `api.fitters-log.com` | `files.fitters-log.com` |

### runtimeVersion 격리

OTA 번들은 `updates/{runtimeVersion}/{timestamp}.zip` 경로로 S3에 저장됩니다.
앱이 manifest를 요청하면 헤더의 `expo-runtime-version`에 해당하는 디렉토리에서만 최신 zip을 조회합니다.
**runtimeVersion이 다른 앱끼리는 OTA가 완전히 격리됩니다.**

---

## 1단계: Terraform 인프라 생성

### 1.1 생성한 리소스

fitters-log-infra 레포에 `modules/ota/` 모듈을 추가하여 아래 리소스를 Terraform으로 관리합니다.

| 리소스 | 이름 규칙 | dev 값 |
|--------|----------|--------|
| EC2 Instance (t4g.micro ARM) | `{name_prefix}-ota` | `fitters-log-dev-ota` |
| Elastic IP | `{name_prefix}-ota-eip` | `43.200.103.31` |
| Security Group | `{name_prefix}-ota-sg` | 80/443 공개, 22 제한 |
| IAM Role + Instance Profile | `{name_prefix}-ota-role` | S3 접근 권한 |
| Key Pair | `{name_prefix}-ota-key` | ED25519 |
| S3 Bucket | `{project}-ota-assets-{env}` | `fitters-log-ota-assets-dev` |
| Route53 A Record | `ota-dev.fitters-log.com` | → Elastic IP |

### 1.2 모듈 구조

```
fitters-log-infra/modules/ota/
├── main.tf        # SG, IAM, Key Pair, EC2, EIP, Route53
├── variables.tf   # name_prefix, vpc_id, subnet_id, ota_public_key, 등
└── outputs.tf     # public_ip, instance_id, security_group_id
```

### 1.3 root main.tf 연결

```hcl
module "s3_ota" {
  source      = "./modules/s3"
  bucket_name = "${var.project_name}-ota-assets-${var.environment}"
  name_prefix = local.name_prefix
}

module "ota" {
  source            = "./modules/ota"
  name_prefix       = local.name_prefix
  vpc_id            = module.networking.vpc_id
  subnet_id         = module.networking.public_subnet_ids[0]
  ota_public_key    = var.ota_public_key
  ssh_allowed_cidrs = var.ota_ssh_allowed_cidrs
  ota_bucket_arn    = module.s3_ota.bucket_arn
  hosted_zone_id    = var.hosted_zone_id
  domain_name       = var.ota_domain
}
```

### 1.4 TFC 변수 설정 (dev workspace)

| 변수 | 값 | HCL |
|------|---|-----|
| `ota_domain` | `ota-dev.fitters-log.com` | No |
| `ota_public_key` | `ssh-ed25519 AAAAC3Nz...` | No |
| `ota_ssh_allowed_cidrs` | `["x.x.x.x/32", ...]` | Yes |

### 1.5 EC2 주요 설정

- **AMI drift 방지**: `lifecycle { ignore_changes = [ami] }` — AMI 업데이트로 인한 인스턴스 재생성 방지
- **IMDSv2 강제**: `http_tokens = "required"` — SSRF 공격 방어
- **EBS 암호화**: `encrypted = true`
- **Public IP 미할당**: `associate_public_ip_address = false` — EIP가 담당
- **VPC 재사용**: 기존 fitters-log VPC의 public subnet에 배치

### 1.6 SSH key

프로젝트 루트에 생성, `.gitignore`에 추가:
```
fitters-log-infra/ota_key       # private key (gitignored)
fitters-log-infra/ota_key.pub   # public key (gitignored)
```

public key는 TFC 변수 `ota_public_key`로 전달 → `aws_key_pair` 리소스가 AWS에 등록.

### 1.7 Apply

```bash
git push origin dev  # TFC auto-apply
```

또는 코드 변경 없이 변수만 변경 시:
```bash
# TFC API로 run 트리거
curl -X POST "https://app.terraform.io/api/v2/runs" \
  -H "Authorization: Bearer ${TFC_TOKEN}" \
  -H "Content-Type: application/vnd.api+json" \
  -d '{"data":{"type":"runs","attributes":{"message":"description","auto-apply":true},"relationships":{"workspace":{"data":{"type":"workspaces","id":"ws-XsVKhqzP26e8A7f9"}}}}}'
```

---

## 2단계: VM 초기 설정

SSH 접속:
```bash
ssh -i ota_key ec2-user@43.200.103.31
```

### 2.1 패키지 설치

```bash
sudo dnf update -y
sudo dnf install -y nginx git jq unzip

# Node.js 18 (xavia-ota .node-version = 18.18.0)
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo dnf install -y nodejs
```

### 2.2 Swap 설정 (t4g.micro 1GB RAM, 빌드 OOM 방지)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2.3 앱 디렉토리

```bash
sudo mkdir -p /opt/xavia-ota /etc/xavia-ota
sudo chown -R ec2-user:ec2-user /opt/xavia-ota
```

---

## 3단계: xavia-ota 코드 배포 + 빌드

```bash
cd /opt/xavia-ota
git clone https://github.com/<YOUR_ORG>/xavia-ota.git current
cd current
git checkout dev  # 또는 main
npm ci
npm run build
```

### 3.1 standalone 모드 static 파일 복사 (필수)

`next.config.js`에 `output: 'standalone'`이 설정되어 있어, static 파일을 수동으로 복사해야 합니다:

```bash
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
```

> 이 단계를 빠뜨리면 브라우저에서 JS/CSS가 전부 404가 됩니다.

---

## 4단계: Supabase 테이블 생성

Supabase Dashboard → SQL Editor에서 실행합니다.
기존 fitters-log Supabase 프로젝트를 재사용합니다.

```sql
CREATE TABLE IF NOT EXISTS releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_version VARCHAR(255) NOT NULL,
  path VARCHAR(255) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  commit_hash VARCHAR(255) NOT NULL,
  commit_message VARCHAR(255) NOT NULL,
  update_id VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS releases_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id UUID NOT NULL REFERENCES releases(id),
    download_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    platform VARCHAR(50) NOT NULL,
    CONSTRAINT fk_release
        FOREIGN KEY(release_id)
        REFERENCES releases(id)
        ON DELETE CASCADE
);

CREATE INDEX idx_tracking_release_id ON releases_tracking(release_id);
CREATE INDEX idx_tracking_platform ON releases_tracking(platform);
```

---

## 5단계: 환경 파일 배포

### 5.1 `.env.aws.dev` 구성

xavia-ota 레포의 `.env.aws.dev`:

```env
HOST=https://ota-dev.fitters-log.com
NODE_ENV=production
PORT=3000

# Storage (IAM Role 사용, static key 불필요)
BLOB_STORAGE_TYPE=s3
S3_REGION=ap-northeast-2
S3_BUCKET_NAME=fitters-log-ota-assets-dev

# Database (기존 Supabase 프로젝트 재사용)
DB_TYPE=supabase
SUPABASE_URL=https://<project-id>.supabase.co
SUPABASE_API_KEY=<service_role key>  # 반드시 service_role (RLS bypass)

# Auth
ADMIN_PASSWORD=<openssl rand -hex 24>
ADMIN_SESSION_SECRET=<openssl rand -hex 64>
ADMIN_SESSION_MAX_AGE_SECONDS=43200
UPLOAD_KEY=<openssl rand -hex 32>
PRIVATE_KEY_BASE_64=<base64 encoded RSA private key>
```

**주의사항:**
- `SUPABASE_API_KEY`는 **반드시 `service_role` key** 사용 (anon key는 RLS에 걸림)
- `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`는 비워둠 (EC2 IAM Role이 자동 처리)
- `PRIVATE_KEY_BASE_64`는 code-signing 개인키의 base64 인코딩

### 5.2 VM에 배포

```bash
# 로컬에서 실행
scp -i /path/to/ota_key .env.aws.dev ec2-user@43.200.103.31:/tmp/ota.env
ssh -i /path/to/ota_key ec2-user@43.200.103.31 \
  "sudo install -m 600 /tmp/ota.env /etc/xavia-ota/ota.env && rm -f /tmp/ota.env"
```

---

## 6단계: systemd 서비스 등록

```bash
# 서비스 파일 생성
cat << 'UNIT' | ssh -i /path/to/ota_key ec2-user@43.200.103.31 \
  "sudo tee /etc/systemd/system/xavia-ota.service > /dev/null"
[Unit]
Description=Xavia OTA Service (fitters-log)
After=network.target

[Service]
Type=simple
User=ec2-user
Group=ec2-user
WorkingDirectory=/opt/xavia-ota/current
EnvironmentFile=/etc/xavia-ota/ota.env
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

# 시작
ssh -i /path/to/ota_key ec2-user@43.200.103.31 \
  "sudo systemctl daemon-reload && sudo systemctl enable --now xavia-ota"
```

**중요:** `ExecStart`는 `node .next/standalone/server.js`입니다.
`npm run start` (= `next start`)는 standalone 모드와 호환되지 않습니다.

---

## 7단계: nginx reverse proxy

```bash
cat << 'NGINX' | ssh -i /path/to/ota_key ec2-user@43.200.103.31 \
  "sudo tee /etc/nginx/conf.d/xavia-ota.conf > /dev/null"
server {
  listen 80;
  server_name ota-dev.fitters-log.com;

  location ^~ /.well-known/acme-challenge/ {
    root /usr/share/nginx/html;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 100M;
  }
}
NGINX

ssh -i /path/to/ota_key ec2-user@43.200.103.31 \
  "sudo rm -f /etc/nginx/conf.d/default.conf && sudo nginx -t && sudo systemctl enable --now nginx && sudo systemctl reload nginx"
```

---

## 8단계: TLS 인증서 (Let's Encrypt)

```bash
ssh -i /path/to/ota_key ec2-user@43.200.103.31 \
  "sudo dnf install -y python3-pip && sudo pip3 install certbot certbot-nginx"

ssh -i /path/to/ota_key ec2-user@43.200.103.31 \
  "sudo certbot --nginx -d ota-dev.fitters-log.com --non-interactive --agree-tos -m <email> --redirect"
```

### 자동 갱신 cron 설정

```bash
ssh -i /path/to/ota_key ec2-user@43.200.103.31 \
  "sudo dnf install -y cronie && sudo systemctl enable --now crond && echo '0 3 * * * root certbot renew --quiet --nginx' | sudo tee /etc/cron.d/certbot-renew && sudo chmod 644 /etc/cron.d/certbot-renew"
```

인증서는 90일(Let's Encrypt 최대)이며, 만료 30일 전 자동 갱신됩니다.

---

## 9단계: 재배포 스크립트

서버에 `/opt/xavia-ota/deploy.sh`를 생성했습니다:

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/xavia-ota/current
cd "$APP_DIR"

echo ">>> git pull"
git fetch origin && git pull --ff-only

echo ">>> npm ci"
npm ci

echo ">>> build"
npm run build

echo ">>> copy static + public to standalone"
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public

echo ">>> restart service"
sudo systemctl restart xavia-ota
sleep 2

echo ">>> status"
sudo systemctl status xavia-ota --no-pager | head -5
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/
echo ">>> deploy complete"
```

사용:
```bash
ssh -i /path/to/ota_key ec2-user@43.200.103.31 "/opt/xavia-ota/deploy.sh"
```

---

## 10단계: 모바일 앱 설정

### 10.1 `app.json` → `app.config.ts` 전환

`app.config.ts`에서 `EXPO_PUBLIC_APP_ENV` 환경변수로 모든 환경을 동적 분기합니다:

```ts
const APP_ENV = (process.env.EXPO_PUBLIC_APP_ENV ?? 'dev') as 'dev' | 'prod'

const OTA_URLS: Record<string, string> = {
  dev: 'https://ota-dev.fitters-log.com/api/manifest',
  prod: 'https://ota.fitters-log.com/api/manifest',
}

export default ({ config }) => ({
  ...config,
  name: APP_ENV === 'dev' ? 'Fitters Log (Dev)' : 'Fitters Log',
  runtimeVersion: '1.0.0',
  updates: {
    url: OTA_URLS[APP_ENV],
    codeSigningCertificate: './certs/certificate.pem',
    codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
  },
  // ... 나머지 config
})
```

`app.json`은 최소 stub만 유지:
```json
{ "expo": { "name": "Fitters Log", "slug": "fitters-log" } }
```

### 10.2 `eas.json` 생성

```json
{
  "cli": { "version": ">= 15.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "channel": "dev",
      "env": { "EXPO_PUBLIC_APP_ENV": "dev" }
    },
    "production": {
      "channel": "prod",
      "env": { "EXPO_PUBLIC_APP_ENV": "prod" }
    }
  },
  "submit": { "production": {} }
}
```

### 10.3 API/CDN URL 분기

`src/config.ts`에서 `EXPO_PUBLIC_APP_ENV`로 이미 분기됨:

```ts
const ENVIRONMENT_URLS = {
  dev:  { serverUrl: 'https://api-dev.fitters-log.com', cdnUrl: 'https://files-dev.fitters-log.com' },
  prod: { serverUrl: 'https://api.fitters-log.com',     cdnUrl: 'https://files.fitters-log.com' },
}
```

### 10.4 Code-signing 키 쌍

```
fitters-log-app/
├── certs/
│   └── certificate.pem   ← git tracked (공개키, 앱에 포함)
└── keys/
    └── private-key.pem   ← gitignored (비밀키, 로컬/서버만)
```

certificate는 기존 `.env.aws.dev`의 `PRIVATE_KEY_BASE_64`에서 파생:
```bash
# private key 디코딩
echo $PRIVATE_KEY_BASE_64 | base64 -d > keys/private-key.pem

# certificate 생성 (10년 유효)
openssl req -new -x509 -key keys/private-key.pem \
  -out certs/certificate.pem -days 3650 -subj "/CN=fitters-log OTA"
```

### 10.5 package.json 스크립트

```json
"start:dev": "EXPO_PUBLIC_APP_ENV=dev expo start --clear",
"start:prod": "EXPO_PUBLIC_APP_ENV=prod expo start --clear"
```

### 10.6 검증

```bash
# dev config 확인
EXPO_PUBLIC_APP_ENV=dev npx expo config --json | jq '{name, runtimeVersion, updates}'
# → name: "Fitters Log (Dev)", url: "https://ota-dev.fitters-log.com/api/manifest"

# prod config 확인
EXPO_PUBLIC_APP_ENV=prod npx expo config --json | jq '{name, runtimeVersion, updates}'
# → name: "Fitters Log", url: "https://ota.fitters-log.com/api/manifest"
```

---

## 11단계: OTA 번들 배포

### 11.1 배포 스크립트

`scripts/publish-ota.sh dev|prod`:
- `EXPO_PUBLIC_APP_ENV`을 설정하여 `npx expo export` 실행
- `runtimeVersion`을 `app.config.ts`에서 자동 추출
- zip 압축 후 `POST /api/upload`로 업로드

### 11.2 사용법

```bash
export OTA_UPLOAD_KEY_DEV=<.env.aws.dev의 UPLOAD_KEY>
./scripts/publish-ota.sh dev
```

### 11.3 확인

- 브라우저: `https://ota-dev.fitters-log.com` → 로그인 → Releases 탭에서 확인
- CLI:
  ```bash
  curl -c /tmp/c.txt -X POST "https://ota-dev.fitters-log.com/api/login" \
    -H "Content-Type: application/json" -d '{"password":"<ADMIN_PASSWORD>"}'
  curl -b /tmp/c.txt "https://ota-dev.fitters-log.com/api/releases" | jq
  ```

---

## 동작 검증 체크리스트

| # | 테스트 | 기대 결과 | 명령 |
|---|--------|----------|------|
| 1 | HTTPS 접근 | 200 | `curl -s -o /dev/null -w '%{http_code}' https://ota-dev.fitters-log.com/` |
| 2 | Manifest (릴리스 없음) | 500 또는 NoUpdate | `curl -H "expo-protocol-version: 1" -H "expo-platform: ios" -H "expo-runtime-version: 1.0.0" https://ota-dev.fitters-log.com/api/manifest` |
| 3 | 인증 필요 | 401 | `curl -s -o /dev/null -w '%{http_code}' https://ota-dev.fitters-log.com/api/releases` |
| 4 | 로그인 | 200 | POST `/api/login` |
| 5 | 인증 후 releases | 200 | GET `/api/releases` with cookie |
| 6 | S3 접근 (VM) | 성공 | `aws s3 ls s3://fitters-log-ota-assets-dev/` |

---

## 장애 대응

```bash
SSH="ssh -i /path/to/ota_key ec2-user@43.200.103.31"

$SSH "sudo systemctl status xavia-ota --no-pager"        # 서비스 상태
$SSH "sudo journalctl -u xavia-ota -n 200 --no-pager"    # 앱 로그
$SSH "sudo tail -50 /var/log/nginx/error.log"             # nginx 로그
$SSH "ss -tlnp | grep 3000"                               # 포트 리슨
$SSH "df -h && free -m"                                   # 디스크/메모리
$SSH "aws s3 ls s3://fitters-log-ota-assets-dev/"         # S3 접근
```

---

## prod 배포 시 차이점

| 항목 | Dev | Prod |
|------|-----|------|
| TFC workspace | `fitters-log-infra-dev` | `fitters-log-infra-prod` |
| EC2 Name | `fitters-log-dev-ota` | `fitters-log-prod-ota` |
| S3 Bucket | `fitters-log-ota-assets-dev` | `fitters-log-ota-assets-prod` |
| Domain | `ota-dev.fitters-log.com` | `ota.fitters-log.com` |
| Env 파일 | `.env.aws.dev` | `.env.aws.prod` |
| Supabase | dev 프로젝트 | prod 프로젝트 |
| EAS channel | `dev` | `prod` |
| Certbot 도메인 | `ota-dev.fitters-log.com` | `ota.fitters-log.com` |

prod는 동일한 Terraform 코드가 TFC prod workspace에서 실행됩니다.
`ota_domain`, `ota_public_key`, `ota_ssh_allowed_cidrs` 변수만 prod workspace에 설정하면 됩니다.

---

## GCP(Syeong) 배포 시 참고

주요 차이:
- EC2 → **Compute Engine** (e2-micro)
- Elastic IP → **Static External IP**
- Security Group → **VPC Firewall Rules**
- IAM Role → **Service Account + roles/storage.objectAdmin**
- S3 → **GCS Bucket** (BLOB_STORAGE_TYPE=gcs)
- Route53 → **Cloud DNS**
- Terraform Cloud → **별도 GCP Terraform** 또는 수동
- Supabase → 동일 (또는 Cloud SQL PostgreSQL)

VM 설정(Node.js, nginx, certbot, systemd)은 동일합니다.
`.env.gcp.dev`에서 `BLOB_STORAGE_TYPE=gcs`, `DB_TYPE=postgres`로 변경하면 됩니다.

---

## 보안 체크리스트

- [x] `.env.*` 파일 git 미추적 (`.gitignore`에 `.env*`)
- [x] SSH key (`ota_key`, `ota_key.pub`) git 미추적
- [x] OTA private key (`keys/private-key.pem`) git 미추적
- [x] OTA certificate (`certs/certificate.pem`) git 추적 (공개키)
- [x] S3 public access 전체 차단
- [x] S3 AES256 암호화 + 버저닝
- [x] EC2 IMDSv2 강제 (SSRF 방어)
- [x] EC2 EBS 암호화
- [x] SSH 접근 IP 제한 (Security Group)
- [x] Supabase service_role key 사용 (RLS bypass)
- [x] ADMIN_PASSWORD, UPLOAD_KEY, SESSION_SECRET 강도 확인
- [x] Next.js 15.5.7 — CVE-2025-29927, CVE-2025-66478, CVE-2025-55184 모두 해당 없음 (Pages Router, Middleware 미사용)
- [x] TLS 자동 갱신 cron 설정

---

## 파일 참조

| 파일 | 위치 | 용도 |
|------|------|------|
| OTA Terraform 모듈 | `fitters-log-infra/modules/ota/` | EC2, EIP, SG, IAM, DNS |
| SSH key | `fitters-log-infra/ota_key` | EC2 SSH 접근 (gitignored) |
| env 파일 | `xavia-ota/.env.aws.dev` | OTA 서버 런타임 설정 (gitignored) |
| 재배포 스크립트 | VM `/opt/xavia-ota/deploy.sh` | git pull → build → restart |
| OTA 배포 스크립트 | `fitters-log-app/scripts/publish-ota.sh` | expo export → upload |
| 앱 config | `fitters-log-app/app.config.ts` | OTA URL, code-signing 설정 |
| EAS config | `fitters-log-app/eas.json` | build profile별 환경변수 |
| Code-signing cert | `fitters-log-app/certs/certificate.pem` | 공개키 (git tracked) |
| Code-signing key | `fitters-log-app/keys/private-key.pem` | 비밀키 (gitignored) |
