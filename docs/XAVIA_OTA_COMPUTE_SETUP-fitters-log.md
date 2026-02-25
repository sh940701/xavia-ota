# Xavia OTA — fitters-log AWS 배포 가이드

업데이트 날짜: **2026-02-25**

이 문서는 fitters-log 프로젝트의 OTA 업데이트 서버(xavia-ota)를 AWS에 배포하기 위한 가이드입니다.

## 운영 원칙

1. **인프라 레이어**: EC2, Elastic IP, Security Group, S3 Bucket, Route53 DNS, IAM Role
2. **애플리케이션 설정 레이어**: `.env.aws.dev` / `.env.aws.prod`에서 런타임 값 관리
3. **배포 방식**: SSH 수동 배포 (초기), 향후 CodePipeline 자동화 가능
4. **DB 정책**: 기존 fitters-log Supabase 프로젝트 재사용 (신규 DB 인프라 생성 없음)
5. **Storage 정책**: S3 + IAM Role (EC2 Instance Profile 기반, static key 불필요)

---

## 0. fitters-log 기존 인프라 컨텍스트

xavia-ota를 기존 fitters-log 인프라 위에 배포합니다. 이미 있는 리소스를 최대한 활용합니다.

| 리소스 | 현재 상태 | OTA에서 재사용 여부 |
|--------|-----------|-------------------|
| Route53 Hosted Zone (`fitters-log.com`) | 운영 중 | **재사용** — A Record 추가만 |
| VPC + Public Subnets (ap-northeast-2a, 2c) | 운영 중 | **재사용** — EC2를 기존 VPC에 배치 |
| ACM 와일드카드 인증서 (`*.fitters-log.com`, us-east-1) | 운영 중 | 사용 안 함 (CloudFront 전용) |
| Supabase (DB + Auth) | 운영 중 | **재사용** — OTA 전용 테이블 추가 |
| Secrets Manager (`{name_prefix}/secrets`) | 운영 중 | 별도 생성 (OTA 전용) |
| Terraform Cloud (`fitters-log` org) | 운영 중 | 참고만 (OTA는 수동 관리) |

---

## 1. 아키텍처

```
[fitters-log 모바일 앱 (Expo/RN)]
   │
   │  expo-updates protocol
   │  GET /api/manifest, GET /api/assets
   ▼
[EC2 — xavia-ota]
   ├── nginx (reverse proxy + TLS via Certbot)
   ├── Next.js app (systemd, port 3000)
   ├── S3 bucket (OTA 번들 assets)
   └── Supabase (releases + tracking 테이블)

[관리자]
   │  POST /api/login → HttpOnly 세션 쿠키
   ├── GET /api/releases, POST /api/rollback, GET /api/tracking/*
   └── POST /api/upload (UPLOAD_KEY 인증, CI 자동화 가능)
```

### 엔드포인트 계획

| 환경 | OTA 도메인 | API 도메인 (기존) |
|------|-----------|-----------------|
| Dev | `ota-dev.fitters-log.com` | `api-dev.fitters-log.com` |
| Prod | `ota.fitters-log.com` | `api.fitters-log.com` |

이는 기존 fitters-log 도메인 네이밍 규칙(`{prefix}-dev.fitters-log.com` / `{prefix}.fitters-log.com`)을 따릅니다.

---

## 2. ENV 계약 (fitters-log 전용)

fitters-log는 **S3 + Supabase** 조합을 사용합니다.

### 2.1 공통 필수

```env
HOST=https://ota-dev.fitters-log.com
NODE_ENV=production
PORT=3000

BLOB_STORAGE_TYPE=s3
DB_TYPE=supabase
```

### 2.2 S3 설정 (IAM Role 모드)

```env
S3_REGION=ap-northeast-2
S3_BUCKET_NAME=fitters-log-ota-assets-dev
# IAM Role 사용 시 아래는 비워둠 (EC2 Instance Profile에서 자동 취득)
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_ENDPOINT=
```

> EC2에 연결된 Instance Profile(IAM Role)이 S3 권한을 갖고 있으면 static key가 불필요합니다.
> 이 방식은 fitters-log-api의 ECS Task Role이 S3 권한을 받는 패턴과 동일합니다.

