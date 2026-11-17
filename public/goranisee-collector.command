#!/bin/bash
# 고라니시 수집기 — 더블클릭하면 내 맥(현재 네트워크)으로 경쟁사 페이지를 수집해 어드민에 올립니다.
# 처음 열 때 "확인되지 않은 개발자" 경고가 나오면: 파일을 우클릭 → 열기 → 열기.
cd "$HOME"
ADMIN="https://goranisee.cardt.workers.dev"
if ! command -v node >/dev/null 2>&1 && [ ! -x /usr/local/bin/node ] && [ ! -x /opt/homebrew/bin/node ]; then
  echo "Node.js 가 없습니다. 설치 페이지를 엽니다 — 'macOS Installer' 받아 설치한 뒤 이 파일을 다시 더블클릭하세요."
  open "https://nodejs.org/ko/download"
  read -p "엔터를 누르면 닫힙니다." _; exit 0
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
echo "최신 수집기 내려받는 중…"
curl -sL "https://github.com/shadowmiro33-stack/goranisee/archive/refs/heads/main.zip" -o /tmp/goranisee.zip || { echo "다운로드 실패 — 인터넷 연결을 확인하세요"; read -p "" _; exit 1; }
rm -rf "$HOME/goranisee-main"; unzip -qo /tmp/goranisee.zip -d "$HOME" && cd "$HOME/goranisee-main" || exit 1
FUNNEL_ADMIN_URL="$ADMIN" node collector/local.cjs
read -p "끝났습니다. 엔터를 누르면 닫힙니다." _
