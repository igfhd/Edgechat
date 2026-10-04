#!/usr/bin/env bash
# ==============================================================================
# EdgeChat Web Deployer 自动化交互式部署脚本
# 适用场景：VPS 部署 Web 在线部署平台 + Cloudflare CDN (自签证书/已有证书)
# 特性：
#   1. 交互式获取域名与配置
#   2. 自动检查/安装 Docker、Docker Compose、Nginx、OpenSSL
#   3. 自动检测/生成 10 年有效期自签 SSL 证书 (适配 Cloudflare Full SSL)
#   4. 仅监听 443 端口，不占用 80 端口
#   5. 一键构建并启动 Docker 容器与 Nginx 反向代理
# ==============================================================================

set -eo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# 脚本所在目录定位
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$(basename "$SCRIPT_DIR")" == "deploy" && -f "$SCRIPT_DIR/docker-compose.yml" ]]; then
    DEPLOY_DIR="$SCRIPT_DIR"
    ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
elif [[ -f "$SCRIPT_DIR/deploy/docker-compose.yml" ]]; then
    ROOT_DIR="$SCRIPT_DIR"
    DEPLOY_DIR="$SCRIPT_DIR/deploy"
elif [[ -f "$PWD/deploy/docker-compose.yml" ]]; then
    ROOT_DIR="$PWD"
    DEPLOY_DIR="$PWD/deploy"
else
    ROOT_DIR="$PWD"
    DEPLOY_DIR="$PWD/deploy"
fi

# 获取项目版本号
PROJECT_VERSION="1.0.0"
if [[ -f "$ROOT_DIR/package.json" ]]; then
    PKG_VER=$(grep -m1 '"version"' "$ROOT_DIR/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
    if [[ -n "$PKG_VER" ]]; then
        PROJECT_VERSION="$PKG_VER"
    fi
fi

log_info() {
    printf "${CYAN}[INFO]${NC} %s\n" "$1"
}

log_success() {
    printf "${GREEN}[SUCCESS]${NC} %s\n" "$1"
}

log_warn() {
    printf "${YELLOW}[WARN]${NC} %s\n" "$1"
}

log_error() {
    printf "${RED}[ERROR]${NC} %s\n" "$1"
}

# 权限检测
check_root() {
    if [[ $EUID -ne 0 ]]; then
        SUDO="sudo"
        log_warn "当前不是 root 用户，将使用 sudo 提升权限执行系统命令。"
    else
        SUDO=""
    fi
}

# 包管理器探测
detect_pkg_manager() {
    if command -v apt-get &>/dev/null; then
        PKG_MANAGER="apt"
    elif command -v dnf &>/dev/null; then
        PKG_MANAGER="dnf"
    elif command -v yum &>/dev/null; then
        PKG_MANAGER="yum"
    elif command -v apk &>/dev/null; then
        PKG_MANAGER="apk"
    else
        PKG_MANAGER="unknown"
    fi
}

install_pkg() {
    local pkgs=("$@")
    detect_pkg_manager
    case "$PKG_MANAGER" in
        apt)
            $SUDO apt-get update -y
            $SUDO apt-get install -y "${pkgs[@]}"
            ;;
        dnf|yum)
            $SUDO $PKG_MANAGER install -y "${pkgs[@]}"
            ;;
        apk)
            $SUDO apk add --no-cache "${pkgs[@]}"
            ;;
        *)
            log_error "未识别的包管理器，请手动安装: ${pkgs[*]}"
            exit 1
            ;;
    esac
}