### 2.3 Supabase 설정

```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_API_KEY=eyJhbGciOi...
```

> 기존 fitters-log Supabase 프로젝트를 재사용합니다.
> xavia-ota는 `releases`, `releases_tracking` 두 테이블만 사용하므로 기존 스키마와 충돌하지 않습니다.

### 2.4 인증/보안

```env
ADMIN_PASSWORD=<openssl rand -hex 24>
ADMIN_SESSION_SECRET=<openssl rand -hex 64>
ADMIN_SESSION_MAX_AGE_SECONDS=43200
UPLOAD_KEY=<openssl rand -hex 32>
PRIVATE_KEY_BASE_64=<base64 encoded RSA private key for expo code signing>
```

### 2.5 전체 `.env.aws.dev` 예시

```env
HOST=https://ota-dev.fitters-log.com
NODE_ENV=production
PORT=3000

BLOB_STORAGE_TYPE=s3
DB_TYPE=supabase

S3_REGION=ap-northeast-2
S3_BUCKET_NAME=fitters-log-ota-assets-dev
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_ENDPOINT=

SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_API_KEY=eyJhbGciOi...

ADMIN_PASSWORD=<generated>
ADMIN_SESSION_SECRET=<generated>
ADMIN_SESSION_MAX_AGE_SECONDS=43200
UPLOAD_KEY=<generated>
PRIVATE_KEY_BASE_64=<base64 RSA private key>
```

---

## 3. AWS 인프라 구성요소

### 3.1 생성해야 할 리소스

| # | 리소스 | 이름 규칙 | 비고 |
|---|--------|----------|------|
| 1 | **EC2 Instance** | `fitters-log-{env}-ota` | t4g.micro (ARM), Amazon Linux 2023 또는 Debian |
| 2 | **Elastic IP** | `fitters-log-{env}-ota-eip` | EC2에 연결 |
| 3 | **Security Group** | `fitters-log-{env}-ota-sg` | 기존 VPC 내 생성 |
| 4 | **S3 Bucket** | `fitters-log-ota-assets-{env}` | OTA 번들 저장 |
| 5 | **IAM Role + Instance Profile** | `fitters-log-{env}-ota-role` | S3 접근 권한 |
| 6 | **Route53 A Record** | `ota-dev.fitters-log.com` | Elastic IP 연결 |
| 7 | **Key Pair** | `fitters-log-{env}-ota-key` | SSH 접근용 |

### 3.2 기존 리소스 재사용

| 리소스 | ID/Name | 용도 |
|--------|---------|------|
| VPC | `fitters-log-{env}-vpc` | EC2 배치 |
| Public Subnet | `fitters-log-{env}-public-*` | EC2 서브넷 (AZ 하나 선택) |
| Route53 Hosted Zone | TFC 변수 `hosted_zone_id` | DNS 레코드 |
| Supabase | 기존 fitters-log 프로젝트 | DB |

### 3.3 Security Group 규칙

```
Inbound:
  - TCP 443 (HTTPS)    : 0.0.0.0/0
  - TCP 80  (HTTP)     : 0.0.0.0/0     (Certbot + redirect)
  - TCP 22  (SSH)      : <운영자 IP>/32 (관리용)

Outbound:
  - All traffic        : 0.0.0.0/0     (S3, Supabase 접근)
```

### 3.4 IAM Role Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::fitters-log-ota-assets-{env}"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::fitters-log-ota-assets-{env}/*"
    }
  ]
}
```

> fitters-log-api의 ECS Task Role(`fitters-log-{env}-task-role`)이 `s3:*`을 files bucket에 부여하는 것과
> 동일한 패턴이지만, OTA는 최소 권한 원칙을 적용합니다.

---

## 4. 인프라 생성 (AWS CLI / Console)

> Terraform 모듈화는 검증 후 별도로 진행합니다. 초기에는 수동 생성합니다.

### 4.1 S3 Bucket 생성

```bash
aws s3 mb s3://fitters-log-ota-assets-dev --region ap-northeast-2

