# KubePilot — Prototype Deploy (single AWS VM, ~$15/mo)

Everything on one box with Docker Compose: apps + Postgres/Timescale + Redis ×2 + MinIO +
Caddy (automatic HTTPS). No Kubernetes, no managed services. Good for 0-few users; when you
need scale/HA later, the same images move to Kubernetes unchanged.

## 1. Launch the cheapest VM that runs it
- **EC2 Ubuntu 24.04**, **t3.small** (2 GB) — the practical minimum to *run* the whole stack.
  *(t3.micro / free-tier = 1 GB is too small; it will OOM.)*
- **20 GB gp3** disk.
- **Elastic IP** attached (stable address for DNS).
- **Security group:** inbound `22` (your IP), `80`, `443` (anywhere).
- *Even cheaper + simpler:* an **AWS Lightsail 2 GB** instance (~$12/mo flat, bandwidth included).

## 2. Install Docker + a build swap file
```bash
curl -fsSL https://get.docker.com | sh      # Docker Engine + the compose plugin
sudo usermod -aG docker $USER && newgrp docker

# 2 GB gives the one-time image build enough memory on a 2 GB box (swap is free).
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
*(Tip to avoid building on the box at all: run `docker compose … build` on your laptop, `docker save`/`load` the images over, then `up -d` without `--build`.)*

## 3. Get the code + configure
```bash
git clone https://github.com/<you>/kubepilot.git && cd kubepilot
cp deploy/.env.prod.example deploy/.env
# edit deploy/.env: set DOMAIN, and strong POSTGRES_PASSWORD / MINIO_ROOT_PASSWORD;
# generate the session secret:
sed -i "s/change-me-64-hex-chars/$(openssl rand -hex 32)/" deploy/.env
```

## 4. Point DNS
In Route 53 (or any DNS), add an **A record** for your `DOMAIN` → the VM's Elastic IP.
(Caddy needs this resolvable before it can get a TLS cert.)

## 5. Launch
```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```
Order is automatic: stores come up → `migrate` runs `prisma migrate deploy` (creates schema, the
`kubepilot_app` role, Timescale extensions/hypertables) → apps start → Caddy fetches HTTPS for your
domain. First build takes a few minutes.

```bash
docker compose -f deploy/docker-compose.prod.yml ps      # all healthy?
docker compose -f deploy/docker-compose.prod.yml logs -f migrate   # migrations applied?
```

## 6. Verify
- Visit `https://<DOMAIN>` → landing page → **Register** a company → connect a cluster.
- `curl https://<DOMAIN>/trpc/health` → ok.

## 7. Backups (recommended)
Nightly Postgres dump (optionally shipped to S3):
```bash
sudo mkdir -p /var/backups/kubepilot
crontab -e
# add (ships off-box if BACKUP_S3_BUCKET is set):
0 3 * * * cd /home/ubuntu/kubepilot && BACKUP_S3_BUCKET=my-backup-bucket bash deploy/backup.sh >> /var/log/kp-backup.log 2>&1
```

## Operating
- **Update:** `git pull && docker compose -f deploy/docker-compose.prod.yml up -d --build`
  (migrations re-run automatically).
- **Logs:** `docker compose -f deploy/docker-compose.prod.yml logs -f backend engine`
- **Harden the app DB role** (off the default `app_password`): see the note in `.env.prod.example`.

## Cost (us-east-1, approx — minimized)
t3.small ~$15/mo · 20 GB gp3 ~$1.6 · Elastic IP free while attached · egress negligible → **~$17/mo**.
Or **Lightsail 2 GB ~$12/mo flat**. Free-tier note: t3.micro is free for 12 months but too small to
run the full stack — t3.small is the realistic floor. To trim further later, move the frontend to
Cloudflare Pages (free) and shrink the box.
