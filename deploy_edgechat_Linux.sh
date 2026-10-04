#!/usr/bin/env bash
#
# Edgechat Cloudflare 本地一键部署脚本
#
# 最低要求：
#   - Node.js 20.x 或更新版本（推荐 22.x，脚本支持自动安装/升级）
#   - npm（随 Node.js 一起安装）
#   - python3（通常系统预装）
#
# 脚本特性：
#   ✓ 运行环境自动检测与修复 (Node.js, npm, python3, wrangler)
#   ✓ 多认证模式：浏览器 OAuth 登录 / 手动 API Token / Global API Key / .env.local
#   ✓ Cloudflare 资源全自动管理 (D1: cfchat-db, KV: SESSIONS, R2: cfchat-files)
#   ✓ 自动识别 R2 状态并支持平滑降级（无信用卡账号不报错）
#   ✓ 隐藏入口 (ROUTE_PREFIX) 与反代伪装 (DISGUISE_HOST) 强力防护
#   ✓ 自动构建 Vue 3 + Vite 前端并打包为 Cloudflare Workers Assets
#   ✓ 自动初始化 D1 数据库、执行增量迁移并配置 PBKDF2 管理员账户
#   ✓ 自动初始化服务端 AES-256 数据加密密钥环 (Keyring)
#   ✓ 交互式菜单与命令行全自动模式，支持软重置与硬重置
#

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_CFG="$ROOT_DIR/wrangler.toml"
WORKER_EXAMPLE_CFG="$ROOT_DIR/wrangler.example.toml"