# 퍼블릭 접근 차단 (기본값이지만 명시)
aws s3api put-public-access-block \
  --bucket fitters-log-ota-assets-dev \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

### 4.2 IAM Role + Instance Profile 생성

```bash
# Trust policy
cat > /tmp/ec2-trust.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

aws iam create-role \
  --role-name fitters-log-dev-ota-role \
  --assume-role-policy-document file:///tmp/ec2-trust.json

# S3 policy
cat > /tmp/ota-s3-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::fitters-log-ota-assets-dev"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::fitters-log-ota-assets-dev/*"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name fitters-log-dev-ota-role \
  --policy-name s3-ota-assets \
  --policy-document file:///tmp/ota-s3-policy.json

# Instance Profile
aws iam create-instance-profile --instance-profile-name fitters-log-dev-ota-profile
aws iam add-role-to-instance-profile \
  --instance-profile-name fitters-log-dev-ota-profile \
  --role-name fitters-log-dev-ota-role
```

### 4.3 Security Group 생성

```bash
# 기존 VPC ID 확인 (fitters-log-dev-vpc)
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=fitters-log-dev-vpc" \
  --query 'Vpcs[0].VpcId' --output text)

aws ec2 create-security-group \
  --group-name fitters-log-dev-ota-sg \
  --description "xavia-ota server security group" \
  --vpc-id $VPC_ID

SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=fitters-log-dev-ota-sg" \
  --query 'SecurityGroups[0].GroupId' --output text)

# Inbound rules
aws ec2 authorize-security-group-ingress --group-id $SG_ID \
  --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $SG_ID \
  --protocol tcp --port 443 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $SG_ID \
  --protocol tcp --port 22 --cidr <운영자_IP>/32
```

### 4.4 EC2 Instance 생성

```bash
# 기존 Public Subnet 중 하나 선택 (ap-northeast-2a)
SUBNET_ID=$(aws ec2 describe-subnets \
  --filters "Name=tag:Name,Values=fitters-log-dev-public-ap-northeast-2a" \
  --query 'Subnets[0].SubnetId' --output text)

# Key Pair 생성 (최초 1회)
aws ec2 create-key-pair \
  --key-name fitters-log-dev-ota-key \
  --query 'KeyMaterial' --output text > ~/.ssh/fitters-log-dev-ota-key.pem
chmod 400 ~/.ssh/fitters-log-dev-ota-key.pem

# Amazon Linux 2023 ARM64 AMI (t4g용)
# ap-northeast-2 최신 AMI는 아래 명령으로 확인
AMI_ID=$(aws ec2 describe-images \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023*-arm64" "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)

aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t4g.micro \
  --key-name fitters-log-dev-ota-key \
  --security-group-ids $SG_ID \
  --subnet-id $SUBNET_ID \
  --iam-instance-profile Name=fitters-log-dev-ota-profile \
  --associate-public-ip-address \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":20,"VolumeType":"gp3"}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=fitters-log-dev-ota}]'
```

### 4.5 Elastic IP + Route53

```bash
# Elastic IP 할당
ALLOC_ID=$(aws ec2 allocate-address --domain vpc --query 'AllocationId' --output text)
ELASTIC_IP=$(aws ec2 describe-addresses --allocation-ids $ALLOC_ID --query 'Addresses[0].PublicIp' --output text)

# EC2에 연결
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=fitters-log-dev-ota" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
aws ec2 associate-address --instance-id $INSTANCE_ID --allocation-id $ALLOC_ID

# Route53 A Record
HOSTED_ZONE_ID=<기존 fitters-log.com hosted zone ID>

aws route53 change-resource-record-sets --hosted-zone-id $HOSTED_ZONE_ID --change-batch '{
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "ota-dev.fitters-log.com",
      "Type": "A",
      "TTL": 300,
      "ResourceRecords": [{"Value": "'$ELASTIC_IP'"}]
    }
  }]
}'
```

---

## 5. VM 초기 설정

