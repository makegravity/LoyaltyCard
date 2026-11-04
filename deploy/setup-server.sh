#!/bin/bash
# One-time setup of a fresh Ubuntu or Debian server for the membership app. Run as root:
#   bash deploy/setup-server.sh
# Installs Docker and starts it at every boot (so the app comes back after a reboot),
# allows only SSH and web traffic through the firewall, and turns on automatic
# security updates.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl ufw unattended-upgrades

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

dpkg-reconfigure -f noninteractive unattended-upgrades

mkdir -p /opt/binmania
echo "Server ready. Copy the app to /opt/binmania, add its .env, then: cd /opt/binmania && docker compose up -d --build"