# 检查基础依赖 (curl, openssl, nginx)
check_base_deps() {
    log_info "正在检查基础依赖 (curl, openssl, nginx)..."
    local needed_pkgs=()

    if ! command -v curl &>/dev/null; then
        needed_pkgs+=("curl")
    fi
    if ! command -v openssl &>/dev/null; then
        needed_pkgs+=("openssl")
    fi
    if ! command -v nginx &>/dev/null; then
        needed_pkgs+=("nginx")
    fi

    if [[ ${#needed_pkgs[@]} -gt 0 ]]; then
        log_info "正在自动安装缺失的系统软件包: ${needed_pkgs[*]}"
        install_pkg "${needed_pkgs[@]}"
    fi
    log_success "基础依赖环境已就绪。"
}

# 检查 Docker 与 Docker Compose
check_docker() {
    log_info "正在检查 Docker 与 Docker Compose 环境..."
    
    if ! command -v docker &>/dev/null; then
        log_warn "未检测到 Docker，正在为您自动安装 Docker..."
        curl -fsSL https://get.docker.com | $SUDO bash
        $SUDO systemctl enable --now docker || true
    fi

    # 检查 Docker 守护进程是否在运行
    if ! $SUDO docker info &>/dev/null; then
        log_info "正在启动 Docker 守护进程..."
        $SUDO systemctl start docker || true
    fi

    # 检查 Docker Compose
    if ! docker compose version &>/dev/null && ! command -v docker-compose &>/dev/null; then
        log_warn "未检测到 docker compose 插件，正在尝试安装..."
        detect_pkg_manager
        if [[ "$PKG_MANAGER" == "apt" ]]; then
            $SUDO apt-get install -y docker-compose-plugin || install_compose_binary
        else
            install_compose_binary
        fi
    fi

    if docker compose version &>/dev/null; then
        DOCKER_COMPOSE_CMD="docker compose"
    elif command -v docker-compose &>/dev/null; then
        DOCKER_COMPOSE_CMD="docker-compose"
    else
        log_error "无法找到可用的 docker compose 命令，请检查 Docker 安装。"
        exit 1
    fi
    log_success "Docker 环境就绪: $($DOCKER_COMPOSE_CMD version 2>/dev/null || true)"
}

install_compose_binary() {
    log_info "从 GitHub 下载安装 docker-compose CLI 独立二进制..."
    local compose_url="https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)"
    $SUDO curl -fsSL "$compose_url" -o /usr/local/bin/docker-compose
    $SUDO chmod +x /usr/local/bin/docker-compose
}

# 证书探测与自动自签生成
prepare_ssl_cert() {
    local domain="$1"
    log_info "正在检查域名 [$domain] 的 SSL 证书..."

    # 常见证书候选路径
    local cert_candidates=(
        "/etc/nginx/tls/cert.pem:/etc/nginx/tls/private.key"
        "/etc/nginx/tls/$domain.crt:/etc/nginx/tls/$domain.key"
        "/etc/nginx/ssl/$domain.crt:/etc/nginx/ssl/$domain.key"
        "/etc/ssl/certs/$domain.crt:/etc/ssl/private/$domain.key"
        "/etc/letsencrypt/live/$domain/fullchain.pem:/etc/letsencrypt/live/$domain/privkey.pem"
    )

    SSL_CERT_PATH=""
    SSL_KEY_PATH=""

    for pair in "${cert_candidates[@]}"; do
        local c="${pair%%:*}"
        local k="${pair##*:}"
        if [[ -f "$c" && -f "$k" ]]; then
            SSL_CERT_PATH="$c"
            SSL_KEY_PATH="$k"
            log_success "发现已存在的有效证书文件，直接复用:"
            printf "   证书 (Certificate): %s\n" "$SSL_CERT_PATH"
            printf "   私钥 (Private Key): %s\n" "$SSL_KEY_PATH"
            return 0
        fi
    done

    # 若不存在，则创建目录并签发 10 年自签证书 (适合 Cloudflare Full SSL)
    log_info "未检测到现有证书，正在为 [$domain] 自动生成 10 年有效期自签名 SSL 证书..."
    local tls_dir="/etc/nginx/tls"
    $SUDO mkdir -p "$tls_dir"
    SSL_CERT_PATH="$tls_dir/$domain.crt"
    SSL_KEY_PATH="$tls_dir/$domain.key"

    # 生成自签证书（带 SAN 扩展以兼容现代浏览器/CDN 校验）
    $SUDO openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout "$SSL_KEY_PATH" \
        -out "$SSL_CERT_PATH" \
        -subj "/CN=$domain/O=EdgeChat Deployer" \
        -addext "subjectAltName=DNS:$domain" 2>/dev/null

    $SUDO chmod 600 "$SSL_KEY_PATH"
    $SUDO chmod 644 "$SSL_CERT_PATH"

    log_success "自签名证书生成成功:"
    printf "   证书路径: %s\n" "$SSL_CERT_PATH"
    printf "   私钥路径: %s\n" "$SSL_KEY_PATH"
}

# 配置 Nginx (仅监听 443 端口，不监听 80 端口)
configure_nginx() {
    local domain="$1"
    local local_port="$2"
    log_info "正在配置 Nginx 反向代理 (统一存放于 /etc/nginx/conf.d，仅监听 443 端口)..."

    local nginx_conf_dir="/etc/nginx/conf.d"
    $SUDO mkdir -p "$nginx_conf_dir"

    # 确保主配置文件 /etc/nginx/nginx.conf 包含 include /etc/nginx/conf.d/*.conf;
    if [[ -f "/etc/nginx/nginx.conf" ]] && ! grep -q 'conf.d/*.conf' "/etc/nginx/nginx.conf"; then
        log_info "检测到 /etc/nginx/nginx.conf 未加载 conf.d 目录，正在自动补充 include 引用..."
        $SUDO sed -i '/http[[:space:]]*{/a     include /etc/nginx/conf.d/*.conf;' "/etc/nginx/nginx.conf"
    fi

    local conf_file="$nginx_conf_dir/edgechat-deployer.conf"
    local temp_conf="/tmp/edgechat-deployer.conf.tmp"

    cat <<EOF > "$temp_conf"
# EdgeChat Web Deployer Nginx 配置
# 配置文件路径: /etc/nginx/conf.d/edgechat-deployer.conf
# 仅监听 443 端口 (Cloudflare CDN 代理专用)

server {
    listen 443 ssl;
    listen [::]:443 ssl;

    server_name $domain;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_certificate $SSL_CERT_PATH;
    ssl_certificate_key $SSL_KEY_PATH;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 允许上传文件大小限制与连接保持
    client_max_body_size 30M;

    location / {
        proxy_redirect off;
        proxy_pass http://127.0.0.1:$local_port;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$http_host;

        # 传递真实客户端信息
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # 超时设置
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
EOF

    $SUDO mv "$temp_conf" "$conf_file"
    $SUDO chmod 644 "$conf_file"

    # 清理旧版 sites-available/sites-enabled 残留配置
    # rm -f 可以静默且正确地删除普通文件、有效软链接以及失效/悬空软链接
    $SUDO rm -f "/etc/nginx/sites-enabled/edgechat-deployer.conf" 2>/dev/null || true
    $SUDO rm -f "/etc/nginx/sites-available/edgechat-deployer.conf" 2>/dev/null || true

    log_info "正在测试 Nginx 配置文件语法..."
    local nginx_test_output
    if ! nginx_test_output=$($SUDO nginx -t 2>&1); then
        log_error "Nginx 配置测试失败，错误详情："
        echo "$nginx_test_output"
        exit 1
    fi
    echo "$nginx_test_output"

    if command -v systemctl &>/dev/null; then
        $SUDO systemctl enable nginx 2>/dev/null || true
        $SUDO systemctl reload nginx 2>/dev/null || $SUDO systemctl restart nginx 2>/dev/null || true
    elif command -v service &>/dev/null; then
        $SUDO service nginx reload 2>/dev/null || $SUDO service nginx restart 2>/dev/null || true
    fi
    log_success "Nginx 配置生效成功 (路径: /etc/nginx/conf.d/edgechat-deployer.conf)！"
}

# 启动 Docker 容器服务
deploy_docker_service() {
    local local_port="$1"
    local concurrency="$2"

    log_info "正在准备启动 Web Deployer Docker 容器..."

    if [[ ! -d "$DEPLOY_DIR" || ! -f "$DEPLOY_DIR/docker-compose.yml" ]]; then
        log_error "未找到 Web Deployer 部署目录或 compose 文件: $DEPLOY_DIR"
        exit 1
    fi

    cd "$DEPLOY_DIR"

    # 如果有自定义端口或并发数，生成/更新 .env 文件
    cat <<EOF > "$DEPLOY_DIR/.env"
HOST_PORT=$local_port
PORT=8000
EDGECHAT_CONCURRENCY=$concurrency
EDGECHAT_JOB_TTL=86400
EDGECHAT_DATA_DIR=/app/server/data
EDGECHAT_JOBS_DIR=/tmp/edgechat_deploy_jobs
EOF

    log_info "正在构建并启动 Docker 容器 (可能需要 1~3 分钟)..."
    $SUDO $DOCKER_COMPOSE_CMD down 2>/dev/null || true
    $SUDO $DOCKER_COMPOSE_CMD up -d --build

    log_success "Web Deployer Docker 容器启动成功！"
}

# 主流程交互
main() {
    clear || true
    printf "${CYAN}${BOLD}"
    cat << EOF
====================================================================
      🚀 EdgeChat Web Deployer 在线部署平台 一键安装 (v${PROJECT_VERSION})
====================================================================
EOF
    printf "${NC}"
    printf "本脚本将帮助您在 VPS 上一键搭建 EdgeChat 网页图形化部署平台。\n"
    printf "支持 Cloudflare CDN 代理，自动检测/生成自签 SSL 证书，且仅监听 443 端口。\n\n"

    check_root

    # 1. 交互式输入域名
    while true; do
        read -r -p "$(printf "${BOLD}👉 请输入准备绑定的域名 (例如: deploy.yourdomain.com): ${NC}")" INPUT_DOMAIN
        INPUT_DOMAIN=$(echo "$INPUT_DOMAIN" | tr -d '[:space:]')
        if [[ -z "$INPUT_DOMAIN" ]]; then
            log_warn "域名不能为空，请重新输入。"
        elif [[ "$INPUT_DOMAIN" =~ ^[a-zA-Z0-9][-a-zA-Z0-9.]*[a-zA-Z0-9]$ ]]; then
            DOMAIN="$INPUT_DOMAIN"
            break
        else
            log_warn "域名格式看起来不正确，请重新输入有效的域名。"
        fi
    done

    # 2. 交互式输入本地监听端口（默认 8000）
    read -r -p "$(printf "${BOLD}👉 请输入内部容器映射端口 [默认 8000]: ${NC}")" INPUT_PORT
    INPUT_PORT=$(echo "$INPUT_PORT" | tr -d '[:space:]')
    LOCAL_PORT="${INPUT_PORT:-8000}"

    # 3. 交互式输入最大同时搭建并发数（默认 2）
    read -r -p "$(printf "${BOLD}👉 请输入最大同时并发搭建任务数 (EDGECHAT_CONCURRENCY) [默认 2]: ${NC}")" INPUT_CONC
    INPUT_CONC=$(echo "$INPUT_CONC" | tr -d '[:space:]')
    CONCURRENCY="${INPUT_CONC:-2}"

    printf "\n${BOLD}📋 配置确认信息：${NC}\n"
    printf "   • 访问域名: ${CYAN}%s${NC}\n" "$DOMAIN"
    printf "   • 内部端口: ${CYAN}%s${NC}\n" "$LOCAL_PORT"
    printf "   • 并发上限: ${CYAN}%s${NC}\n" "$CONCURRENCY"
    printf "   • 监听端口: ${CYAN}仅 443 端口 (80 端口保持未占用)${NC}\n\n"

    read -r -p "$(printf "${YELLOW}确认开始安装并部署？(Y/n): ${NC}")" CONFIRM
    CONFIRM="${CONFIRM:-Y}"
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
        log_info "操作已取消。"
        exit 0
    fi

    printf "\n"
    # 执行各阶段
    check_base_deps
    check_docker
    prepare_ssl_cert "$DOMAIN"
    deploy_docker_service "$LOCAL_PORT" "$CONCURRENCY"
    configure_nginx "$DOMAIN" "$LOCAL_PORT"

    # 输出完成信息与 Cloudflare 配置指南
    printf "\n${GREEN}${BOLD}"
    cat << EOF
====================================================================
      🎉 EdgeChat Web Deployer (v${PROJECT_VERSION}) 安装部署完成！
====================================================================
EOF
    printf "${NC}"
    printf "\n${BOLD}🌐 访问地址：${NC} ${CYAN}${BOLD}https://%s${NC}\n\n" "$DOMAIN"
    printf "${BOLD}☁️ Cloudflare 控制台配置要点（非常重要）：${NC}\n"
    printf " 1. ${BOLD}DNS 解析${NC}：在 Cloudflare 添加 A 记录指向当前 VPS IP，并将代理状态开启为 ${YELLOW}已代理 (橙色小云朵 ☁️)${NC}。\n"
    printf " 2. ${BOLD}SSL/TLS 加密模式${NC}：进入 Cloudflare 控制台 -> ${BOLD}SSL/TLS${NC}，将加密模式设置为 ${GREEN}完全 (Full)${NC}。\n"
    printf "    (因为 VPS 使用了自签名证书，Full 模式可确保 Cloudflare CDN 与您的 VPS 之间安全加密通信)\n\n"
    printf "${BOLD}🛠️ 常用运维命令：${NC}\n"
    printf " • 查看运行状态: cd %s && %s ps\n" "$DEPLOY_DIR" "$DOCKER_COMPOSE_CMD"
    printf " • 查看实时日志: cd %s && %s logs -f\n" "$DEPLOY_DIR" "$DOCKER_COMPOSE_CMD"
    printf " • 重启服务:     cd %s && %s restart\n" "$DEPLOY_DIR" "$DOCKER_COMPOSE_CMD"
    printf "\n"
}

main "$@"