```bash
ssh -i ~/.ssh/fitters-log-dev-ota-key.pem ec2-user@<ELASTIC_IP>

# Amazon Linux 2023 패키지 설치
sudo dnf update -y
sudo dnf install -y nginx git jq unzip

# Node 20 (Amazon Linux 2023)
sudo dnf install -y nodejs20 npm

# 확인
node -v   # v20.x
npm -v

# 앱 디렉토리 생성
sudo mkdir -p /opt/xavia-ota /etc/xavia-ota
sudo chown -R ec2-user:ec2-user /opt/xavia-ota
```

> t4g.micro (1GB RAM)에서 `npm run build` OOM이 발생할 경우:

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

## 7. `.env.aws.dev` 작성 (로컬)

로컬에서 `.env.aws.dev`를 작성합니다. 이미 레포에 템플릿이 있으므로:

```bash
# xavia-ota 레포 루트에서
cp .env.aws.dev .env.aws.dev.local  # 작업용 복사본

# 또는 generate 스크립트 활용
./scripts/generate-aws-env.sh .env.aws.dev.local
```

채워야 할 값:

| 변수 | 값 출처 |
|------|--------|
| `HOST` | `https://ota-dev.fitters-log.com` |
| `S3_BUCKET_NAME` | `fitters-log-ota-assets-dev` |
| `S3_ACCESS_KEY_ID` | **비워둠** (IAM Role 사용) |
| `S3_SECRET_ACCESS_KEY` | **비워둠** (IAM Role 사용) |
| `SUPABASE_URL` | fitters-log Supabase 프로젝트의 URL |
| `SUPABASE_API_KEY` | fitters-log Supabase 프로젝트의 service_role key |
| `ADMIN_PASSWORD` | `openssl rand -hex 24` |
| `ADMIN_SESSION_SECRET` | `openssl rand -hex 64` |
| `UPLOAD_KEY` | `openssl rand -hex 32` |
| `PRIVATE_KEY_BASE_64` | `openssl base64 -A -in <fitters-log-private-key.pem>` |

> `PRIVATE_KEY_BASE_64`는 Expo code-signing 키입니다.
> fitters-log 전용 키 쌍이 필요하며, 앱 측 `expo-updates` 설정에 대응하는 certificate와 일치해야 합니다.

---

## 8. 로컬 → VM env 파일 반영

```bash
scp -i ~/.ssh/fitters-log-dev-ota-key.pem \
  .env.aws.dev.local \
  ec2-user@<ELASTIC_IP>:/tmp/ota.env

ssh -i ~/.ssh/fitters-log-dev-ota-key.pem ec2-user@<ELASTIC_IP> \
  "sudo install -m 600 /tmp/ota.env /etc/xavia-ota/ota.env && rm -f /tmp/ota.env"
```

검증:

```bash
ssh -i ~/.ssh/fitters-log-dev-ota-key.pem ec2-user@<ELASTIC_IP> \
  "sudo ls -l /etc/xavia-ota/ota.env && sudo head -10 /etc/xavia-ota/ota.env"
```

---

## 9. systemd 서비스 등록

```bash
ssh -i ~/.ssh/fitters-log-dev-ota-key.pem ec2-user@<ELASTIC_IP> << 'EOF'
set -euo pipefail
sudo tee /etc/systemd/system/xavia-ota.service > /dev/null << 'UNIT'
[Unit]
Description=Xavia OTA Service (fitters-log)
After=network.target

[Service]
Type=simple
User=ec2-user
Group=ec2-user
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

## 10. nginx + TLS

### 10.1 nginx reverse proxy

```bash
ssh -i ~/.ssh/fitters-log-dev-ota-key.pem ec2-user@<ELASTIC_IP> << 'EOF'
set -euo pipefail

# Amazon Linux 2023에서 certbot 설치
sudo dnf install -y python3-pip
sudo pip3 install certbot certbot-nginx

sudo tee /etc/nginx/conf.d/xavia-ota.conf > /dev/null << 'NGINX'
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

# 기본 설정과 충돌 방지
sudo rm -f /etc/nginx/conf.d/default.conf

sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
EOF
```

### 10.2 TLS 인증서 (Let's Encrypt)

```bash
ssh -i ~/.ssh/fitters-log-dev-ota-key.pem ec2-user@<ELASTIC_IP> \
  "sudo certbot --nginx -d ota-dev.fitters-log.com --non-interactive --agree-tos -m <운영자_이메일> --redirect"
```

> Certbot은 자동 갱신 timer를 설정합니다. `sudo systemctl list-timers`로 확인 가능합니다.

---

## 11. 동작 검증

### 11.1 OTA 공개 엔드포인트

```bash
curl -i "https://ota-dev.fitters-log.com/api/manifest" \
  -H "expo-protocol-version: 1" \
  -H "expo-platform: ios" \
  -H "expo-runtime-version: 1.0.0"
```

기대: `200` 또는 no-update 응답

### 11.2 관리자 보호 엔드포인트

```bash
curl -i "https://ota-dev.fitters-log.com/api/releases"
```

기대: `401 Unauthorized`

### 11.3 로그인 후 관리자 API

```bash
# 로그인 (쿠키 저장)
curl -i -c cookie.txt -X POST "https://ota-dev.fitters-log.com/api/login" \
  -H "Content-Type: application/json" \
  -d '{"password":"<ADMIN_PASSWORD>"}'

# 관리자 API 접근
curl -i -b cookie.txt "https://ota-dev.fitters-log.com/api/releases"
```

기대: 둘 다 `200`

### 11.4 S3 연결 검증

```bash
# VM에서 IAM Role로 S3 접근 확인
ssh -i ~/.ssh/fitters-log-dev-ota-key.pem ec2-user@<ELASTIC_IP> \
  "aws s3 ls s3://fitters-log-ota-assets-dev/"
```

---

## 12. OTA 앱 번들 배포

fitters-log 모바일 앱 레포의 루트에서 실행합니다:

```bash
./scripts/build-and-publish-app-release.sh <runtimeVersion> https://ota-dev.fitters-log.com <UPLOAD_KEY>
```

예시:

```bash
./scripts/build-and-publish-app-release.sh 1.0.0 https://ota-dev.fitters-log.com abc123...
```

> 앱 측 `app.json` (또는 `app.config.ts`)에서 `updates.url`이
> `https://ota-dev.fitters-log.com/api/manifest`로 설정되어 있어야 합니다.

---

## 13. 서버 재배포 (runbook)

```bash
ssh -i ~/.ssh/fitters-log-dev-ota-key.pem ec2-user@<ELASTIC_IP> << 'EOF'
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

## 14. env 파일 업데이트 (값 변경 시)

```bash
# 로컬에서 .env.aws.dev.local 수정 후
scp -i ~/.ssh/fitters-log-dev-ota-key.pem \
  .env.aws.dev.local \
  ec2-user@<ELASTIC_IP>:/tmp/ota.env

ssh -i ~/.ssh/fitters-log-dev-ota-key.pem ec2-user@<ELASTIC_IP> \
  "sudo install -m 600 /tmp/ota.env /etc/xavia-ota/ota.env && rm -f /tmp/ota.env && sudo systemctl restart xavia-ota"
