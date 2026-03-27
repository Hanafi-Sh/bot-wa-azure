#!/bin/bash
set -e

echo "============================================="
echo "   Menyiapkan Environment VPS untuk HanBot   "
echo "============================================="

echo "[1/5] Update system repository..."
sudo apt update && sudo apt upgrade -y

echo "[2/5] Install Node.js v22..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "Node.js sudah terinstall: $(node -v)"
fi

echo "[3/5] Install dependencies untuk Puppeteer (WhatsApp Web)..."
sudo apt-get install -y \
    wget gnupg procps libnss3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxcomposite1 libxdamage1 libxext6 \
    libxfixes3 libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 \
    libx11-6 libx11-xcb1 libxcb1 libxshmfence1 libxss1 fonts-liberation \
    lsb-release xdg-utils chromium-browser

echo "[4/5] Install PM2 (Process Manager)..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
else
    echo "PM2 sudah terinstall"
fi

echo "[5/5] Install NPM modules project..."
cd ~/bot-wa || cd ~/bot-wa-heroku || { echo "Folder project tidak ditemukan!"; exit 1; }
npm install

echo "============================================="
echo "   Setup Selesai! Anda siap menjalankan Bot  "
echo "============================================="
