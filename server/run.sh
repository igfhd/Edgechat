#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"
VENV_DIR="$SCRIPT_DIR/.venv"

echo "===================================================="
echo "🚀 正在启动 Edgechat Web Deployer 在线部署平台..."
echo "===================================================="

# 1. 检查 Python 3
if ! command -v python3 &>/dev/null; then
    echo "❌ 错误: 未检测到 Python 3，请先安装 Python 3.8+"
    exit 1
fi

# 2. 检查并创建 Python 虚拟环境 (venv)
if [ ! -d "$VENV_DIR" ]; then
    echo "📦 首次运行，正在创建 Python 虚拟环境 ($VENV_DIR)..."
    if ! python3 -m venv "$VENV_DIR" 2>/dev/null; then
        echo "❌ 创建虚拟环境失败，可能缺少 python3-venv 模块。"
        echo "💡 请在终端执行以下命令后重试："
        echo "   Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y python3-venv"
        echo "   CentOS/RHEL:   sudo yum install -y python3-virtualenv"
        echo "   Arch Linux:    sudo pacman -S python-virtualenv"
        exit 1
    fi
    echo "✅ 虚拟环境创建成功"
fi

# 3. 激活虚拟环境
source "$VENV_DIR/bin/activate"

# 4. 检查并安装 Python 依赖
if ! python3 -c "import fastapi, uvicorn, pydantic" 2>/dev/null; then
    echo "📥 正在安装 Python 服务端依赖 (FastAPI / Uvicorn / Pydantic)..."
    pip install --no-cache-dir -r "$SCRIPT_DIR/requirements.txt"
    echo "✅ Python 依赖安装完成"
fi

# 5. 检查前端是否已构建（如未构建且有 npm，尝试自动构建）
if [ ! -d "$ROOT_DIR/frontend/dist" ]; then
    if command -v npm &>/dev/null; then
        echo "🔨 检测到前端尚未构建，正在自动构建前端资源..."
        (cd "$ROOT_DIR" && npm install --no-audit --no-fund && npm run build:frontend)
        echo "✅ 前端构建完成"
    else
        echo "⚠️ 警告: 未找到 frontend/dist，且未检测到 npm，可能会影响部署前端产物"
    fi
fi

# 6. 设置搜索路径并启动服务
export PYTHONPATH="$SCRIPT_DIR:$PYTHONPATH"
cd "$SCRIPT_DIR"

echo "===================================================="
echo "🎉 Edgechat Web Deployer 已就绪！"
echo "👉 请在浏览器中打开: http://127.0.0.1:$PORT"
echo "===================================================="

exec python3 -m uvicorn main:app --host "$HOST" --port "$PORT" --reload
