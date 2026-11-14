#!/usr/bin/env bash
set -euo pipefail

# Ubuntu 24.04 VPS Bootstrap Script for SolShield BuildCheck (@SolShieldCheck Bot + Chromium CDP)
# Usage: bash worker/setup-vps.sh

echo "[1/5] Installing Node.js 22 LTS if missing..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "[2/5] Installing project dependencies..."
npm ci --no-audit --no-fund

echo "[3/5] Installing headless Chromium + Linux shared libraries..."
npx playwright install chromium
sudo npx playwright install-deps chromium || true

echo "[4/5] Installing PM2 process manager globally..."
sudo npm install -g pm2

echo "[5/5] Setup complete!"
echo "Next steps:"
echo "  1. cp .env.example .env && nano .env"
echo "  2. Test local bot check: npm run bot:check -- \"https://github.com/Blanksite/solshield\""
echo "  3. Start workers via PM2: pm2 start worker/ecosystem.config.cjs && pm2 save"