```

---

## 15. 프로덕션 배포 (prod)

동일한 절차를 prod용으로 반복합니다. 차이점:

| 항목 | Dev | Prod |
|------|-----|------|
| EC2 Name | `fitters-log-dev-ota` | `fitters-log-prod-ota` |
| S3 Bucket | `fitters-log-ota-assets-dev` | `fitters-log-ota-assets-prod` |
| Domain | `ota-dev.fitters-log.com` | `ota.fitters-log.com` |
| IAM Role | `fitters-log-dev-ota-role` | `fitters-log-prod-ota-role` |
| SG | `fitters-log-dev-ota-sg` | `fitters-log-prod-ota-sg` |
| Env 파일 | `.env.aws.dev` | `.env.aws.prod` |
| Supabase | dev 프로젝트 | prod 프로젝트 |

> 네이밍은 기존 fitters-log-infra 규칙 (`{project_name}-{environment}-{resource}`)을 따릅니다.

---

## 16. 비용 예상

| 리소스 | 예상 월 비용 (USD) | 비고 |
|--------|-------------------|------|
| EC2 t4g.micro | ~$3 (또는 Free Tier) | ARM, 2 vCPU, 1GB RAM |
| Elastic IP | $0 (연결 상태) / $3.65 (미연결) | 반드시 EC2에 연결 |
| S3 | ~$1 이하 | OTA 번들은 소용량 |
| Route53 A Record | $0.50/zone + 쿼리 비용 | 기존 zone 재사용 |
| Data Transfer | ~$1 이하 | OTA 다운로드 트래픽 |
| **환경당 합계** | **~$5/월** | |

> fitters-log-api의 ECS Fargate ($9~15/월)보다 저렴합니다.
> OTA 서버는 트래픽이 낮고 auto-scaling이 불필요하므로 EC2가 적합합니다.

---

## 17. 향후 자동화 옵션 (ECS Fargate 전환)

현재 아키텍처가 안정화된 후, fitters-log-infra Terraform 모듈로 전환할 수 있습니다:

```
# 향후 fitters-log-infra/main.tf에 추가할 모듈 (참고용)
module "ota_ecr" { ... }
module "ota_ecs" { ... }         # 별도 ECS Service, 기존 Cluster 재사용
module "ota_codepipeline" { ... } # GitHub → CodeBuild → ECR → ECS
module "ota_dns" { ... }         # ota-dev.fitters-log.com → ALB
```

이 경우:
- 기존 ALB에 OTA용 Target Group + Listener Rule 추가 (host-based routing)
- 기존 ECS Cluster에 새 Service 추가
- ACM 인증서는 이미 `*.fitters-log.com` 와일드카드가 있으므로 추가 불필요 (단, ALB용은 ap-northeast-2에 별도 필요)
- CodePipeline으로 자동 배포

---

## 18. 운영 체크리스트

- [ ] `.env.aws.*` 실파일 Git 커밋 금지 확인 (`.gitignore`)
- [ ] `ADMIN_SESSION_SECRET` 충분한 길이 (64 hex 이상)
- [ ] SSH Security Group CIDR 최소화
- [ ] S3 bucket public access 차단 확인
- [ ] Supabase API key는 `service_role` key 사용 (RLS bypass 필요)
- [ ] Expo code-signing 키 쌍이 앱과 서버에 일치하는지 확인
- [ ] dev/prod 환경 간 Supabase 프로젝트 분리
- [ ] Elastic IP가 EC2에 연결 상태인지 확인 (미연결 시 과금)
- [ ] systemd 서비스 자동 시작 확인 (`systemctl is-enabled xavia-ota`)

### 장애 시 우선 확인

```bash
# 서비스 상태
sudo systemctl status xavia-ota

# 앱 로그
sudo journalctl -u xavia-ota -n 200 --no-pager

# nginx 로그
sudo tail -50 /var/log/nginx/error.log

# S3 접근 확인
aws s3 ls s3://fitters-log-ota-assets-dev/

# 디스크/메모리
df -h && free -m
```

---

## 19. fitters-log-infra와의 관계

현재 fitters-log-infra Terraform은 다음을 관리합니다:

```
fitters-log-infra (Terraform Cloud)
├── networking (VPC, Subnets)  ← OTA EC2가 재사용
├── security (ALB SG, ECS SG) ← OTA는 별도 SG
├── acm (api domain cert)
├── alb → ecs (API 서버)
├── ecr → codepipeline (API CI/CD)
├── secrets (API 비밀값)
├── s3 + cloudfront (files, landing, admin)
├── dns (api, files, landing, admin records)
└── slack notifications
```

OTA 인프라는 **초기에는 Terraform 외부에서 수동 관리**하며,
안정화 후 Terraform 모듈로 편입하는 것을 권장합니다.

Terraform에 편입할 때 주의사항:
- 기존 수동 리소스를 `terraform import`로 가져와야 함
- S3 bucket은 `moved` block 없이 import만 하면 됨
- EC2 → ECS Fargate로 전환 시 다운타임 계획 필요
