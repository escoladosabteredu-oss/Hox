#!/usr/bin/env bash
# ============================================================
#  HoxTunnel CheckUser API – Gerenciador
#  Uso: sudo bash manage.sh
# ============================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

APP_DIR='/opt/hox-checkuser'
ENV_DIR='/etc/checkuser'
SERVICE='hox-checkuser'
RAW='https://raw.githubusercontent.com/escoladosabteredu-oss/Hox/main'

if [ "${EUID}" -ne 0 ]; then
  echo -e "${RED}Execute como root: sudo bash manage.sh${NC}"
  exit 1
fi

instalar() {
  echo -e "${GREEN}==> Instalando...${NC}"
  bash <(curl -fsSL "$RAW/install.sh")
}

desinstalar() {
  echo -e "${YELLOW}==> Desinstalando...${NC}"
  systemctl stop $SERVICE 2>/dev/null
  systemctl disable $SERVICE 2>/dev/null
  rm -f /etc/systemd/system/$SERVICE.service
  rm -rf "$APP_DIR"
  rm -rf "$ENV_DIR"
  systemctl daemon-reload
  echo -e "${GREEN}Removido com sucesso!${NC}"
}

ativar() {
  systemctl start $SERVICE
  echo -e "${GREEN}Serviço ativado!${NC}"
}

desativar() {
  systemctl stop $SERVICE
  echo -e "${YELLOW}Serviço desativado!${NC}"
}

status() {
  systemctl status $SERVICE --no-pager
}

logs() {
  journalctl -u $SERVICE -f --no-pager
}

atualizar() {
  echo -e "${CYAN}==> Atualizando...${NC}"
  curl -fsSL "$RAW/index.js" -o "$APP_DIR/index.js"
  systemctl restart $SERVICE
  echo -e "${GREEN}Atualizado e reiniciado!${NC}"
}

while true; do
  echo ""
  echo -e "${CYAN}=============================="
  echo -e "  HoxTunnel CheckUser - Menu  "
  echo -e "==============================${NC}"
  echo "1) Instalar"
  echo "2) Desinstalar"
  echo "3) Ativar serviço"
  echo "4) Desativar serviço"
  echo "5) Status"
  echo "6) Ver logs"
  echo "7) Atualizar"
  echo "8) Sair"
  echo ""
  read -rp "Escolha: " opcao

  case $opcao in
    1) instalar ;;
    2) desinstalar ;;
    3) ativar ;;
    4) desativar ;;
    5) status ;;
    6) logs ;;
    7) atualizar ;;
    8) echo "Saindo..."; exit 0 ;;
    *) echo -e "${RED}Opção inválida!${NC}" ;;
  esac
done