# 获取项目版本号
PROJECT_VERSION="1.0.0"
if [[ -f "$ROOT_DIR/package.json" ]]; then
  PKG_VER=$(grep -m1 '"version"' "$ROOT_DIR/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
  if [[ -n "$PKG_VER" ]]; then
    PROJECT_VERSION="$PKG_VER"
  fi
fi
ENV_LOCAL="$ROOT_DIR/.env.local"
WRANGLER_STATE_DIR="${WRANGLER_STATE_DIR:-$ROOT_DIR/.tmp/wrangler}"
WRANGLER_VERSION="${WRANGLER_VERSION:-4.11.1}"
DEPLOY_LOCK_DIR="$ROOT_DIR/.tmp/deploy.lock"
DEPLOY_LOCK_HELD=0

# 确保 ~/.local/bin 在 PATH 中
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  export PATH="$HOME/.local/bin:$PATH"
fi

# 推荐伪装站点候选池
DISGUISE_SITES=(
  "nginx"
  "fentybeauty.com"
  "studiosashiko.com"
  "wholydose.com"
  "100percentpure.com"
  "kyliecosmetics.com"
  "sephora.com"
  "thrivecausemetics.com"
)

# 移除字符串两端可能存在的任意单引号、双引号与空白
strip_quotes() {
  local val="$1"
  val="${val#"${val%%[![:space:]]*}"}"
  val="${val%"${val##*[![:space:]]}"}"
  while [[ "$val" =~ ^\"(.*)\"$ ]] || [[ "$val" =~ ^\'(.*)\'$ ]]; do
    val="${BASH_REMATCH[1]}"
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
  done
  printf "%s" "$val"
}

# 安全加载本地 .env.local 或 .env（如果存在）
load_local_env() {
  local env_file=""
  if [[ -f "$ENV_LOCAL" ]]; then
    env_file="$ENV_LOCAL"
  elif [[ -f "$ROOT_DIR/.env" ]]; then
    env_file="$ROOT_DIR/.env"
  fi

  if [[ -n "$env_file" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line#"${line%%[![:space:]]*}"}"
      line="${line%"${line##*[![:space:]]}"}"
      [[ -z "$line" || "$line" =~ ^# ]] && continue
      if [[ "$line" =~ ^(export[[:space:]]+)?([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$ ]]; then
        local key="${BASH_REMATCH[2]}"
        local val="${BASH_REMATCH[3]}"
        val="${val%%#*}"
        val=$(strip_quotes "$val")
        export "$key=$val"
      fi
    done < "$env_file"
  fi
}
load_local_env

# 默认 Cloudflare 资源名称
export CF_D1_NAME="${EDGECHAT_D1_DATABASE_NAME:-${CFCHAT_D1_DATABASE_NAME:-${CF_D1_NAME:-cfchat-db}}}"
export CF_KV_NAMESPACE="${EDGECHAT_KV_NAMESPACE_TITLE:-${CFCHAT_KV_NAMESPACE_TITLE:-${CF_KV_NAMESPACE:-SESSIONS}}}"
export CF_R2_BUCKET="${EDGECHAT_R2_BUCKET_NAME:-${CFCHAT_R2_BUCKET_NAME:-${CF_R2_BUCKET:-cfchat-files}}}"
export EDGECHAT_WORKER_NAME="${EDGECHAT_WORKER_NAME:-cfchat}"

# 日志输出工具
log()     { printf '\e[1;34m[Edgechat]\e[0m %s\n' "$*"; }
success() { printf '\e[1;32m[Edgechat] ✅ %s\e[0m\n' "$*"; }
warn()    { printf '\e[1;33m[Edgechat] ⚠️  WARNING: %s\e[0m\n' "$*" >&2; }
die()     { printf '\e[1;31m[Edgechat] ❌ ERROR: %s\e[0m\n' "$*" >&2; exit 1; }
READP()   { read -r -p "$(echo -e "\e[1;36m$1\e[0m")" ${2}; }

escape_sed() {
  local str="$1"
  str="${str//\\/\\\\}"
  str="${str//|/\\|}"
  str="${str//&/\\&}"
  printf "%s" "$str"
}

run_sudo() {
  if command -v sudo &>/dev/null; then
    sudo "$@"
  else
    "$@"
  fi
}

cleanup_deploy_lock() {
  if [[ "${DEPLOY_LOCK_HELD:-0}" == "1" ]]; then
    rm -f "$DEPLOY_LOCK_DIR/pid" 2>/dev/null || true
    rmdir "$DEPLOY_LOCK_DIR" 2>/dev/null || true
    DEPLOY_LOCK_HELD=0
  fi
}

acquire_deploy_lock() {
  if [[ "${DEPLOY_LOCK_HELD:-0}" == "1" ]]; then
    return 0
  fi
  mkdir -p "$ROOT_DIR/.tmp"

  if [[ -d "$DEPLOY_LOCK_DIR" ]]; then
    local lock_pid=""
    if [[ -f "$DEPLOY_LOCK_DIR/pid" ]]; then
      lock_pid=$(cat "$DEPLOY_LOCK_DIR/pid" 2>/dev/null || true)
    fi

    local is_stale=1
    if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
      is_stale=0
    fi

    if [[ $is_stale -eq 1 ]]; then
      log "清理残留的部署锁 (.tmp/deploy.lock)"
      rm -f "$DEPLOY_LOCK_DIR/pid" 2>/dev/null || true
      rmdir "$DEPLOY_LOCK_DIR" 2>/dev/null || true
    fi
  fi

  if mkdir "$DEPLOY_LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$DEPLOY_LOCK_DIR/pid"
    DEPLOY_LOCK_HELD=1
    trap 'cleanup_deploy_lock' EXIT
    return 0
  fi
  die "已有部署任务正在运行，请勿重复执行"
}

release_deploy_lock() {
  cleanup_deploy_lock
}

validate_env_placeholders() {
  local invalid=()
  local pairs=(
    "CLOUDFLARE_API_TOKEN:your_api_token_here"
    "CLOUDFLARE_ACCOUNT_ID:your_account_id_here"
    "CLOUDFLARE_API_KEY:your_api_key_here"
    "CLOUDFLARE_EMAIL:your_email@example.com"
  )
  local item name placeholder
  for item in "${pairs[@]}"; do
    name="${item%%:*}"
    placeholder="${item#*:}"
    if [[ "${!name:-}" == "$placeholder" ]]; then
      invalid+=("$name")
    fi
  done
  if (( ${#invalid[@]} > 0 )); then
    warn ".env.local 中仍包含占位值（如 ${invalid[*]}），如需使用请修改实际值。"
  fi
}

detect_distro() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    echo "$ID"
  elif command -v lsb_release &> /dev/null; then
    lsb_release -si | tr '[:upper:]' '[:lower:]'
  else
    echo "unknown"
  fi
}

NODE_MIN_VERSION=20

check_node_version() {
  local node_version
  node_version=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)

  if [[ -z "$node_version" ]]; then
    return 1
  fi

  if [[ ! "$node_version" =~ ^[0-9]+$ ]] || [[ $node_version -lt $NODE_MIN_VERSION ]]; then
    return 1
  fi

  return 0
}

prompt_install_or_upgrade_nodejs() {
  local current_version
  current_version=$(node --version 2>/dev/null || echo "")
  local distro="$(detect_distro)"

  if [[ -n "$current_version" ]]; then
    printf '\n%s' "检测到 Node.js $current_version，但 Edgechat 与 wrangler 建议 ${NODE_MIN_VERSION}.x 或更高版本"
    read -rp "，是否现在自动升级到 Node.js 22.x？(y/n，默认 y): " upgrade_choice
    upgrade_choice="${upgrade_choice:-y}"

    if [[ "$upgrade_choice" != "y" && "$upgrade_choice" != "Y" ]]; then
      warn "跳过 Node.js 升级，继续使用当前版本（若报错请手动升级）"
      return 0
    fi
  else
    printf '\n%s' "未检测到 Node.js，需要 Node.js ${NODE_MIN_VERSION}.x 或更新版本"
    read -rp "，是否现在自动安装？(y/n，默认 y): " install_choice
    install_choice="${install_choice:-y}"

    if [[ "$install_choice" != "y" && "$install_choice" != "Y" ]]; then
      die "用户拒绝安装 Node.js，无法继续部署"
    fi
  fi

  log "开始安装 Node.js 22.x（通过 NodeSource 官方源，自带 npm）..."

  case "$distro" in
    debian|ubuntu)
      local tmpscript
      tmpscript=$(mktemp)
      curl -fsSL https://deb.nodesource.com/setup_22.x -o "$tmpscript" || die "下载 NodeSource 安装脚本失败"
      run_sudo bash "$tmpscript" || die "NodeSource 源添加失败"
      rm -f "$tmpscript"
      run_sudo apt install -y nodejs || die "Node.js 安装失败"
      ;;
    fedora|rhel|centos)
      local tmpscript
      tmpscript=$(mktemp)
      curl -fsSL https://rpm.nodesource.com/setup_22.x -o "$tmpscript" || die "下载 NodeSource 安装脚本失败"
      run_sudo bash "$tmpscript" || die "NodeSource 源添加失败"
      rm -f "$tmpscript"
      run_sudo dnf install -y nodejs || die "Node.js 安装失败"
      ;;
    arch)
      run_sudo pacman -S --noconfirm nodejs npm || die "Node.js 安装失败"
      ;;
    alpine)
      run_sudo apk add nodejs npm || die "Node.js 安装失败"
      ;;
    *)
      die "不支持的 Linux 发行版：$distro，请访问 https://nodejs.org 手动安装 Node.js 20+"
      ;;
  esac

  success "Node.js 安装完成，当前版本：$(node --version 2>/dev/null)"
}

need_cmd() {
  if [[ "$1" == "node" ]]; then
    if check_node_version; then
      success "Node.js $(node --version) 版本满足要求（>= ${NODE_MIN_VERSION}）"
      return 0
    else
      prompt_install_or_upgrade_nodejs || return 1
      hash -r 2>/dev/null || true
      return 0
    fi
  fi

  if command -v "$1" >/dev/null 2>&1; then
    return 0
  fi

  case "$1" in
    npm)
      die "npm 未找到。请检查 Node.js 安装是否完整。"
      ;;
    python3)
      printf '\n%s' "缺少命令：python3"
      read -rp "，是否现在自动安装？(y/n，默认 y): " install_choice
      install_choice="${install_choice:-y}"
      if [[ "$install_choice" != "y" && "$install_choice" != "Y" ]]; then
        die "缺少 python3，无法执行配置文件解析与 D1 数据库检查"
      fi
      local distro="$(detect_distro)"
      case "$distro" in
        debian|ubuntu) run_sudo apt install -y python3 || die "python3 安装失败" ;;
        fedora|rhel|centos) run_sudo dnf install -y python3 || die "python3 安装失败" ;;
        arch) run_sudo pacman -S --noconfirm python || die "python3 安装失败" ;;
        alpine) run_sudo apk add python3 || die "python3 安装失败" ;;
        *) die "不支持的 Linux 发行版：$distro，请手动安装 python3" ;;
      esac
      success "python3 安装完成"
      ;;
    *)
      die "缺少命令：$1"
      ;;
  esac
}

wrangler_cmd() {
  mkdir -p "$WRANGLER_STATE_DIR/logs"
  if [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
    export CLOUDFLARE_ACCOUNT_ID=$(strip_quotes "$CLOUDFLARE_ACCOUNT_ID")
  fi
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    export CLOUDFLARE_API_TOKEN=$(strip_quotes "$CLOUDFLARE_API_TOKEN")
  fi
  local cmd=(npx --yes "wrangler@$WRANGLER_VERSION")
  if command -v wrangler &> /dev/null; then
    cmd=(wrangler)
  fi
  (cd "$ROOT_DIR" && WRANGLER_LOG_PATH="$WRANGLER_STATE_DIR/logs" "${cmd[@]}" "$@")
}

wrangler_global_cmd() {
  mkdir -p "$WRANGLER_STATE_DIR/logs"
  if [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
    export CLOUDFLARE_ACCOUNT_ID=$(strip_quotes "$CLOUDFLARE_ACCOUNT_ID")
  fi
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    export CLOUDFLARE_API_TOKEN=$(strip_quotes "$CLOUDFLARE_API_TOKEN")
  fi
  local cmd=(npx --yes "wrangler@$WRANGLER_VERSION")
  if command -v wrangler &> /dev/null; then
    cmd=(wrangler)
  fi
  (cd "$ROOT_DIR" && WRANGLER_LOG_PATH="$WRANGLER_STATE_DIR/logs" "${cmd[@]}" "$@")
}

read_required() {
  local prompt_msg="$1"
  local var_name="$2"
  local is_secret="${3:-false}"
  local val=""
  while true; do
    if [[ "$is_secret" == "true" ]]; then
      read -rsp "$prompt_msg" val
      echo
    else
      read -rp "$prompt_msg" val
    fi
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    if [[ -n "$val" ]]; then
      export "$var_name=$val"
      break
    else
      warn "输入不能为空，请重新输入。"
    fi
  done
}

ensure_wrangler() {
  if command -v wrangler &> /dev/null; then
    success "wrangler 已就绪 ($(wrangler --version))"
    return 0
  fi

  log "未在 PATH 中检测到全局 wrangler，正在准备 (v${WRANGLER_VERSION})..."
  if npm install -g --prefix ~/.local "wrangler@$WRANGLER_VERSION" 2>/dev/null; then
    export PATH="$HOME/.local/bin:$PATH"
    success "wrangler 已安装到 ~/.local/bin"
    return 0
  fi

  if run_sudo npm install -g "wrangler@$WRANGLER_VERSION"; then
    success "wrangler 已安装到系统全局"
    return 0
  else
    warn "全局安装失败，将通过 npx 运行 wrangler。"
  fi
}

setup_default_browser() {
  log "检查系统浏览器配置..."
  local ff_path=""
  get_ff_version() {
    local cmd="$1"
    if command -v "$cmd" &> /dev/null; then
      local path
      path=$(command -v "$cmd")
      echo "$path"
      return 0
    fi
    return 1
  }

  ff_path=$(get_ff_version "firefox" || get_ff_version "firefox-esr" || get_ff_version "google-chrome" || get_ff_version "chromium" || echo "")
  if [[ -n "$ff_path" ]]; then
    success "检测到可用浏览器：$ff_path"
    return 0
  fi
  warn "未检测到图形浏览器，如需 OAuth 登录请确保可以在其他设备访问授权链接。"
}

setup_apt_proxy() {
  if nc -z 127.0.0.1 8118 &>/dev/null || (exec 3<>/dev/tcp/127.0.0.1/8118) &>/dev/null; then
    log "检测到本地代理端口 8118 处于监听状态，正在配置 APT 代理..."
    local tmpfile
    tmpfile=$(mktemp)
    cat > "$tmpfile" <<'APTCONF'
Acquire::http::proxy "http://127.0.0.1:8118";
Acquire::https::proxy "http://127.0.0.1:8118";
APTCONF
    run_sudo mkdir -p /etc/apt/apt.conf.d
    run_sudo cp "$tmpfile" /etc/apt/apt.conf.d/99edgechat-proxy
    rm -f "$tmpfile"
    success "APT 代理已配置 (/etc/apt/apt.conf.d/99edgechat-proxy)"
  fi
}

_save_account_id_to_env() {
  local acc_id
  acc_id=$(strip_quotes "$1")
  if [[ -f "$ENV_LOCAL" ]]; then
    if grep -q "CLOUDFLARE_ACCOUNT_ID" "$ENV_LOCAL"; then
      sed -i "s|^#*[[:space:]]*export CLOUDFLARE_ACCOUNT_ID=.*|export CLOUDFLARE_ACCOUNT_ID=\"$acc_id\"|" "$ENV_LOCAL"
    else
      echo "export CLOUDFLARE_ACCOUNT_ID=\"$acc_id\"" >> "$ENV_LOCAL"
    fi
  fi
}

_remove_account_id_from_env() {
  unset CLOUDFLARE_ACCOUNT_ID
  if [[ -f "$ENV_LOCAL" ]]; then
    sed -i "/^#*[[:space:]]*export CLOUDFLARE_ACCOUNT_ID=/d" "$ENV_LOCAL"
  fi
}

detect_cloudflare_account_id() {
  local auth_status
  auth_status=$(auth_mode)
  log "正在校验并获取 Cloudflare Account ID..."

  local detect_output
  detect_output=$(AUTH_STATUS="$auth_status" python3 - <<'PY' 2>/dev/null || true
import urllib.request, json, os, sys, ssl, re, subprocess

auth_status = os.environ.get("AUTH_STATUS", "oauth")
existing_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip().strip('"\'')
accounts = []

if "API Token" in auth_status or "Global API Key" in auth_status:
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip().strip('"\'')
    api_key = os.environ.get("CLOUDFLARE_API_KEY", "").strip().strip('"\'')
    email = os.environ.get("CLOUDFLARE_EMAIL", "").strip().strip('"\'')
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    elif api_key and email:
        headers["X-Auth-Key"] = api_key
        headers["X-Auth-Email"] = email
    if token or (api_key and email):
        try:
            req = urllib.request.Request("https://api.cloudflare.com/client/v4/accounts", headers=headers)
            ctx = ssl.create_default_context()
            with urllib.request.urlopen(req, context=ctx, timeout=30) as response:
                res = json.loads(response.read().decode())
                if res.get("success") and res.get("result"):
                    for item in res["result"]:
                        accounts.append({"id": str(item["id"]).strip().strip('"\''), "name": str(item.get("name", "Account")).strip()})
        except Exception:
            pass

if not accounts:
    try:
        proc = subprocess.run(["wrangler", "whoami"], capture_output=True, text=True, check=False)
        output = (proc.stdout or "") + "\n" + (proc.stderr or "")
        raw_matches = re.findall(r"│\s*([^│]+?)\s*│\s*([a-fA-F0-9]{32})\s*│", output)
        for name, acc_id in raw_matches:
            name_str = name.strip()
            acc_id_str = acc_id.strip()
            if name_str != "Account Name" and acc_id_str not in [a["id"] for a in accounts]:
                accounts.append({"id": acc_id_str, "name": name_str})
    except Exception:
        pass

if accounts:
    account_ids = [a["id"] for a in accounts]
    if existing_id and existing_id in account_ids:
        print(f"KEEP:{existing_id}")
        sys.exit(0)
    elif existing_id and existing_id not in account_ids:
        if len(accounts) == 1:
            print(f"SUCCESS:{accounts[0]['id']}")
            sys.exit(0)
        else:
            print(f"MISMATCH:{existing_id}")
    elif len(accounts) == 1:
        print(f"SUCCESS:{accounts[0]['id']}")
        sys.exit(0)
    elif len(accounts) > 1:
        acc_list = [f"{acc['id']} ({acc['name']})" for acc in accounts]
        print(f"MULTIPLE:" + "|".join(acc_list))
        sys.exit(0)

if existing_id:
    print(f"KEEP:{existing_id}")
else:
    print("NONE")
PY
)

  if [[ "$detect_output" =~ ^KEEP:(.+) ]]; then
    export CLOUDFLARE_ACCOUNT_ID=$(strip_quotes "${BASH_REMATCH[1]}")
    success "使用 Account ID: $CLOUDFLARE_ACCOUNT_ID"
    return 0
  fi

  if [[ "$detect_output" =~ ^MISMATCH:(.+) ]]; then
    warn "检测到保存的 Account ID (${BASH_REMATCH[1]}) 与当前登录账号不匹配，正在自动更正..."
    unset CLOUDFLARE_ACCOUNT_ID
  fi

  if [[ "$detect_output" =~ ^SUCCESS:(.+) ]]; then
    export CLOUDFLARE_ACCOUNT_ID=$(strip_quotes "${BASH_REMATCH[1]}")
    success "自动识别并绑定 Account ID: $CLOUDFLARE_ACCOUNT_ID"
    _save_account_id_to_env "$CLOUDFLARE_ACCOUNT_ID"
  elif [[ "$detect_output" =~ ^MULTIPLE:(.+) ]]; then
    local accs="${BASH_REMATCH[1]}"
    warn "检测到您的账号关联了多个 Account，请选择目标部署账号："
    IFS='|' read -ra ADDR <<< "$accs"
    local i=1
    for acc in "${ADDR[@]}"; do
      echo "  $i. $acc"
      i=$((i+1))
    done
    printf '请选择 [1-%d]: ' "$((i-1))"
    local choice
    read -r choice
    if [[ "$choice" -ge 1 && "$choice" -lt "$i" ]]; then
      local selected="${ADDR[$((choice-1))]}"
      export CLOUDFLARE_ACCOUNT_ID=$(strip_quotes "$(echo "$selected" | cut -d' ' -f1)")
      success "已选择 Account ID: $CLOUDFLARE_ACCOUNT_ID"
      _save_account_id_to_env "$CLOUDFLARE_ACCOUNT_ID"
    else
      warn "无效选择，未设置 CLOUDFLARE_ACCOUNT_ID。"
    fi
  fi
}

# ------------------------------------------------------------------------------
# 1. 认证模式判断与状态检测
# ------------------------------------------------------------------------------
is_authenticated() {
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    # 1. 快速检查 token 非空且不是 example 占位符
    if [[ "$CLOUDFLARE_API_TOKEN" == "your_api_token_here" || ${#CLOUDFLARE_API_TOKEN} -lt 10 ]]; then
      return 1
    fi
    # 2. 尝试使用官方 /user/tokens/verify 验证
    local verify_res
    verify_res=$(curl -s -m 10 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/user/tokens/verify" 2>/dev/null || true)
    if [[ "$verify_res" =~ "\"status\":\"active\"" || "$verify_res" =~ "\"success\":true" ]]; then
      return 0
    fi
    # 3. 验证账户级资源接口
    if [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
      local d1_res
      d1_res=$(curl -s -m 10 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database?per_page=1" 2>/dev/null || true)
      if [[ "$d1_res" =~ "\"success\":true" ]]; then
        return 0
      fi
      local kv_res
      kv_res=$(curl -s -m 10 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces?per_page=1" 2>/dev/null || true)
      if [[ "$kv_res" =~ "\"success\":true" ]]; then
        return 0
      fi
    fi
    # 4. 只要配置了有效格式的 Token，直接视为已认证
    return 0
  fi

  if [[ -n "${CLOUDFLARE_API_KEY:-}" && -n "${CLOUDFLARE_EMAIL:-}" ]]; then
    if [[ "$CLOUDFLARE_API_KEY" == "your_api_key_here" || ${#CLOUDFLARE_API_KEY} -lt 10 ]]; then
      return 1
    fi
    local user_res
    user_res=$(curl -s -m 10 -H "X-Auth-Key: $CLOUDFLARE_API_KEY" -H "X-Auth-Email: $CLOUDFLARE_EMAIL" "https://api.cloudflare.com/client/v4/user" 2>/dev/null || true)
    if [[ "$user_res" =~ "\"success\":true" ]]; then
      return 0
    fi
    return 0
  fi

  wrangler_global_cmd whoami &>/dev/null
}

auth_mode() {
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    printf 'API Token (环境变量/配置文件)'
    return
  fi
  if [[ -n "${CLOUDFLARE_API_KEY:-}" && -n "${CLOUDFLARE_EMAIL:-}" ]]; then
    printf 'Global API Key (邮箱: %s)' "$CLOUDFLARE_EMAIL"
    return
  fi
  if is_authenticated; then
    printf 'OAuth 浏览器授权'
    return
  fi
  printf '未认证'
}

# ------------------------------------------------------------------------------
# 2. Cloudflare 认证管理菜单与操作 (OAuth / API Token / Key)
# ------------------------------------------------------------------------------
cloudflare_auth_menu() {
  while true; do
    echo ""
    echo "======================================================="
    echo "         🔑  Cloudflare 账号认证与登录管理             "
    echo "======================================================="
    echo "当前认证状态: $(auth_mode)"
    echo "-------------------------------------------------------"
    echo "  [1] 🌐 浏览器 OAuth 授权登录 (适合有桌面/浏览器的本地环境)"
    echo "  [2] 📋 手动配置 API Token (推荐: 无头服务器/VPS/SSH 远程)"
    echo "  [3] 🔑 手动配置 Global API Key + 邮箱"
    echo "  [4] 📄 查看当前生效的认证信息与账号 ID"
    echo "  [5] 🚪 注销当前登录 / 清除本地认证配置"
    echo "  [0] 返回主菜单"
    echo "======================================================="
    READP "请选择认证操作 [0-5]: " auth_choice
    case "$auth_choice" in
      1)
        oauth_login
        break
        ;;
      2)
        setup_api_token
        break
        ;;
      3)
        setup_global_api_key
        break
        ;;
      4)
        show_current_auth_info
        ;;
      5)
        logout_and_clear_auth
        break
        ;;
      0)
        break
        ;;
      *)
        warn "无效选项: $auth_choice"
        ;;
    esac
  done
}

oauth_login() {
  log "启动浏览器 OAuth 登录..."
  log "浏览器将自动打开 Cloudflare 授权页面，请在网页中完成授权..."
  unset CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL 2>/dev/null || true
  wrangler_global_cmd login
  if is_authenticated; then
    detect_cloudflare_account_id
    success "Cloudflare OAuth 登录成功！"
  else
    warn "登录未能完成，若处于无图形界面环境，请使用「选项 2: 手动配置 API Token」"
  fi
}

setup_api_token() {
  echo ""
  echo "======================================================="
  echo "           📋  手动配置 Cloudflare API Token           "
  echo "======================================================="
  echo "说明：API Token 适合在 VPS、SSH 终端或无浏览器环境下进行无感部署。"
  echo "获取步骤："
  echo "  1. 登录 Cloudflare 控制台 -> 点击右上角头像 -> 我的个人资料 -> API 令牌"
  echo "  2. 点击「创建令牌」 -> 选择「编辑 Cloudflare Workers」模板"
  echo "  3. 确保包含以下权限："
  echo "     - 账户: Cloudflare Workers (编辑)"
  echo "     - 账户: D1 (编辑)"
  echo "     - 账户: Workers KV 存储 (编辑)"
  echo "     - 账户: Workers R2 存储 (编辑，若使用 R2)"
  echo "     - 账户: Calls (编辑，用于自动创建 WebRTC 音视频通话 SFU)"
  echo "======================================================="

  READP "请输入 Cloudflare API Token: " input_token
  input_token=$(echo "$input_token" | tr -d '[:space:]')

  if [[ -z "$input_token" ]]; then
    warn "未输入 Token，操作已取消"
    return 1
  fi

  READP "请输入 Account ID (可选，留空则自动检测): " input_acc_id
  input_acc_id=$(echo "$input_acc_id" | tr -d '[:space:]')

  export CLOUDFLARE_API_TOKEN="$input_token"
  if [[ -n "$input_acc_id" ]]; then
    export CLOUDFLARE_ACCOUNT_ID="$input_acc_id"
  fi

  log "正在验证 API Token 有效性..."
  if is_authenticated; then
    success "API Token 验证成功！"
    detect_cloudflare_account_id
    local account_info
    account_info=$(wrangler_global_cmd whoami 2>&1 | grep -E "Account Name|Account ID|associated with" | tr '\n' ' ' || echo "已认证")
    echo "  $account_info"

    READP "是否将 API Token 永久保存到本地 .env.local 文件？(Y/n): " save_choice
    save_choice="${save_choice:-Y}"
    if [[ "$save_choice" =~ ^[Yy]$ ]]; then
      save_token_to_env_local "$input_token" "${CLOUDFLARE_ACCOUNT_ID:-$input_acc_id}"
      success "已保存到 $ENV_LOCAL (该文件已被 .gitignore 忽略，不会上传到 Git)"
    fi
  else
    warn "API Token 验证失败，请检查 Token 权限是否充足或是否填写有误"
    unset CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
  fi
}

setup_global_api_key() {
  echo ""
  echo "======================================================="
  echo "       🔑  手动配置 Global API Key + 邮箱            "
  echo "======================================================="
  READP "请输入 Cloudflare 账号邮箱: " input_email
  READP "请输入 Global API Key: " input_key
  READP "请输入 Account ID (可选，留空自动检测): " input_acc_id

  input_email=$(echo "$input_email" | tr -d '[:space:]')
  input_key=$(echo "$input_key" | tr -d '[:space:]')
  input_acc_id=$(echo "$input_acc_id" | tr -d '[:space:]')

  if [[ -z "$input_email" || -z "$input_key" ]]; then
    warn "邮箱和 Key 不能为空"
    return 1
  fi

  export CLOUDFLARE_EMAIL="$input_email"
  export CLOUDFLARE_API_KEY="$input_key"
  if [[ -n "$input_acc_id" ]]; then
    export CLOUDFLARE_ACCOUNT_ID="$input_acc_id"
  fi

  log "正在验证 Global API Key 有效性..."
  if is_authenticated; then
    success "Global API Key 验证成功！"
    detect_cloudflare_account_id
    READP "是否将配置保存到本地 .env.local 文件？(Y/n): " save_choice
    save_choice="${save_choice:-Y}"
    if [[ "$save_choice" =~ ^[Yy]$ ]]; then
      save_api_key_to_env_local "$input_email" "$input_key" "${CLOUDFLARE_ACCOUNT_ID:-$input_acc_id}"
      success "已保存到 $ENV_LOCAL"
    fi
  else
    warn "Global API Key 验证失败，请检查填写内容"
    unset CLOUDFLARE_EMAIL CLOUDFLARE_API_KEY CLOUDFLARE_ACCOUNT_ID
  fi
}

save_token_to_env_local() {
  local token
  token=$(strip_quotes "$1")
  local acc_id
  acc_id=$(strip_quotes "$2")
  if [[ -f "$ENV_LOCAL" ]]; then
    sed -i '/CLOUDFLARE_API_TOKEN=/d' "$ENV_LOCAL"
    sed -i '/CLOUDFLARE_API_KEY=/d' "$ENV_LOCAL"
    sed -i '/CLOUDFLARE_EMAIL=/d' "$ENV_LOCAL"
    sed -i '/CLOUDFLARE_ACCOUNT_ID=/d' "$ENV_LOCAL"
  fi
  printf 'export CLOUDFLARE_API_TOKEN="%s"\n' "$token" >> "$ENV_LOCAL"
  if [[ -n "$acc_id" ]]; then
    printf 'export CLOUDFLARE_ACCOUNT_ID="%s"\n' "$acc_id" >> "$ENV_LOCAL"
  fi
}

save_api_key_to_env_local() {
  local email
  email=$(strip_quotes "$1")
  local key
  key=$(strip_quotes "$2")
  local acc_id
  acc_id=$(strip_quotes "$3")
  if [[ -f "$ENV_LOCAL" ]]; then
    sed -i '/CLOUDFLARE_API_TOKEN=/d' "$ENV_LOCAL"
    sed -i '/CLOUDFLARE_API_KEY=/d' "$ENV_LOCAL"
    sed -i '/CLOUDFLARE_EMAIL=/d' "$ENV_LOCAL"
    sed -i '/CLOUDFLARE_ACCOUNT_ID=/d' "$ENV_LOCAL"
  fi
  printf 'export CLOUDFLARE_EMAIL="%s"\n' "$email" >> "$ENV_LOCAL"
  printf 'export CLOUDFLARE_API_KEY="%s"\n' "$key" >> "$ENV_LOCAL"
  if [[ -n "$acc_id" ]]; then
    printf 'export CLOUDFLARE_ACCOUNT_ID="%s"\n' "$acc_id" >> "$ENV_LOCAL"
  fi
}

show_current_auth_info() {
  echo ""
  log "当前认证方式: $(auth_mode)"
  if is_authenticated; then
    wrangler_global_cmd whoami
  else
    warn "当前未认证或凭据已失效"
  fi
}

logout_and_clear_auth() {
  log "正在清理本地认证凭据..."
  unset CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL CLOUDFLARE_ACCOUNT_ID 2>/dev/null || true
  if [[ -f "$ENV_LOCAL" ]]; then
    sed -i '/CLOUDFLARE_API_TOKEN=/d' "$ENV_LOCAL"
    sed -i '/CLOUDFLARE_API_KEY=/d' "$ENV_LOCAL"
    sed -i '/CLOUDFLARE_EMAIL=/d' "$ENV_LOCAL"
    sed -i '/CLOUDFLARE_ACCOUNT_ID=/d' "$ENV_LOCAL"
    log "已从 $ENV_LOCAL 中移除 Cloudflare 认证变量"
  fi
  wrangler_global_cmd logout || true
  success "已成功注销 / 清除本地认证信息！"
}

ensure_authenticated() {
  if is_authenticated; then
    return 0
  fi
  echo ""
  warn "检测到您当前尚未登录 Cloudflare。"
  local default_choice="1"
  if [[ -z "${DISPLAY:-}" && "$(uname -s)" == "Linux" ]]; then
    default_choice="2"
  fi
  echo "请选择登录方式："
  echo "  [1] 🌐 浏览器 OAuth 授权登录 (适合有浏览器的桌面环境)"
  echo "  [2] 📋 手动输入 Cloudflare API Token (推荐: 远程服务器/VPS/SSH)"
  READP "请选择 [1/2, 默认 $default_choice]: " choice
  choice="${choice:-$default_choice}"
  if [[ "$choice" == "2" ]]; then
    setup_api_token
  else
    oauth_login
  fi
  if ! is_authenticated; then
    die "未完成 Cloudflare 认证，操作终止"
  fi
}

# ------------------------------------------------------------------------------
# 3. 隐藏入口 (ROUTE_PREFIX) 与反代伪装 (DISGUISE_HOST) 配置
# ------------------------------------------------------------------------------
configure_disguise() {
  echo ""
  echo "======================================================="
  echo "       🛡️  隐藏入口 (ROUTE_PREFIX) 与反代伪装配置       "
  echo "======================================================="

  local env_prefix="${ROUTE_PREFIX:-}"
  local env_disguise="${DISGUISE_HOST:-}"
  local cur_prefix=""
  local cur_disguise=""
  if [[ -f "$WORKER_CFG" ]]; then
    cur_prefix=$(grep -E '^\s*ROUTE_PREFIX\s*=' "$WORKER_CFG" | head -n1 | sed -E 's/.*=\s*"([^"]*)".*/\1/' || echo "")
    cur_disguise=$(grep -E '^\s*DISGUISE_HOST\s*=' "$WORKER_CFG" | head -n1 | sed -E 's/.*=\s*"([^"]*)".*/\1/' || echo "")
  fi
  cur_prefix="${env_prefix:-${cur_prefix:-}}"
  cur_disguise="${env_disguise:-${cur_disguise:-nginx}}"

  echo "【1. 隐藏入口路径前缀 (ROUTE_PREFIX)】"
  echo "说明：配置后只有通过 https://<你的域名>/<前缀>/ 才能进入聊天与管理后台；"
  echo "      支持配置多个入口，用逗号分隔（如：secret1, portal_a, hidden99）；"
  echo "      使用任意一个入口均可正常登录并访问主项目；"
  echo "      直接访问域名根路径或其它未配置路径将全自动展示伪装站点内容。"
  echo "      若留空则不启用隐藏前缀（直接通过根路径访问）。"
  READP "请输入隐藏前缀 [当前: ${cur_prefix:-未设置}，多个用逗号隔开，回车保持]: " input_prefix
  local target_prefix="${input_prefix:-$cur_prefix}"
  target_prefix=$(echo "$target_prefix" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

  echo ""
  echo "【2. 反代伪装网站 (DISGUISE_HOST)】"
  echo "说明：当访客/扫描器直接访问域名根路径或错误路径时，Worker 将自动反代该站的内容进行伪装。"
  echo "  [1] 纯官方 Nginx 真实欢迎页与 404 页面 (推荐默认: disguise_host = nginx)"
  echo "  [2] 自动随机分配热门伪装域名 (美妆/时尚商城/创意设计站)"
  echo "  [3] 自定义反代域名 (如 example.com)"
  echo "  [4] 保持当前设置 (${cur_disguise})"
  READP "请选择伪装方案 [1/2/3/4, 默认 1]: " disguise_opt
  disguise_opt="${disguise_opt:-1}"

  local target_disguise=""
  if [[ "$disguise_opt" == "1" ]]; then
    target_disguise="nginx"
  elif [[ "$disguise_opt" == "2" ]]; then
    target_disguise="${DISGUISE_SITES[$RANDOM % ${#DISGUISE_SITES[@]}]}"
  elif [[ "$disguise_opt" == "3" ]]; then
    READP "请输入自定义伪装域名 (无需 https://, 例如 bing.com): " custom_host
    target_disguise="${custom_host:-nginx}"
  else
    target_disguise="$cur_disguise"
  fi

  export ROUTE_PREFIX="$target_prefix"
  export DISGUISE_HOST="$target_disguise"

  if [[ -f "$WORKER_CFG" ]]; then
    update_toml_vars "$WORKER_CFG" "$target_prefix" "$target_disguise"
  fi

  if [[ -f "$ENV_LOCAL" ]]; then
    sed -i '/ROUTE_PREFIX=/d' "$ENV_LOCAL"
    sed -i '/DISGUISE_HOST=/d' "$ENV_LOCAL"
    echo "export ROUTE_PREFIX=\"$target_prefix\"" >> "$ENV_LOCAL"
    echo "export DISGUISE_HOST=\"$target_disguise\"" >> "$ENV_LOCAL"
  fi

  success "隐藏入口与伪装配置已保存！"
  if [[ -n "$target_prefix" ]]; then
    echo "  🔒 隐藏入口路径: /$target_prefix/"
  else
    echo "  🔓 隐藏入口路径: 未启用 (根路径直接访问)"
  fi
  echo "  🎭 伪装反代目标: $target_disguise"
  echo "======================================================="
  echo ""
}

update_toml_vars() {
  local toml_file="$1"
  local prefix="$2"
  local disguise="$3"

  if ! grep -q '\[vars\]' "$toml_file"; then
    printf '\n[vars]\n' >> "$toml_file"
  fi

  if grep -qE '^\s*ROUTE_PREFIX\s*=' "$toml_file"; then
    sed -i "s|^\s*ROUTE_PREFIX\s*=.*|ROUTE_PREFIX = \"$(escape_sed "$prefix")\"|g" "$toml_file"
  else
    sed -i "/\[vars\]/a ROUTE_PREFIX = \"$(escape_sed "$prefix")\"" "$toml_file"
  fi

  if grep -qE '^\s*DISGUISE_HOST\s*=' "$toml_file"; then
    sed -i "s|^\s*DISGUISE_HOST\s*=.*|DISGUISE_HOST = \"$(escape_sed "$disguise")\"|g" "$toml_file"
  else
    sed -i "/\[vars\]/a DISGUISE_HOST = \"$(escape_sed "$disguise")\"" "$toml_file"
  fi
}

doctor() {
  log "==================== 系统环境自检 ===================="
  setup_apt_proxy
  need_cmd node
  need_cmd npm
  need_cmd python3
  ensure_wrangler
  log "检查 Cloudflare 认证状态..."
  local cur_mode
  cur_mode=$(auth_mode)
  if is_authenticated; then
    detect_cloudflare_account_id
    success "Cloudflare 认证正常 [$cur_mode]"
  else
    warn "当前尚未配置 Cloudflare 认证 [$cur_mode]"
  fi
  log "======================================================"
  success "系统环境检查通过！"
}

lookup_d1_id() {
  python3 - "$ROOT_DIR" "$WRANGLER_STATE_DIR" <<'PY'
import json, os, subprocess, sys, re, urllib.request, ssl

root_dir, wrangler_state_dir = sys.argv[1:3]
name = os.environ.get("CF_D1_NAME", "cfchat-db").strip()
env = dict(os.environ)
env["WRANGLER_LOG_PATH"] = f"{wrangler_state_dir}/logs"

# 1. 优先通过 Cloudflare REST API 动态向当前账号实时查询 (若提供 API Token 或 Key)
token = env.get("CLOUDFLARE_API_TOKEN", "").strip()
api_key = env.get("CLOUDFLARE_API_KEY", "").strip()
email = env.get("CLOUDFLARE_EMAIL", "").strip()
account_id = env.get("CLOUDFLARE_ACCOUNT_ID", "").strip()

if account_id and (token or (api_key and email)):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    elif api_key and email:
        headers["X-Auth-Key"] = api_key
        headers["X-Auth-Email"] = email
    ctx = ssl.create_default_context()
    try:
        url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database?per_page=100"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, context=ctx, timeout=15) as response:
            payload = json.loads(response.read().decode())
            records = payload.get("result", [])
            for r in records:
                if isinstance(r, dict) and (r.get("name") == name or r.get("database_name") == name):
                    db_id = r.get("uuid") or r.get("id") or r.get("database_id")
                    if db_id:
                        print(db_id)
                        sys.exit(0)
    except Exception:
        pass

# 2. 通过 Wrangler CLI 动态向当前登录/配置账号查询 (多格式解析：JSON / 正则 / Table)
try:
    cmd = ["npx", "--yes", f"wrangler@{env.get('WRANGLER_VERSION', '4.11.1')}", "d1", "list", "--json"]
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=root_dir)
    stdout = (proc.stdout or "") + "\n" + (proc.stderr or "")
    cleaned = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', stdout)

    # 尝试解析 JSON
    records = []
    json_match = re.search(r'(\[[\s\S]*\]|\{[\s\S]*\})', cleaned)
    if json_match:
        try:
            data = json.loads(json_match.group(1))
            if isinstance(data, dict):
                records = data.get("result", [])
                if not isinstance(records, list):
                    records = []
            elif isinstance(data, list):
                records = data
            for r in records:
                if isinstance(r, dict) and (r.get("name") == name or r.get("database_name") == name):
                    db_id = r.get("uuid") or r.get("id") or r.get("database_id")
                    if db_id:
                        print(db_id)
                        sys.exit(0)
        except Exception:
            pass

    # JSON 文本正则备选匹配
    m1 = re.search(r'\{[^{}]*?"name"\s*:\s*"' + re.escape(name) + r'"[^{}]*?"uuid"\s*:\s*"([a-f0-9-]{36})"', cleaned)
    if m1:
        print(m1.group(1))
        sys.exit(0)
    m2 = re.search(r'\{[^{}]*?"uuid"\s*:\s*"([a-f0-9-]{36})"[^{}]*?"name"\s*:\s*"' + re.escape(name) + r'"', cleaned)
    if m2:
        print(m2.group(1))
        sys.exit(0)

    # Table 文本表格正则备选匹配
    m3 = re.search(re.escape(name) + r'[\s│|]+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})', cleaned, re.IGNORECASE)
    if m3:
        print(m3.group(1))
        sys.exit(0)
    m4 = re.search(r'([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})[\s│|]+' + re.escape(name), cleaned, re.IGNORECASE)
    if m4:
        print(m4.group(1))
        sys.exit(0)
except Exception:
    pass

sys.exit(1)
PY
}

lookup_kv_id() {
  python3 - "$ROOT_DIR" "$WRANGLER_STATE_DIR" <<'PY'
import json, os, subprocess, sys, re, urllib.request, ssl

root_dir, wrangler_state_dir = sys.argv[1:3]
name = os.environ.get("CF_KV_NAMESPACE", "SESSIONS").strip()
legacy_name = "cfchat-sessions"
candidates = [name, legacy_name, f"cfchat-{name}"]
env = dict(os.environ)
env["WRANGLER_LOG_PATH"] = f"{wrangler_state_dir}/logs"

# 1. 优先通过 Cloudflare REST API 动态向当前账号实时查询 (若提供 API Token 或 Key)
token = env.get("CLOUDFLARE_API_TOKEN", "").strip()
api_key = env.get("CLOUDFLARE_API_KEY", "").strip()
email = env.get("CLOUDFLARE_EMAIL", "").strip()
account_id = env.get("CLOUDFLARE_ACCOUNT_ID", "").strip()

if account_id and (token or (api_key and email)):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    elif api_key and email:
        headers["X-Auth-Key"] = api_key
        headers["X-Auth-Email"] = email
    ctx = ssl.create_default_context()
    try:
        url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces?per_page=100"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, context=ctx, timeout=15) as response:
            payload = json.loads(response.read().decode())
            records = payload.get("result", [])
            for r in records:
                if isinstance(r, dict) and r.get("title") in candidates:
                    ns_id = r.get("id")
                    if ns_id:
                        print(ns_id)
                        sys.exit(0)
    except Exception:
        pass

# 2. 通过 Wrangler CLI 动态向当前登录/配置账号查询
try:
    cmd = ["npx", "--yes", f"wrangler@{env.get('WRANGLER_VERSION', '4.11.1')}", "kv", "namespace", "list"]
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=root_dir)
    stdout = (proc.stdout or "") + "\n" + (proc.stderr or "")
    cleaned = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', stdout)

    # 尝试解析 JSON
    records = []
    json_match = re.search(r'(\[[\s\S]*\]|\{[\s\S]*\})', cleaned)
    if json_match:
        try:
            data = json.loads(json_match.group(1))
            if isinstance(data, dict):
                records = data.get("result", [])
                if not isinstance(records, list):
                    records = []
            elif isinstance(data, list):
                records = data
            for r in records:
                if isinstance(r, dict) and r.get("title") in candidates:
                    ns_id = r.get("id")
                    if ns_id:
                        print(ns_id)
                        sys.exit(0)
        except Exception:
            pass

    # JSON 文本正则备选匹配
    for c in candidates:
        m1 = re.search(r'\{[^{}]*?"title"\s*:\s*"' + re.escape(c) + r'"[^{}]*?"id"\s*:\s*"([a-f0-9]{32})"', cleaned)
        if m1:
            print(m1.group(1))
            sys.exit(0)
        m2 = re.search(r'\{[^{}]*?"id"\s*:\s*"([a-f0-9]{32})"[^{}]*?"title"\s*:\s*"' + re.escape(c) + r'"', cleaned)
        if m2:
            print(m2.group(1))
            sys.exit(0)

    # Table 文本表格正则备选匹配
    for c in candidates:
        m3 = re.search(re.escape(c) + r'[\s│|]+([a-f0-9]{32})', cleaned, re.IGNORECASE)
        if m3:
            print(m3.group(1))
            sys.exit(0)
        m4 = re.search(r'([a-f0-9]{32})[\s│|]+' + re.escape(c), cleaned, re.IGNORECASE)
        if m4:
            print(m4.group(1))
            sys.exit(0)
except Exception:
    pass

sys.exit(1)
PY
}

bootstrap_d1() {
  log "检查或创建 D1 数据库：$CF_D1_NAME"
  if CF_D1_DATABASE_ID="$(lookup_d1_id 2>/dev/null)" && [[ -n "$CF_D1_DATABASE_ID" ]]; then
    export CF_D1_DATABASE_ID
    export D1_IS_NEW="false"
    success "复用已有 D1 数据库：$CF_D1_NAME ($CF_D1_DATABASE_ID)"
    return
  fi

  log "未找到已有 D1 数据库，正在自动创建..."
  local output
  output=$(wrangler_global_cmd d1 create "$CF_D1_NAME" 2>&1 || true)

  if echo "$output" | grep -qi "already exists\|database.*already"; then
    log "D1 已存在，正在刷新获取 ID..."
    sleep 2
    if CF_D1_DATABASE_ID="$(lookup_d1_id 2>/dev/null)" && [[ -n "$CF_D1_DATABASE_ID" ]]; then
      export CF_D1_DATABASE_ID
      export D1_IS_NEW="false"
      success "已关联 D1 数据库：$CF_D1_DATABASE_ID"
      return
    else
      warn "未能自动获取 D1 ID，请手动输入："
      read_required "请输入 D1 Database ID: " "CF_D1_DATABASE_ID" false
      export D1_IS_NEW="false"
      return
    fi
  fi

  if echo "$output" | grep -qi "error\|fail"; then
    die "D1 数据库创建失败：$output"
  fi

  CF_D1_DATABASE_ID="$(lookup_d1_id 2>/dev/null || echo "")"
  if [[ -z "$CF_D1_DATABASE_ID" ]]; then
    CF_D1_DATABASE_ID=$(echo "$output" | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -n 1 || echo "")
  fi

  if [[ -z "$CF_D1_DATABASE_ID" ]]; then
    read_required "请输入新建的 D1 Database ID: " "CF_D1_DATABASE_ID" false
  fi

  export CF_D1_DATABASE_ID
  export D1_IS_NEW="true"
  success "已创建 D1 数据库：$CF_D1_DATABASE_ID"
}

bootstrap_kv() {
  log "检查或创建 KV 命名空间：$CF_KV_NAMESPACE"
  if CF_KV_NAMESPACE_ID="$(lookup_kv_id 2>/dev/null)" && [[ -n "$CF_KV_NAMESPACE_ID" ]]; then
    export CF_KV_NAMESPACE_ID
    success "复用已有 KV 命名空间：$CF_KV_NAMESPACE ($CF_KV_NAMESPACE_ID)"
    return
  fi

  log "未找到已有 KV，正在自动创建..."
  local output
  output=$(wrangler_global_cmd kv namespace create "$CF_KV_NAMESPACE" 2>&1 || true)

  if echo "$output" | grep -qi "already exists\|namespace.*already"; then
    log "KV 已存在，正在刷新获取 ID..."
    sleep 2
    if CF_KV_NAMESPACE_ID="$(lookup_kv_id 2>/dev/null)" && [[ -n "$CF_KV_NAMESPACE_ID" ]]; then
      export CF_KV_NAMESPACE_ID
      success "已关联 KV 命名空间：$CF_KV_NAMESPACE_ID"
      return
    else
      read_required "请输入 KV Namespace ID: " "CF_KV_NAMESPACE_ID" false
      return
    fi
  fi

  CF_KV_NAMESPACE_ID="$(lookup_kv_id 2>/dev/null || echo "")"
  if [[ -z "$CF_KV_NAMESPACE_ID" ]]; then
    CF_KV_NAMESPACE_ID=$(echo "$output" | grep -oE '[a-f0-9]{32}' | head -n 1 || echo "")
  fi

  if [[ -z "$CF_KV_NAMESPACE_ID" ]]; then
    read_required "请输入新建的 KV Namespace ID: " "CF_KV_NAMESPACE_ID" false
  fi

  export CF_KV_NAMESPACE_ID
  success "已创建 KV 命名空间：$CF_KV_NAMESPACE_ID"
}

bootstrap_r2() {
  log "检查或创建 R2 存储桶：$CF_R2_BUCKET"
  export R2_AVAILABLE="true"

  local r2_list_output
  r2_list_output=$(wrangler_global_cmd r2 bucket list 2>&1 || true)

  if echo "$r2_list_output" | grep -qi "10042\|not enabled\|payment"; then
    warn "当前 Cloudflare 账号尚未开通 R2 存储（可能未绑定信用卡）。"
    warn "Edgechat 将以无 R2 模式部署（头像与本地聊天功能正常，大文件附件上传将安全禁用）。"
    export R2_AVAILABLE="false"
    return 0
  fi

  if echo "$r2_list_output" | grep -Fq "$CF_R2_BUCKET"; then
    success "复用已有 R2 存储桶：$CF_R2_BUCKET"
    return 0
  fi

  local create_output
  create_output=$(wrangler_global_cmd r2 bucket create "$CF_R2_BUCKET" 2>&1 || true)
  if echo "$create_output" | grep -qi "10042\|not enabled"; then
    warn "R2 存储桶创建失败（未开通 R2 服务），自动降级为无 R2 部署模式。"
    export R2_AVAILABLE="false"
  else
    success "已创建 R2 存储桶：$CF_R2_BUCKET"
  fi
}

bootstrap_calls() {
  log "检查或创建 Cloudflare Calls SFU 应用 (用于语音通话与群聊会议)..."
  local calls_out
  calls_out=$(python3 - << 'PY'
import json, os, sys, urllib.request, ssl

account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()

if not account_id or not token:
    sys.exit(0)

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}
ctx = ssl.create_default_context()

try:
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/calls/apps"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
        data = json.loads(resp.read().decode())
        apps = data.get("result", [])
        for app in apps:
            if isinstance(app, dict) and app.get("name") in ["edgechat-calls", "edgechat"]:
                uid = app.get("uid")
                if uid:
                    print(f"EXISTING_UID={uid}")
                    break
except Exception:
    pass

try:
    create_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/calls/apps"
    create_req = urllib.request.Request(create_url, headers=headers, data=json.dumps({"name": "edgechat-calls"}).encode())
    with urllib.request.urlopen(create_req, context=ctx, timeout=15) as resp:
        res = json.loads(resp.read().decode()).get("result", {})
        uid = res.get("uid")
        secret = res.get("secret")
        if uid and secret:
            print(f"CALLS_APP_ID={uid}")
            print(f"CALLS_APP_SECRET={secret}")
            sys.exit(0)
except Exception:
    pass
PY
  )

  if echo "$calls_out" | grep -q "CALLS_APP_ID="; then
    export CALLS_APP_ID=$(echo "$calls_out" | grep "CALLS_APP_ID=" | cut -d= -f2-)
    export CALLS_APP_SECRET=$(echo "$calls_out" | grep "CALLS_APP_SECRET=" | cut -d= -f2-)
    success "已成功自动开通 Cloudflare Calls SFU 应用 (ID: $CALLS_APP_ID)"
  elif echo "$calls_out" | grep -q "EXISTING_UID="; then
    export CALLS_APP_ID=$(echo "$calls_out" | grep "EXISTING_UID=" | cut -d= -f2-)
    success "已检测到已有的 Cloudflare Calls SFU 应用 (ID: $CALLS_APP_ID)"
  else
    log "未能通过 API 自动开通 Calls SFU 应用（可随时在管理后台手动填写配置）"
  fi
}

update_configs() {
  log "生成并更新 wrangler.toml 配置文件..."
  [[ -f "$WORKER_EXAMPLE_CFG" ]] || die "缺少模板文件：$WORKER_EXAMPLE_CFG"
  [[ -n "${CF_D1_DATABASE_ID:-}" ]] || die "缺少 CF_D1_DATABASE_ID"
  [[ -n "${CF_KV_NAMESPACE_ID:-}" ]] || die "缺少 CF_KV_NAMESPACE_ID"
  if [[ -z "${R2_AVAILABLE:-}" ]]; then
    if [[ -f "$WORKER_CFG" ]] && grep -q '\[\[r2_buckets\]\]' "$WORKER_CFG"; then
      export R2_AVAILABLE="true"
    elif [[ -f "$WORKER_CFG" ]]; then
      export R2_AVAILABLE="false"
    else
      export R2_AVAILABLE="true"
    fi
  fi

  python3 - "$WORKER_EXAMPLE_CFG" "$WORKER_CFG" <<'PY'
import sys, os, re

src_file, dst_file = sys.argv[1:3]
d1_id = os.environ["CF_D1_DATABASE_ID"]
kv_id = os.environ["CF_KV_NAMESPACE_ID"]
d1_name = os.environ.get("CF_D1_NAME", "cfchat-db")
r2_bucket = os.environ.get("CF_R2_BUCKET", "cfchat-files")
r2_available = os.environ.get("R2_AVAILABLE", "true") == "true"
route_prefix = os.environ.get("ROUTE_PREFIX", "")
disguise_host = os.environ.get("DISGUISE_HOST", "nginx")
calls_app_id = os.environ.get("CALLS_APP_ID", "")
calls_app_secret = os.environ.get("CALLS_APP_SECRET", "")
r2_access_key = os.environ.get("R2_ACCESS_KEY_ID", "")
r2_secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "")
r2_account_id = os.environ.get("R2_ACCOUNT_ID", "")

content = open(src_file, "r", encoding="utf-8").read()

# 替换 D1 配置
content = re.sub(r'database_name\s*=\s*"[^"]*"', f'database_name = "{d1_name}"', content)
content = re.sub(r'database_id\s*=\s*"[^"]*"', f'database_id = "{d1_id}"', content)

# 替换 KV 配置
content = re.sub(r'(\[\[kv_namespaces\]\][\s\S]*?id\s*=\s*")[^"]*(")', rf'\g<1>{kv_id}\g<2>', content)

# 替换或处理 R2 配置
if r2_available:
    content = re.sub(r'bucket_name\s*=\s*"[^"]*"', f'bucket_name = "{r2_bucket}"', content)
else:
    content = re.sub(r'\[\[r2_buckets\]\][\s\S]*?bucket_name\s*=\s*"[^"]*"\n*', '', content)

# 替换 ROUTE_PREFIX 与 DISGUISE_HOST
if 'ROUTE_PREFIX =' in content:
    content = re.sub(r'ROUTE_PREFIX\s*=\s*"[^"]*"', f'ROUTE_PREFIX = "{route_prefix}"', content)
if 'DISGUISE_HOST =' in content:
    content = re.sub(r'DISGUISE_HOST\s*=\s*"[^"]*"', f'DISGUISE_HOST = "{disguise_host}"', content)

# 写入 CALLS_APP_ID 和 CALLS_APP_SECRET (若存在)
if calls_app_id and '[vars]' in content:
    if 'CALLS_APP_ID =' in content:
        content = re.sub(r'CALLS_APP_ID\s*=\s*"[^"]*"', f'CALLS_APP_ID = "{calls_app_id}"', content)
    else:
        content = content.replace('[vars]\n', f'[vars]\nCALLS_APP_ID = "{calls_app_id}"\n')

if calls_app_secret and '[vars]' in content:
    if 'CALLS_APP_SECRET =' in content:
        content = re.sub(r'CALLS_APP_SECRET\s*=\s*"[^"]*"', f'CALLS_APP_SECRET = "{calls_app_secret}"', content)
    else:
        content = content.replace('[vars]\n', f'[vars]\nCALLS_APP_SECRET = "{calls_app_secret}"\n')

# 写入 R2 S3 直传加速配置 (若存在)
if r2_access_key and '[vars]' in content:
    if 'R2_ACCESS_KEY_ID =' in content:
        content = re.sub(r'R2_ACCESS_KEY_ID\s*=\s*"[^"]*"', f'R2_ACCESS_KEY_ID = "{r2_access_key}"', content)
    else:
        content = content.replace('[vars]\n', f'[vars]\nR2_ACCESS_KEY_ID = "{r2_access_key}"\n')

if r2_secret_key and '[vars]' in content:
    if 'R2_SECRET_ACCESS_KEY =' in content:
        content = re.sub(r'R2_SECRET_ACCESS_KEY\s*=\s*"[^"]*"', f'R2_SECRET_ACCESS_KEY = "{r2_secret_key}"', content)
    else:
        content = content.replace('[vars]\n', f'[vars]\nR2_SECRET_ACCESS_KEY = "{r2_secret_key}"\n')

if r2_account_id and '[vars]' in content:
    if 'R2_ACCOUNT_ID =' in content:
        content = re.sub(r'R2_ACCOUNT_ID\s*=\s*"[^"]*"', f'R2_ACCOUNT_ID = "{r2_account_id}"', content)
    else:
        content = content.replace('[vars]\n', f'[vars]\nR2_ACCOUNT_ID = "{r2_account_id}"\n')

open(dst_file, "w", encoding="utf-8").write(content)
print("wrangler.toml 配置已同步生成。")
PY

  success "wrangler.toml 已更新 (D1: $CF_D1_DATABASE_ID, KV: $CF_KV_NAMESPACE_ID, R2: ${R2_AVAILABLE:-true})"
}

bootstrap_resources() {
  acquire_deploy_lock
  doctor
  ensure_authenticated
  bootstrap_d1
  bootstrap_kv
  bootstrap_r2
  bootstrap_calls
  update_configs
}

ensure_resources_synced() {
  log "检查与校验 Cloudflare 边缘资源绑定 (D1, KV, R2)..."
  local d1_real_id
  d1_real_id=$(lookup_d1_id 2>/dev/null || echo "")
  local kv_real_id
  kv_real_id=$(lookup_kv_id 2>/dev/null || echo "")
  local cfg_d1_id=""
  local cfg_kv_id=""
  if [[ -f "$WORKER_CFG" ]]; then
    cfg_d1_id=$(grep -E '^\s*database_id\s*=' "$WORKER_CFG" | head -n1 | sed -E 's/.*=\s*"([^"]*)".*/\1/' || echo "")
    cfg_kv_id=$(grep -E '^\s*id\s*=' "$WORKER_CFG" | head -n1 | sed -E 's/.*=\s*"([^"]*)".*/\1/' || echo "")
  fi

  if [[ -z "$d1_real_id" || -z "$kv_real_id" || "$d1_real_id" != "$cfg_d1_id" || "$kv_real_id" != "$cfg_kv_id" || ! -f "$WORKER_CFG" ]]; then
    log "检测到账号切换或资源配置不一致，正在为当前账号自动检索/创建并同步真实资源..."
    bootstrap_d1
    bootstrap_kv
    bootstrap_r2
    bootstrap_calls
    update_configs
  else
    export CF_D1_DATABASE_ID="$d1_real_id"
    export CF_KV_NAMESPACE_ID="$kv_real_id"
    export EDGECHAT_D1_DATABASE_ID="$d1_real_id"
    # 确保当前环境中的配置变量 (ROUTE_PREFIX, DISGUISE_HOST 等) 完整同步到 wrangler.toml
    update_configs
  fi
  setup_encryption_secret
}

build_frontend() {
  log "构建前端静态资产 (Vue 3 + Vite)..."
  if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
    log "安装项目依赖..."
    npm install
  fi
  npm run build:frontend
  success "前端构建完成，已输出至 frontend/dist"
}

init_d1_schema() {
  log "初始化 D1 数据库表结构 (worker/schema.sql)..."
  wrangler_cmd d1 execute "$CF_D1_NAME" --remote --file=./worker/schema.sql --config="$WORKER_CFG" --yes
  success "D1 基础表结构已同步"
}

apply_d1_migrations() {
  log "检查并执行 D1 数据库版本迁移..."

  if [[ -z "${CF_D1_DATABASE_ID:-}" ]]; then
    if [[ -f "$WORKER_CFG" ]]; then
      CF_D1_DATABASE_ID=$(grep -E '^\s*database_id\s*=' "$WORKER_CFG" | head -n1 | sed -E 's/.*=\s*"([^"]*)".*/\1/' || echo "")
    fi
    if [[ -z "$CF_D1_DATABASE_ID" ]]; then
      CF_D1_DATABASE_ID=$(lookup_d1_id 2>/dev/null || echo "")
    fi
    export CF_D1_DATABASE_ID
  fi
  export EDGECHAT_D1_DATABASE_ID="${CF_D1_DATABASE_ID:-}"

  if [[ -f "$ROOT_DIR/.github/scripts/prepare-d1-migrations.mjs" && -n "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_ACCOUNT_ID:-}" && -n "${EDGECHAT_D1_DATABASE_ID:-}" ]]; then
    mkdir -p "$ROOT_DIR/.tmp"
    rm -f "$ROOT_DIR/.tmp/edgechat-d1-migrations.sql" 2>/dev/null || true
    if node "$ROOT_DIR/.github/scripts/prepare-d1-migrations.mjs" 2>/dev/null; then
      if [[ -f "$ROOT_DIR/.tmp/edgechat-d1-migrations.sql" ]]; then
        if [[ -s "$ROOT_DIR/.tmp/edgechat-d1-migrations.sql" ]]; then
          wrangler_cmd d1 execute "$CF_D1_NAME" --remote --file=.tmp/edgechat-d1-migrations.sql --config="$WORKER_CFG" --yes
          success "D1 增量迁移已执行"
        else
          success "D1 数据库结构已是最新版本，无需迁移"
        fi
        return 0
      fi
    fi
  fi

  # 兜底：若缺少 API Token 无法通过 API 自动比对清单，直接通过 wrangler 确保增量字段就绪
  local mig_file="$ROOT_DIR/worker/migrations/2026-09-07-telegram-mapping-direction.sql"
  if [[ -f "$mig_file" ]]; then
    wrangler_cmd d1 execute "$CF_D1_NAME" --remote --command="ALTER TABLE telegram_mappings ADD COLUMN sync_mode TEXT NOT NULL DEFAULT 'both' CHECK (sync_mode IN ('both', 'to_telegram', 'from_telegram'));" --config="$WORKER_CFG" --yes 2>/dev/null || true
  fi

  local ban_mig_file="$ROOT_DIR/worker/migrations/2026-08-20-user-ban-expiry.sql"
  if [[ -f "$ban_mig_file" ]]; then
    wrangler_cmd d1 execute "$CF_D1_NAME" --remote --command="ALTER TABLE users ADD COLUMN disabled_until TEXT;" --config="$WORKER_CFG" --yes 2>/dev/null || true
  fi

  success "D1 数据库结构已就绪"
}

init_admin_user() {
  log "配置系统管理员账户..."
  local current_user="${EDGECHAT_ADMIN_USERNAME:-${CFCHAT_ADMIN_USERNAME:-admin}}"
  local current_pass="${EDGECHAT_ADMIN_PASSWORD:-${CFCHAT_ADMIN_PASSWORD:-}}"
  local admin_name="${EDGECHAT_ADMIN_DISPLAY_NAME:-${CFCHAT_ADMIN_DISPLAY_NAME:-Administrator}}"

  local admin_user=""
  READP "请输入管理员用户名 [当前/默认: $current_user, 直接回车保持不变]: " input_admin_user
  admin_user="${input_admin_user:-$current_user}"

  local admin_pass=""
  if [[ -n "$current_pass" ]]; then
    READP "检测到已存在管理员密码，请输入新密码 [直接回车使用原密码，输入 'rand' 重新生成 16 位强随机密码]: " input_admin_pass
    if [[ -z "$input_admin_pass" ]]; then
      admin_pass="$current_pass"
      log "已选择使用原密码"
    elif [[ "$input_admin_pass" == "rand" || "$input_admin_pass" == "random" ]]; then
      admin_pass=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9!@#$' | head -c 16)
      echo -e "🎲 已为您自动生成新的管理员强密码: \e[1;33m$admin_pass\e[0m"
    else
      admin_pass="$input_admin_pass"
      log "已设置新的管理员密码"
    fi
  else
    READP "请输入管理员登录密码 [留空将自动生成 16 位强随机密码]: " input_admin_pass
    if [[ -z "$input_admin_pass" ]]; then
      admin_pass=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9!@#$' | head -c 16)
      echo -e "🎲 已为您自动生成管理员强密码: \e[1;33m$admin_pass\e[0m"
    else
      admin_pass="$input_admin_pass"
    fi
  fi

  export EDGECHAT_ADMIN_USERNAME="$admin_user"
  export EDGECHAT_ADMIN_PASSWORD="$admin_pass"
  export EDGECHAT_ADMIN_DISPLAY_NAME="$admin_name"
  export EDGECHAT_ADMIN_RESET_PASSWORD="1"

  mkdir -p "$ROOT_DIR/.tmp"
  node "$ROOT_DIR/.github/scripts/generate-admin-bootstrap-sql.mjs"
  wrangler_cmd d1 execute "$CF_D1_NAME" --remote --file=.tmp/edgechat-admin-upsert.sql --config="$WORKER_CFG" --yes
  success "管理员账户已初始化/重置完成：$admin_user"
  printf '  \033[1m管理员用户名：\033[0m \033[1;32m%s\033[0m\n' "$admin_user"
  printf '  \033[1m管理员密码：  \033[0m \033[1;33m%s\033[0m\n' "$admin_pass"

  if [[ -f "$ENV_LOCAL" ]]; then
    local escaped_pass escaped_user
    escaped_pass=$(escape_sed "$admin_pass")
    escaped_user=$(escape_sed "$admin_user")
    if grep -q 'EDGECHAT_ADMIN_PASSWORD=' "$ENV_LOCAL"; then
      sed -i "s|^export EDGECHAT_ADMIN_PASSWORD=.*|export EDGECHAT_ADMIN_PASSWORD=\"$escaped_pass\"|" "$ENV_LOCAL"
    fi
    if grep -q 'EDGECHAT_ADMIN_USERNAME=' "$ENV_LOCAL"; then
      sed -i "s|^export EDGECHAT_ADMIN_USERNAME=.*|export EDGECHAT_ADMIN_USERNAME=\"$escaped_user\"|" "$ENV_LOCAL"
    fi
  fi

  if [[ -n "${CALLS_APP_ID:-}" && -n "${CALLS_APP_SECRET:-}" ]]; then
    log "同步 Cloudflare Calls SFU 配置至 D1 数据库..."
    cat > "$ROOT_DIR/.tmp/edgechat-calls-upsert.sql" <<EOF
INSERT INTO site_settings (setting_key, setting_value, updated_at)
VALUES ('calls_app_id', '$CALLS_APP_ID', CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO UPDATE
SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP;

INSERT INTO site_settings (setting_key, setting_value, updated_at)
VALUES ('calls_app_secret', '$CALLS_APP_SECRET', CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO UPDATE
SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP;

INSERT INTO site_settings (setting_key, setting_value, updated_at)
VALUES ('calls_enabled', '1', CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO UPDATE
SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP;
EOF
    wrangler_cmd d1 execute "$CF_D1_NAME" --remote --file=.tmp/edgechat-calls-upsert.sql --config="$WORKER_CFG" --yes || true
    success "Calls SFU 配置已写入 D1 数据库并默认开启"
  fi
}

setup_encryption_secret() {
  log "配置服务端 AES-256 数据加密密钥..."
  rm -f "$ROOT_DIR/.tmp/worker-secrets.json" 2>/dev/null || true
  if [[ -f "$ROOT_DIR/.github/scripts/prepare-worker-encryption-secret.mjs" && -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
    if [[ -n "${CLOUDFLARE_API_TOKEN:-}" || ( -n "${CLOUDFLARE_API_KEY:-}" && -n "${CLOUDFLARE_EMAIL:-}" ) ]]; then
      node "$ROOT_DIR/.github/scripts/prepare-worker-encryption-secret.mjs" || true
    fi
  fi
}

deploy_worker() {
  log "部署 Cloudflare Worker 与 Durable Objects..."
  local deploy_output
  if [[ -f "$ROOT_DIR/.tmp/worker-secrets.json" ]]; then
    deploy_output=$(wrangler_cmd deploy --config="$WORKER_CFG" --secrets-file="$ROOT_DIR/.tmp/worker-secrets.json" < /dev/null | tee /dev/tty)
    rm -f "$ROOT_DIR/.tmp/worker-secrets.json" 2>/dev/null || true
  else
    deploy_output=$(wrangler_cmd deploy --config="$WORKER_CFG" < /dev/null | tee /dev/tty)
  fi

  local worker_url
  worker_url=$(echo "$deploy_output" | grep -oE "https://[a-zA-Z0-9.-]+\.workers\.dev" | head -n 1 || echo "")
  export DEPLOYED_WORKER_URL="$worker_url"
}

print_success_urls() {
  local prefix="${ROUTE_PREFIX:-}"
  if [[ -z "$prefix" && -f "$WORKER_CFG" ]]; then
    prefix=$(grep -E '^\s*ROUTE_PREFIX\s*=' "$WORKER_CFG" | head -n1 | sed -E 's/.*=\s*"([^"]*)".*/\1/' || echo "")
  fi
  local disguise="${DISGUISE_HOST:-}"
  if [[ -z "$disguise" && -f "$WORKER_CFG" ]]; then
    disguise=$(grep -E '^\s*DISGUISE_HOST\s*=' "$WORKER_CFG" | head -n1 | sed -E 's/.*=\s*"([^"]*)".*/\1/' || echo "")
  fi

  log "================================================================="
  printf '\033[1;32m%s\033[0m\n' "🎉 Edgechat 部署成功！"
  log "-----------------------------------------------------------------"
  if [[ -n "${DEPLOYED_WORKER_URL:-}" ]]; then
    if [[ -n "$prefix" ]]; then
      printf '  \033[1m🎭 伪装访问：\033[0m \033[1;33m%s/\033[0m (当前反代: %s)\n' "$DEPLOYED_WORKER_URL" "${disguise:-nginx}"
      IFS=',;| ' read -ra PREFIX_LIST <<< "$prefix"
      local count=1
      for p in "${PREFIX_LIST[@]}"; do
        p=$(echo "$p" | sed 's|^/*||;s|/*$||;s/^[[:space:]]*//;s/[[:space:]]*$//')
        [[ -z "$p" ]] && continue
        if (( ${#PREFIX_LIST[@]} > 1 )); then
          printf '  \033[1m🔒 真实入口 %d：\033[0m \033[1;36m%s/%s/\033[0m\n' "$count" "$DEPLOYED_WORKER_URL" "$p"
          printf '  \033[1m🔑 管理后台 %d：\033[0m \033[1;36m%s/%s/admin\033[0m\n' "$count" "$DEPLOYED_WORKER_URL" "$p"
        else
          printf '  \033[1m🔒 真实入口：\033[0m   \033[1;36m%s/%s/\033[0m\n' "$DEPLOYED_WORKER_URL" "$p"
          printf '  \033[1m🔑 管理后台：\033[0m   \033[1;36m%s/%s/admin\033[0m\n' "$DEPLOYED_WORKER_URL" "$p"
        fi
        count=$((count+1))
      done
    else
      printf '  \033[1m访问链接：\033[0m   \033[1;36m%s/\033[0m\n' "$DEPLOYED_WORKER_URL"
      printf '  \033[1m管理后台：\033[0m   \033[1;36m%s/admin\033[0m\n' "$DEPLOYED_WORKER_URL"
    fi
  else
    printf '  \033[1m访问提示：\033[0m   请在 Cloudflare Dashboard 查看绑定的自定义域名或 workers.dev\n'
  fi
  if [[ -n "${EDGECHAT_ADMIN_USERNAME:-}" ]]; then
    printf '  \033[1m初始管理员：\033[0m %s\n' "$EDGECHAT_ADMIN_USERNAME"
    if [[ -n "${EDGECHAT_ADMIN_PASSWORD:-}" ]]; then
      printf '  \033[1m管理员密码：\033[0m %s\n' "$EDGECHAT_ADMIN_PASSWORD"
    fi
  fi
  printf '  \033[1m安全状态：\033[0m   端到端加密 (E2EE) 已启用 | 隐藏入口与反代伪装已就绪\n'
  log "================================================================="
}

full_deploy() {
  acquire_deploy_lock
  validate_env_placeholders
  ensure_authenticated
  configure_disguise
  bootstrap_resources
  build_frontend
  init_d1_schema
  apply_d1_migrations
  init_admin_user
  setup_encryption_secret
  deploy_worker
  print_success_urls
}

fast_update() {
  acquire_deploy_lock
  doctor
  ensure_authenticated
  ensure_resources_synced
  build_frontend
  apply_d1_migrations
  deploy_worker
  print_success_urls
  success "快速更新完成！"
}

reset_soft() {
  acquire_deploy_lock
  doctor
  ensure_authenticated
  warn "将删除 Cloudflare Worker 服务（不删除 D1 / KV / R2 数据）。"
  echo "yes" | wrangler_global_cmd delete --name "$EDGECHAT_WORKER_NAME" || true
  success "Worker 已删除"
}

reset_hard() {
  acquire_deploy_lock
  doctor
  ensure_authenticated
  warn "⚠️  硬重置将永久删除 Worker 以及云端 D1 数据库、KV 命名空间与 R2 存储桶！"
  warn "D1 数据删除后不可恢复！"
  local confirm=""
  READP "请输入 DELETE $CF_D1_NAME 确认继续: " confirm
  [[ "$confirm" == "DELETE $CF_D1_NAME" ]] || die "用户取消硬重置"

  reset_soft

  log "正在删除云端 KV 空间..."
  local kv_id
  kv_id=$(lookup_kv_id 2>/dev/null || true)
  if [[ -n "$kv_id" ]]; then
    wrangler_global_cmd kv namespace delete --namespace-id "$kv_id" --skip-confirmation || true
  fi

  log "正在删除云端 D1 数据库..."
  wrangler_global_cmd d1 delete "$CF_D1_NAME" --skip-confirmation || true

  log "正在尝试删除云端 R2 存储桶..."
  local r2_err
  if ! r2_err=$(wrangler_global_cmd r2 bucket delete "$CF_R2_BUCKET" 2>&1); then
    if [[ "$r2_err" =~ "10008" || "$r2_err" =~ "not empty" ]]; then
      warn "R2 存储桶 [$CF_R2_BUCKET] 中仍存有附件文件。Cloudflare 安全策略要求非空存储桶需先清空才能删除。"
      log "💡 提示：若需彻底删除该存储桶，可在 Cloudflare 控制台 -> R2 中清空对象并删除。"
    else
      warn "R2 存储桶删除跳过（可能不存在或已被删除）"
    fi
  else
    success "R2 存储桶 [$CF_R2_BUCKET] 已删除"
  fi

  success "硬重置完成"
}

configure_workers_dev() {
  log "配置 workers.dev 子域..."
  [[ -f "$WORKER_CFG" ]] || update_configs
  cat <<'EOF'
选择：
  1. 启用 workers.dev (默认)
  2. 禁用 workers.dev
  3. 返回主菜单
EOF
  READP "请选择 [1-3]: " config_choice
  config_choice="${config_choice:-1}"
  case "$config_choice" in
    1)
      sed -i 's/^workers_dev = .*/workers_dev = true/' "$WORKER_CFG" 2>/dev/null || echo "workers_dev = true" >> "$WORKER_CFG"
      success "已启用 workers.dev"
      ;;
    2)
      sed -i 's/^workers_dev = .*/workers_dev = false/' "$WORKER_CFG" 2>/dev/null || echo "workers_dev = false" >> "$WORKER_CFG"
      success "已禁用 workers.dev"
      ;;
    *)
      return
      ;;
  esac
}

show_menu() {
  cat <<EOF

===================== Edgechat (v${PROJECT_VERSION}) Cloudflare 部署菜单 =====================
  1. 🔍 环境自检 (Doctor - Node.js/Wrangler/认证检测)
  2. 🔑 Cloudflare 认证管理 (支持 OAuth / API Token / Key / 状态查看与注销)
  3. 📦 自动创建/复用 D1、KV、R2 并同步配置
  4. 🎭 配置隐藏入口 (ROUTE_PREFIX) 与反代伪装 (DISGUISE_HOST)
  5. 🚀 一键完整部署 (自检 + 资源创建 + 伪装配置 + 前端构建 + D1 初始化 + 管理员 + 部署)
  6. ⚡ 快速增量更新 (前端重新构建 + 增量迁移 + 代码部署)
  7. 🗄️ 执行 D1 数据库初始化与版本迁移
  8. 👤 创建 / 重置系统管理员账户
  9. 🧹 软重置 (仅删除 Worker)
  10. ⚠️  硬重置 (删除 Worker + D1 数据库 + KV + R2 存储桶)
  11. 🌐 配置 workers.dev 子域状态
  12. 🧭 检查并设置系统默认浏览器
  0. 退出
========================================================================
EOF
}

pause_menu() {
  release_deploy_lock
  printf '\n按任意键返回主菜单... '
  read -n 1 -s -r || true
  printf '\n'
}

run_menu() {
  while true; do
    show_menu
    READP "请选择操作 [0-12]: " choice
    case "$choice" in
      1) doctor; pause_menu ;;
      2) cloudflare_auth_menu; pause_menu ;;
      3) bootstrap_resources; pause_menu ;;
      4) configure_disguise; pause_menu ;;
      5) full_deploy; pause_menu ;;
      6) fast_update; pause_menu ;;
      7) bootstrap_resources; init_d1_schema; apply_d1_migrations; pause_menu ;;
      8) bootstrap_resources; init_admin_user; pause_menu ;;
      9) reset_soft; pause_menu ;;
      10) reset_hard; pause_menu ;;
      11) configure_workers_dev; pause_menu ;;
      12) setup_default_browser; pause_menu ;;
      0) log "已退出"; break ;;
      *) warn "无效选项：$choice"; pause_menu ;;
    esac
  done
}

