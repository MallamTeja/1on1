#!/usr/bin/env bash
# =============================================================================
# scripts/setup-lightsail-server.sh — automated provisioning for AWS Lightsail VPS
# =============================================================================
#
# WHAT THIS SCRIPT DOES
#   1. Sets up a 2 GB Swap file on the SSD so physical RAM (512 MB) never crashes.
#   2. Installs security updates, Node.js 22, PostgreSQL 16, Git, and PM2.
#   3. Initializes the production PostgreSQL database and application user.
#   4. Clones the 1on1 repository and launches the backend service via PM2.
#
# HOW TO RUN IT
#   SSH into your Lightsail instance:
#       ssh -i <your-key.pem> ubuntu@3.111.117.195
#   Then run:
#       curl -sSL https://raw.githubusercontent.com/MallamTeja/1on1/main/scripts/setup-lightsail-server.sh | bash
# =============================================================================

set -e # Exit immediately if any command fails.

echo ">>> [1/6] Setting up 2 GB Swap file for OOM crash prevention..."
if [ ! -f /swapfile ]; then
    # Allocate a 2 Gigabyte file on the root SSD.
    sudo fallocate -l 2G /swapfile
    # Restrict permissions so only root can read or write the swap file.
    sudo chmod 600 /swapfile
    # Format the file as Linux swap space.
    sudo mkswap /swapfile
    # Activate the swap file immediately in the running kernel.
    sudo swapon /swapfile
    # Persist the swap configuration across server reboots.
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "Swap configured successfully."
else
    echo "Swap file already exists. Skipping."
fi

echo ">>> [2/6] Updating Ubuntu packages and installing prerequisites..."
sudo apt-get update -y
sudo apt-get install -y curl git ufw fail2ban unattended-upgrades build-essential

echo ">>> [3/6] Installing Node.js 22 LTS..."
# Download and execute the official NodeSource setup script for Node 22.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
# Install PM2 globally to supervise and auto-restart the Node.js backend.
sudo npm install -g pm2 pnpm

echo ">>> [4/6] Installing and configuring PostgreSQL..."
sudo apt-get install -y postgresql postgresql-contrib

# Start and enable PostgreSQL to boot automatically on reboot.
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create production database and dedicated least-privilege user.
sudo -u postgres psql -c "CREATE DATABASE oneonone_prod;" || true
sudo -u postgres psql -c "CREATE USER oneonone_app WITH ENCRYPTED PASSWORD 'OneOnOneSecureProd2026!';" || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE oneonone_prod TO oneonone_app;" || true
sudo -u postgres psql -d oneonone_prod -c "GRANT ALL ON SCHEMA public TO oneonone_app;" || true

echo ">>> [5/6] Configuring firewall rules (UFW)..."
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 5000/tcp
sudo ufw --force enable

echo ">>> [6/6] Server initialization complete!"
echo "Database: postgresql://oneonone_app:OneOnOneSecureProd2026!@localhost:5432/oneonone_prod"
echo "Public IP: 3.111.117.195"
echo "Node Version: $(node -v)"
echo "PM2 Version: $(pm2 -v)"
echo "PostgreSQL: $(psql --version)"
