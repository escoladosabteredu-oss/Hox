#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

APP_DIR='/opt/hox-checkuser'
ENV_DIR='/etc/checkuser'
SERVICE_FILE='/etc/systemd/system/hox-checkuser.service'
RAW='https://raw.githubusercontent.com/escoladosabteredu-oss/Hox/main'

if [ "${EUID}" -ne 0 ]; then
  echo -e "${RED}Execute como root: sudo bash install.sh${NC}"
  exit 1
fi

echo -e "${GREEN}==> Instalando HoxTunnel CheckUser API...${NC}"

if ! command -v node >/dev/null 2>&1; then
  echo -e "${YELLOW}Node.js não encontrado. Instalando Node.js 20...${NC}"
  apt-get update -qq
  apt-get install -y ca-certificates curl gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y nodejs
fi

apt-get install -y passwd procps coreutils -qq

mkdir -p "$APP_DIR" "$ENV_DIR"
curl -fsSL "$RAW/index.js" -o "$APP_DIR/index.js"
curl -fsSL "$RAW/package.json" -o "$APP_DIR/package.json"

cd "$APP_DIR"
npm install --omit=dev --silent

read -rp "Porta [9000]: " PORT_INPUT
PORT_INPUT=${PORT_INPUT:-9000}
read -rp "Limite de conexões [1]: " LIMIT_INPUT
LIMIT_INPUT=${LIMIT_INPUT:-1}

cat > "$ENV_DIR/.env" <<ENVEOF
PORT=$PORT_INPUT
HOST=0.0.0.0
CHECKUSER_MODE=local
DEFAULT_LIMIT_CONNECTIONS=$LIMIT_INPUT
CONNECTION_COUNT_MODE=auto
LIMITS_FILE=/etc/checkuser/limits.json
ONLINE_FILE=/etc/checkuser/online.json
HTTP_ERRORS=false
CHECKUSER_API_KEY=
VERBOSE=false
ENVEOF
chmod 600 "$ENV_DIR/.env"

[ ! -f "$ENV_DIR/limits.json" ] && echo '{}' > "$ENV_DIR/limits.json"
chmod 600 "$ENV_DIR/limits.json"

cat > "$SERVICE_FILE" <<EOF2
[Unit]
Description=HoxTunnel CheckUser API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_DIR/.env
ExecStart=/usr/bin/node $APP_DIR/index.js
Restart=always
RestartSec=3
User=root
Group=root
NoNewPrivileges=false

[Install]
WantedBy=multi-user.target
EOF2

systemctl daemon-reload
systemctl enable hox-checkuser
systemctl restart hox-checkuser

# Instala o comando 'hox'
curl -fsSL "$RAW/manage.sh" -o /usr/local/bin/hox
chmod +x /usr/local/bin/hox

echo -e "${GREEN}"
echo "╔══════════════════════════════════════════╗"
echo "║  HoxTunnel CheckUser instalado!          ║"
echo "║  Digite 'hox' para abrir o gerenciador   ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"
echo "  Teste: curl http://127.0.0.1:$PORT_INPUT/check/root"