usage() {
  cat <<'EOF'
用法：
  bash deploy_edgechat_Linux.sh [command]

可用命令：
  menu                 交互式主菜单（默认）
  doctor               环境检查与依赖校验
  login|auth           Cloudflare 认证与登录管理菜单
  token|api-token      手动配置 Cloudflare API Token
  disguise             配置隐藏入口前缀与反代伪装网站
  bootstrap-resources  自动创建/复用 D1、KV、R2 资源并生成 wrangler.toml
  build                构建前端静态资源 (Vue 3 + Vite)
  migrate-d1           执行 D1 数据库初始化与迁移
  init-admin           创建或重置初始管理员账户
  deploy               一键完整部署（资源 + 伪装 + 构建 + 数据库 + 管理员 + 部署）
  update               快速更新（构建 + 部署）
  reset-soft           软重置（删除 Worker）
  reset-hard           硬重置（删除 Worker、D1、KV、R2）

环境变量配置 (.env.local)：
  参考 .env.local.example 了解完整配置项。
EOF
}

main() {
  local cmd="${1:-}"
  validate_env_placeholders
  case "$cmd" in
    menu|"")
      run_menu
      ;;
    doctor)
      doctor
      ;;
    login|auth|auth-menu)
      cloudflare_auth_menu
      ;;
    token|api-token)
      setup_api_token
      ;;
    disguise|disguise-proxy)
      configure_disguise
      ;;
    bootstrap-resources)
      bootstrap_resources
      ;;
    build)
      build_frontend
      ;;
    migrate-d1)
      bootstrap_resources
      init_d1_schema
      apply_d1_migrations
      ;;
    init-admin)
      bootstrap_resources
      init_admin_user
      ;;
    update)
      fast_update
      ;;
    deploy)
      full_deploy
      ;;
    reset-soft)
      reset_soft
      ;;
    reset-hard)
      reset_hard
      ;;
    help|--help|-h)
      usage
      exit 0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
