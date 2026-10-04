"""Cloudflare 部署流水线执行器"""
import os
import sys
import ssl
import json
import time
import secrets
import shutil
import subprocess
import urllib.request
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Callable, Tuple

SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))
REPO_ROOT = SERVER_DIR.parent
JOBS_DIR = Path(os.environ.get("EDGECHAT_JOBS_DIR", "/tmp/edgechat_deploy_jobs"))
API_BASE = "https://api.cloudflare.com/client/v4"

from probe import probe_worker_bindings

def get_project_version() -> str:
    for candidate in [REPO_ROOT / "package.json", Path("/app/package.json"), Path("package.json")]:
        if candidate.exists():
            try:
                with open(candidate, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("version"):
                        return str(data["version"])
            except Exception:
                pass
    return "1.0.0"


def _get_wrangler_cmd() -> List[str]:
    local_bin = REPO_ROOT / "node_modules/.bin/wrangler"
    if local_bin.exists() and os.access(local_bin, os.X_OK):
        return [str(local_bin)]
    if shutil.which("wrangler"):
        return ["wrangler"]
    return ["npx", "--yes", "wrangler@4.11.1"]


def _extract_error_summary(output: str, default_fallback: str = "执行失败") -> str:
    if not output:
        return default_fallback
    lines = [l.strip() for l in output.splitlines() if l.strip()]
    err_lines = [l for l in lines if any(k in l for k in ["[ERROR]", "ERROR", "Error:", "✘", "failed", "Failed"])]
    if err_lines:
        return " | ".join(err_lines[:4])
    return output[-400:] if len(output) > 400 else output


def _run_cmd(
    cmd: List[str],
    cwd: Path,
    env: Dict[str, str],
    log_fn: Callable[[str], None],
    timeout: int = 300,
) -> Tuple[int, str]:
    """执行子命令并流式输出日志"""
    full_env = dict(os.environ)
    full_env.update(env)
    if "PATH" in full_env and f"{REPO_ROOT}/node_modules/.bin" not in full_env["PATH"]:
        full_env["PATH"] = f"{REPO_ROOT}/node_modules/.bin:{full_env['PATH']}"

    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        env=full_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
    )

    output_lines = []
    try:
        if proc.stdout:
            for line in iter(proc.stdout.readline, ""):
                stripped = line.rstrip()
                if stripped:
                    log_fn(stripped)
                    output_lines.append(stripped)
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        log_fn("❌ 执行超时已终止")
        return -1, "\n".join(output_lines)
    except Exception as e:
        proc.kill()
        log_fn(f"❌ 执行异常: {e}")
        return -1, "\n".join(output_lines)

    return proc.returncode, "\n".join(output_lines)


def _cf_api_call(token: str, path: str, method: str = "GET", body: Optional[dict] = None) -> Dict[str, Any]:
    url = f"{API_BASE}{path}"
    headers = {
        "Authorization": f"Bearer {token.strip()}",
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_text = e.read().decode("utf-8")
        try:
            return json.loads(err_text)
        except Exception:
            return {"success": False, "errors": [{"code": e.code, "message": err_text}]}
    except Exception as e:
        return {"success": False, "errors": [{"code": 0, "message": str(e)}]}


def _escape_sql(val: str) -> str:
    return str(val).replace("'", "''")


def execute_deploy_pipeline(
    job_id: str,
    config: Dict[str, Any],
    log_fn: Callable[[str], None],
    progress_fn: Callable[[int, str], None],
    success_fn: Callable[[Dict[str, Any]], None],
    fail_fn: Callable[[str], None],
) -> None:
    """
    执行完整的 Cloudflare 部署流水线
    """
    def _s(val: Any, default: str = "") -> str:
        if val is None:
            return default
        s = str(val).strip()
        return s if s else default

    token = _s(config.get("api_token"))
    deploy_mode = _s(config.get("deploy_mode"), "fresh")

    if deploy_mode == "reset_admin":
        _execute_admin_reset_pipeline(
            job_id=job_id,
            config=config,
            log_fn=log_fn,
            progress_fn=progress_fn,
            success_fn=success_fn,
            fail_fn=fail_fn,
        )
        return

    if deploy_mode in ("uninstall", "reset_hard", "reset"):
        _execute_uninstall_pipeline(
            job_id=job_id,
            config=config,
            log_fn=log_fn,
            progress_fn=progress_fn,
            success_fn=success_fn,
            fail_fn=fail_fn,
        )
        return

    is_update = (deploy_mode == "update")
    account_id = _s(config.get("account_id"))
    worker_name = _s(config.get("worker_name"), "cfchat")
    route_prefix = _s(config.get("route_prefix"))
    clear_route_prefix = bool(config.get("clear_route_prefix", False))
    disguise_host = _s(config.get("disguise_host"), "nginx")
    admin_user = _s(config.get("admin_username"), "admin")
    admin_pass_raw = config.get("admin_password")
    admin_pass_explicit = bool(admin_pass_raw and str(admin_pass_raw).strip())
    admin_pass = _s(admin_pass_raw)
    admin_display = _s(config.get("admin_display_name"), "Administrator")
    d1_name = _s(config.get("d1_name"), "cfchat-db")
    kv_name = _s(config.get("kv_namespace"), "SESSIONS")
    r2_name = _s(config.get("r2_bucket"), "cfchat-files")
    enable_r2 = bool(config.get("enable_r2", True))
    calls_app_id = _s(config.get("calls_app_id"))
    calls_app_secret = _s(config.get("calls_app_secret"))
    r2_access_key = _s(config.get("r2_access_key_id"))
    r2_secret_key = _s(config.get("r2_secret_access_key"))
    r2_acc_id = _s(config.get("r2_account_id"))
    storage_type = _s(config.get("storage_type"), "r2")
    gdrive_client_id = _s(config.get("gdrive_client_id"))
    gdrive_client_secret = _s(config.get("gdrive_client_secret"))
    gdrive_refresh_token = _s(config.get("gdrive_refresh_token"))
    gdrive_folder_id = _s(config.get("gdrive_folder_id"))

    if not is_update and not admin_pass:
      admin_pass = secrets.token_urlsafe(12)

    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    if is_update:
        log_fn("⚡ [Edgechat Web Deployer] 初始化增量更新沙盒（复用已有资源与数据）...")
    else:
        log_fn("🚀 [Edgechat Web Deployer] 初始化全新部署沙盒...")
    progress_fn(10, "验证 Cloudflare 凭证与账号...")

    # 1. 验证 Token 并获取 Account ID
    if not account_id:
        log_fn("🔍 正在探测 Cloudflare 账号列表...")
        acc_res = _cf_api_call(token, "/accounts?per_page=50")
        if not acc_res.get("success") or not acc_res.get("result"):
            errors = acc_res.get("errors", [])
            err_msg = "; ".join(f"{e.get('code')}: {e.get('message')}" for e in errors) or "未能获取账号信息"
            log_fn(f"❌ 账号校验失败: {err_msg}")
            fail_fn(f"Cloudflare 账号校验失败: {err_msg}")
            return
        account_id = str(acc_res["result"][0]["id"]).strip()
        log_fn(f"✅ 自动锁定 Account ID: {account_id} ({acc_res['result'][0].get('name', 'Account')})")
    else:
        log_fn(f"✅ 使用指定的 Account ID: {account_id}")

    # 增量更新模式下，优先从 Worker 自身现有的云端绑定反解并继承资源
    d1_id = ""
    kv_id = ""
    kv_recovery_required = False
    if is_update:
        log_fn(f"🔍 检查目标 Worker [{worker_name}] 的现有云端绑定配置...")
        wb = probe_worker_bindings(token, account_id, worker_name)
        if not wb.get("found"):
            fail_fn(f"未找到目标 Worker [{worker_name}] 或无权读取其绑定；增量更新不会创建新资源，请确认名称、账号与 Token 权限。")
            return

        d1_id = _s(wb.get("d1_id"))
        d1_name = _s(wb.get("d1_name"))
        kv_id = _s(wb.get("kv_id"))
        kv_name = _s(wb.get("kv_namespace"))
        r2_name = _s(wb.get("r2_bucket"))
        if not d1_id or not d1_name:
            fail_fn(f"目标 Worker [{worker_name}] 缺少 Edgechat 必需的 D1 绑定；为避免增量更新意外创建数据库，已停止发布。")
            return

        # 增量更新以 Worker 绑定为唯一事实来源；资源名与不可变 ID 必须
        # 成对使用，避免手工编辑表单后生成名称与 ID 不一致的配置。
        if not kv_id:
            # KV 只保存可再生的会话与兼容性短期状态。缺失时绝不按名称
            # 复用账号内的未知命名空间，而是新建专属恢复空间并重新绑定。
            kv_name = f"{worker_name}-sessions-recovered-{secrets.token_hex(4)}"
            kv_id = ""
            kv_recovery_required = True
            log_fn(f"⚠️ Worker 未绑定可用 KV；将创建新的会话 KV [{kv_name}]。所有现有登录会话会失效，用户需重新登录。")
        elif not kv_name:
            kv_name = "SESSIONS"
        enable_r2 = bool(wb.get("has_r2")) and storage_type != "gdrive"
        log_fn(f"✅ 成功读取 Worker [{worker_name}] 现有绑定: D1={d1_name}, KV={kv_name}, R2={r2_name or '未绑定'}")
        if clear_route_prefix:
            route_prefix = ""
            log_fn("⚠️ [增量更新] 用户已指定清除隐藏入口，本次部署将恢复根目录直接访问")
        elif not route_prefix and wb.get("route_prefix"):
            route_prefix = wb["route_prefix"]
            log_fn(f"ℹ️ [增量更新] 自动保持云端现有隐藏入口路径: /{route_prefix}/")
        if (not disguise_host or disguise_host == "nginx") and wb.get("disguise_host"):
            disguise_host = wb["disguise_host"]

    progress_fn(20, "检查与创建云端资源 (D1 / KV / R2)...")

    # 2. 检查/创建 D1 数据库
    log_fn(f"📦 检查 D1 数据库: {d1_name}...")
    if d1_id:
        log_fn(f"✅ 复用 Worker 绑定的 D1 数据库: {d1_name} (ID: {d1_id})")
    else:
        d1_list_res = _cf_api_call(token, f"/accounts/{account_id}/d1/database?per_page=100")
        if d1_list_res.get("success") and d1_list_res.get("result"):
            for item in d1_list_res["result"]:
                if item.get("name") == d1_name or item.get("database_name") == d1_name:
                    d1_id = str(item.get("uuid") or item.get("id") or item.get("database_id"))
                    log_fn(f"✅ 复用已有 D1 数据库: {d1_name} (ID: {d1_id})")
                    break

    if not d1_id:
        log_fn(f"📦 正在创建新 D1 数据库: {d1_name}...")
        d1_create_res = _cf_api_call(token, f"/accounts/{account_id}/d1/database", method="POST", body={"name": d1_name})
        if d1_create_res.get("success") and d1_create_res.get("result"):
            res = d1_create_res["result"]
            d1_id = str(res.get("uuid") or res.get("id") or res.get("database_id"))
            log_fn(f"✅ D1 数据库创建成功 (ID: {d1_id})")
        else:
            errors = d1_create_res.get("errors", [])
            err_msg = "; ".join(f"{e.get('code')}: {e.get('message')}" for e in errors)
            log_fn(f"❌ D1 数据库创建失败: {err_msg}")
            fail_fn(f"D1 创建失败，请检查 API Token 是否拥有 D1 编辑权限 (错误: {err_msg})")
            return

    # 3. 检查/创建 KV 命名空间
    progress_fn(30, "检查与创建 KV 命名空间...")
    log_fn(f"📦 检查 KV 命名空间: {kv_name}...")
    if kv_id:
        log_fn(f"✅ 复用 Worker 绑定的 KV 空间: {kv_name} (ID: {kv_id})")
    else:
        # 恢复路径必须创建全新的 KV，以免把其他项目碰巧同名的会话空间
        # 绑定到当前 Worker。
        if not kv_recovery_required:
            kv_list_res = _cf_api_call(token, f"/accounts/{account_id}/storage/kv/namespaces?per_page=100")
            if kv_list_res.get("success") and kv_list_res.get("result"):
                for item in kv_list_res["result"]:
                    if item.get("title") in [kv_name, "cfchat-sessions", f"cfchat-{kv_name}"] or item.get("id") == kv_name:
                        kv_id = str(item.get("id"))
                        log_fn(f"✅ 复用已有 KV 空间: {item.get('title')} (ID: {kv_id})")
                        break

    if not kv_id:
        log_fn(f"📦 正在创建新 KV 空间: {kv_name}...")
        kv_create_res = _cf_api_call(token, f"/accounts/{account_id}/storage/kv/namespaces", method="POST", body={"title": kv_name})
        if kv_create_res.get("success") and kv_create_res.get("result"):
            kv_id = str(kv_create_res["result"].get("id"))
            log_fn(f"✅ KV 空间创建成功 (ID: {kv_id})")
            if kv_recovery_required:
                log_fn("⚠️ KV 恢复完成：历史登录会话已失效，请让用户重新登录。")
        else:
            errors = kv_create_res.get("errors", [])
            err_msg = "; ".join(f"{e.get('code')}: {e.get('message')}" for e in errors)
            log_fn(f"❌ KV 创建失败: {err_msg}")
            fail_fn(f"KV 空间创建失败，请检查 API Token 是否拥有 Workers KV 编辑权限 (错误: {err_msg})")
            return

    # 4. 检查/创建 R2 存储桶（含平滑降级）
    progress_fn(35, "检查存储方案与开通状态...")
    r2_available = False
    if storage_type == "gdrive":
        log_fn("📁 存储方案已选用: Google Drive 云端硬盘 (免绑卡 · 15GB 免费空间)")
        enable_r2 = False
    if enable_r2:
        log_fn(f"📦 检查 R2 存储桶: {r2_name}...")
        r2_list_res = _cf_api_call(token, f"/accounts/{account_id}/r2/buckets?per_page=100")
        if r2_list_res.get("success"):
            raw_b = r2_list_res.get("result")
            buckets = raw_b if isinstance(raw_b, list) else raw_b.get("buckets", []) if isinstance(raw_b, dict) else []
            existing_r2 = any(b.get("name") == r2_name for b in buckets)
            if existing_r2:
                log_fn(f"✅ 复用已有 R2 存储桶: {r2_name}")
                r2_available = True
            else:
                log_fn(f"📦 正在创建 R2 存储桶: {r2_name}...")
                r2_create_res = _cf_api_call(token, f"/accounts/{account_id}/r2/buckets", method="POST", body={"name": r2_name})
                if r2_create_res.get("success"):
                    log_fn(f"✅ R2 存储桶创建成功: {r2_name}")
                    r2_available = True
                else:
                    err_codes = [e.get("code") for e in r2_create_res.get("errors", [])]
                    if 10042 in err_codes:
                        log_fn("⚠️ 检测到当前账号尚未激活 R2 存储（未绑定信用卡），系统已自动平滑降级为无 R2 模式。")
                        r2_available = False
                    else:
                        log_fn(f"⚠️ R2 创建未完成，降级运行: {r2_create_res.get('errors')}")
                        r2_available = False
        else:
            err_codes = [e.get("code") for e in r2_list_res.get("errors", [])]
            if 10042 in err_codes:
                log_fn("⚠️ 当前 Cloudflare 账号尚未激活 R2 存储（需绑定信用卡），系统已平滑降级，核心聊天功能不受影响。")
            else:
                log_fn("⚠️ 未能访问 R2 存储（可能缺少 R2 权限），将以无 R2 模式继续部署。")
            r2_available = False

    # 5. 检查/开通 Cloudflare Calls SFU (音视频通话)
    if not calls_app_id or not calls_app_secret:
        log_fn("📞 尝试检查/自动开通 Cloudflare Calls SFU 音视频服务...")
        # 优先尝试通过 POST 创建 Calls App 获取 uid + secret
        create_c_res = _cf_api_call(token, f"/accounts/{account_id}/calls/apps", method="POST", body={"name": "edgechat-calls"})
        if create_c_res.get("success") and create_c_res.get("result"):
            c_res = create_c_res["result"]
            calls_app_id = str(c_res.get("uid", ""))
            calls_app_secret = str(c_res.get("secret", ""))
            if calls_app_id and calls_app_secret:
                log_fn(f"✅ 已成功自动创建 Cloudflare Calls SFU 应用 (ID: {calls_app_id})")
        else:
            # 若创建返回同名冲突或已有应用，尝试列出
            calls_res = _cf_api_call(token, f"/accounts/{account_id}/calls/apps")
            if calls_res.get("success") and calls_res.get("result"):
                for app in calls_res["result"]:
                    if app.get("name") in ["edgechat-calls", "edgechat"]:
                        if not calls_app_id:
                            calls_app_id = str(app.get("uid"))
                        log_fn(f"ℹ️ 检测到已有的 Calls 应用 (ID: {calls_app_id})")
                        break
            if not calls_app_id or not calls_app_secret:
                log_fn("ℹ️ 未能通过 API 获取完整的 Calls App Secret（API Token 可能缺少 Calls 写入权限，您可随时在管理后台手动填写配置）")
    else:
        log_fn(f"✅ 使用手动指定的 Cloudflare Calls SFU 配置 (ID: {calls_app_id})")

    progress_fn(45, "配置沙盒工作目录与 wrangler.toml...")

    symlink_targets = ["node_modules", "worker", "frontend", ".github", "package.json", "package-lock.json", "biome.json"]
    for item in symlink_targets:
        src = REPO_ROOT / item
        dst = job_dir / item
        if src.exists() and not dst.exists():
            try:
                os.symlink(str(src), str(dst))
            except Exception:
                if src.is_dir():
                    shutil.copytree(str(src), str(dst))
                else:
                    shutil.copy2(str(src), str(dst))

    # 6. 生成沙盒专用的 wrangler.toml
    example_toml_path = REPO_ROOT / "wrangler.example.toml"
    target_toml_path = job_dir / "wrangler.toml"
    
    with open(example_toml_path, "r", encoding="utf-8") as f:
        toml_content = f.read()

    # 仅替换文件顶部的 Worker 自身名称，切勿误伤 [[durable_objects.bindings]] 的 name 字段
    toml_content = re.sub(r'^name\s*=\s*"[^"]*"', f'name = "{worker_name}"', toml_content, count=1, flags=re.MULTILINE)

    # 兼容 Wrangler 4 规范：assets.run_worker_first 需为布尔值 true
    if 'run_worker_first = ["/*"]' in toml_content:
        toml_content = toml_content.replace('run_worker_first = ["/*"]', 'run_worker_first = true')

    toml_content = re.sub(r'database_name\s*=\s*"[^"]*"', f'database_name = "{d1_name}"', toml_content)
    toml_content = re.sub(r'database_id\s*=\s*"[^"]*"', f'database_id = "{d1_id}"', toml_content)
    toml_content = re.sub(r'(\[\[kv_namespaces\]\][\s\S]*?id\s*=\s*")[^"]*(")', rf'\g<1>{kv_id}\g<2>', toml_content)
    if r2_available:
        toml_content = re.sub(r'bucket_name\s*=\s*"[^"]*"', f'bucket_name = "{r2_name}"', toml_content)
    else:
        toml_content = re.sub(r'\[\[r2_buckets\]\][\s\S]*?bucket_name\s*=\s*"[^"]*"[\r\n]*', '', toml_content)

    if 'ROUTE_PREFIX =' in toml_content:
        toml_content = re.sub(r'ROUTE_PREFIX\s*=\s*"[^"]*"', f'ROUTE_PREFIX = "{route_prefix}"', toml_content)
    if 'DISGUISE_HOST =' in toml_content:
        toml_content = re.sub(r'DISGUISE_HOST\s*=\s*"[^"]*"', f'DISGUISE_HOST = "{disguise_host}"', toml_content)

    # 注入环境变量到 [vars]
    vars_to_add = {}
    if calls_app_id:
        vars_to_add["CALLS_APP_ID"] = calls_app_id
    if calls_app_secret:
        vars_to_add["CALLS_APP_SECRET"] = calls_app_secret
    if r2_access_key:
        vars_to_add["R2_ACCESS_KEY_ID"] = r2_access_key
    if r2_secret_key:
        vars_to_add["R2_SECRET_ACCESS_KEY"] = r2_secret_key
    if r2_acc_id:
        vars_to_add["R2_ACCOUNT_ID"] = r2_acc_id
    if gdrive_client_id:
        vars_to_add["GDRIVE_CLIENT_ID"] = gdrive_client_id
    if gdrive_client_secret:
        vars_to_add["GDRIVE_CLIENT_SECRET"] = gdrive_client_secret
    if gdrive_refresh_token:
        vars_to_add["GDRIVE_REFRESH_TOKEN"] = gdrive_refresh_token
    if gdrive_folder_id:
        vars_to_add["GDRIVE_FOLDER_ID"] = gdrive_folder_id

    for k, v in vars_to_add.items():
        if f'{k} =' in toml_content:
            toml_content = re.sub(rf'{k}\s*=\s*"[^"]*"', f'{k} = "{v}"', toml_content)
        else:
            toml_content = re.sub(r'(\[vars\][\r\n]+)', rf'\g<1>{k} = "{v}"\n', toml_content)

    with open(target_toml_path, "w", encoding="utf-8") as f:
        f.write(toml_content)

    log_fn("✅ wrangler.toml 配置文件渲染就绪")

    wrangler_logs_dir = job_dir / ".tmp/wrangler/logs"
    wrangler_logs_dir.mkdir(parents=True, exist_ok=True)
    wrangler_bin = _get_wrangler_cmd()

    env_vars = {
        "CLOUDFLARE_API_TOKEN": token,
        "CLOUDFLARE_ACCOUNT_ID": account_id,
        "EDGECHAT_WORKER_NAME": worker_name,
        "CF_D1_NAME": d1_name,
        "CF_D1_DATABASE_ID": d1_id,
        "EDGECHAT_D1_DATABASE_ID": d1_id,
        "WRANGLER_LOG_PATH": str(wrangler_logs_dir),
        "WRANGLER_SEND_METRICS": "false",
        "CI": "true",
        "CF_KV_NAMESPACE_ID": kv_id,
        "CF_R2_BUCKET": r2_name,
        "R2_AVAILABLE": "true" if r2_available else "false",
        "ROUTE_PREFIX": route_prefix,
        "DISGUISE_HOST": disguise_host,
        "EDGECHAT_ADMIN_USERNAME": admin_user,
        "EDGECHAT_ADMIN_PASSWORD": admin_pass,
        "EDGECHAT_ADMIN_DISPLAY_NAME": admin_display,
    }

    progress_fn(48, "检查并编译前端最新资产...")
    if shutil.which("npm"):
        log_fn("🔨 正在自动编译前端资源 (npm run build:frontend)...")
        rc_b, out_b = _run_cmd(["npm", "run", "build:frontend"], job_dir, env_vars, log_fn, timeout=120)
        if rc_b == 0:
            log_fn("✅ 前端资源编译完成")
        else:
            log_fn("ℹ️ 前端编译跳过或复用已有构建产物")
    else:
        log_fn("ℹ️ 使用已有前端构建产物 (frontend/dist)")

    if is_update:
        progress_fn(55, "复用现有数据库表结构...")
        log_fn("⚡ [增量更新] 检测到现有 D1 数据库，跳过全量表初始化，保留历史聊天记录与用户数据")
    else:
        progress_fn(55, "初始化 D1 数据库表结构...")
        log_fn("🗄️ 正在远程初始化 D1 数据库表结构 (worker/schema.sql)...")
        d1_cmd = wrangler_bin + ["d1", "execute", d1_name, "--remote", "--file=./worker/schema.sql", f"--config={target_toml_path}", "--yes"]
        rc, out = _run_cmd(d1_cmd, job_dir, env_vars, log_fn, timeout=120)
        if rc != 0:
            log_fn("❌ D1 表结构初始化执行失败")
            fail_fn(f"D1 表结构执行失败: {_extract_error_summary(out)}")
            return
        log_fn("✅ D1 基础数据表同步完成")

    progress_fn(65, "检查并应用 D1 增量数据库迁移...")
    mig_script = REPO_ROOT / ".github/scripts/prepare-d1-migrations.mjs"
    if mig_script.exists():
        (job_dir / ".tmp").mkdir(parents=True, exist_ok=True)
        env_vars["EDGECHAT_MIGRATION_OUTPUT_PATH"] = str(job_dir / ".tmp/edgechat-d1-migrations.sql")
        rc_mig, out_mig = _run_cmd(["node", str(mig_script)], job_dir, env_vars, log_fn, timeout=60)
        if rc_mig != 0:
            fail_fn(f"生成 D1 增量迁移失败: {_extract_error_summary(out_mig)}")
            return
        mig_sql = job_dir / ".tmp/edgechat-d1-migrations.sql"
        if not mig_sql.exists() and (REPO_ROOT / ".tmp/edgechat-d1-migrations.sql").exists():
            try:
                shutil.copy2(str(REPO_ROOT / ".tmp/edgechat-d1-migrations.sql"), str(mig_sql))
            except Exception:
                pass
        if mig_sql.exists() and mig_sql.stat().st_size > 0:
            log_fn("🗄️ 执行 D1 增量版本迁移...")
            rc_mig_apply, out_mig_apply = _run_cmd(wrangler_bin + ["d1", "execute", d1_name, "--remote", "--file=.tmp/edgechat-d1-migrations.sql", f"--config={target_toml_path}", "--yes"], job_dir, env_vars, log_fn, timeout=120)
            if rc_mig_apply != 0:
                fail_fn(f"执行 D1 增量迁移失败: {_extract_error_summary(out_mig_apply)}")
                return
    log_fn("✅ D1 数据库结构已处于最新版本")

    if not is_update or admin_pass_explicit:
        progress_fn(75, "配置系统管理员账户与全局设置...")
        log_fn(f"👤 初始化/更新系统管理员账户: {admin_user}...")
        admin_script = REPO_ROOT / ".github/scripts/generate-admin-bootstrap-sql.mjs"
        if admin_script.exists():
            (job_dir / ".tmp").mkdir(parents=True, exist_ok=True)
            if admin_pass_explicit:
                env_vars["EDGECHAT_ADMIN_RESET_PASSWORD"] = "1"
            _run_cmd(["node", str(admin_script)], job_dir, env_vars, log_fn, timeout=30)
            admin_sql = job_dir / ".tmp/edgechat-admin-upsert.sql"
            if admin_sql.exists():
                _run_cmd(wrangler_bin + ["d1", "execute", d1_name, "--remote", "--file=.tmp/edgechat-admin-upsert.sql", f"--config={target_toml_path}", "--yes"], job_dir, env_vars, log_fn, timeout=60)
        log_fn("✅ 管理员账户已写入数据库")
    else:
        log_fn("ℹ️ [增量更新] 未输入新密码，保留现有管理员密码并同步确认超级管理员权限")
        (job_dir / ".tmp").mkdir(parents=True, exist_ok=True)
        safe_admin = _escape_sql(admin_user)
        admin_sync_sql = f"""
UPDATE users
SET is_admin = 1,
    is_disabled = 0,
    disabled_until = NULL,
    deleted_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE username = '{safe_admin}';
""".strip()
        sync_sql_file = job_dir / ".tmp/edgechat-admin-sync.sql"
        sync_sql_file.write_text(admin_sync_sql + "\n", encoding="utf-8")
        _run_cmd(wrangler_bin + ["d1", "execute", d1_name, "--remote", "--file=.tmp/edgechat-admin-sync.sql", f"--config={target_toml_path}", "--yes"], job_dir, env_vars, log_fn, timeout=60)
        log_fn(f"✅ 管理员账户 [{admin_user}] 超级管理员权限 (is_admin = 1) 已确认就绪")

    # 若有 Calls 配置，直接回填写入 D1 site_settings 表，保证管理后台与数据库同步生效
    if calls_app_id and calls_app_secret:
        log_fn(f"📞 正在将 Calls SFU 配置同步写入 D1 数据库 (site_settings)...")
        safe_c_id = _escape_sql(calls_app_id)
        safe_c_sec = _escape_sql(calls_app_secret)
        calls_bootstrap_sql = f"""
INSERT INTO site_settings (setting_key, setting_value, updated_at)
VALUES ('calls_app_id', '{safe_c_id}', CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO UPDATE
SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP;

INSERT INTO site_settings (setting_key, setting_value, updated_at)
VALUES ('calls_app_secret', '{safe_c_sec}', CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO UPDATE
SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP;

INSERT INTO site_settings (setting_key, setting_value, updated_at)
VALUES ('calls_enabled', '1', CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO UPDATE
SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP;
""".strip()
        calls_sql_file = job_dir / ".tmp/edgechat-calls-upsert.sql"
        calls_sql_file.write_text(calls_bootstrap_sql + "\n", encoding="utf-8")
        _run_cmd(wrangler_bin + ["d1", "execute", d1_name, "--remote", "--file=.tmp/edgechat-calls-upsert.sql", f"--config={target_toml_path}", "--yes"], job_dir, env_vars, log_fn, timeout=60)
        log_fn("✅ 语音通话与 SFU 服务器配置已同步至 D1 数据库并默认启用")

    # 若指定了 Google Drive 存储引擎，将凭据与 storage_type 同步写入 D1 site_settings
    if storage_type == 'gdrive' or gdrive_client_id:
        log_fn(f"📁 正在将 Google Drive 网盘存储配置同步写入 D1 数据库 (site_settings)...")
        safe_gd_id = _escape_sql(gdrive_client_id)
        safe_gd_sec = _escape_sql(gdrive_client_secret)
        safe_gd_tok = _escape_sql(gdrive_refresh_token)
        safe_gd_fld = _escape_sql(gdrive_folder_id)
        gdrive_bootstrap_sql = f"""
INSERT INTO site_settings (setting_key, setting_value, updated_at)
VALUES ('storage_type', 'gdrive', CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO UPDATE
SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP;

INSERT INTO site_settings (setting_key, setting_value, updated_at)
VALUES ('gdrive_client_id', '{safe_gd_id}', CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO UPDATE
SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP;

INSERT INTO site_settings (setting_key, setting_value, updated_at)
VALUES ('gdrive_client_secret', '{safe_gd_sec}', CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO UPDATE
SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP;

INSERT INTO site_settings (setting_key, setting_value, updated_at)
VALUES ('gdrive_refresh_token', '{safe_gd_tok}', CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO UPDATE
SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP;

INSERT INTO site_settings (setting_key, setting_value, updated_at)
VALUES ('gdrive_folder_id', '{safe_gd_fld}', CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO UPDATE
SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP;
""".strip()
        storage_sql_file = job_dir / ".tmp/edgechat-storage-upsert.sql"
        storage_sql_file.write_text(gdrive_bootstrap_sql + "\n", encoding="utf-8")
        _run_cmd(wrangler_bin + ["d1", "execute", d1_name, "--remote", "--file=.tmp/edgechat-storage-upsert.sql", f"--config={target_toml_path}", "--yes"], job_dir, env_vars, log_fn, timeout=60)
        log_fn("✅ Google Drive 网盘存储引擎配置已成功同步至 D1 数据库")

    progress_fn(85, "生成服务端 AES-256 数据加密密钥环...")
    log_fn("🔐 配置服务端端到端数据加密密钥...")
    secret_script = REPO_ROOT / ".github/scripts/prepare-worker-encryption-secret.mjs"
    secrets_file = job_dir / ".tmp/worker-secrets.json"
    if secret_script.exists():
        _run_cmd(["node", str(secret_script)], job_dir, env_vars, log_fn, timeout=30)

    progress_fn(90, "部署 Cloudflare Worker 与 Durable Objects...")
    log_fn(f"🚀 执行 wrangler deploy 发布 Worker: {worker_name}...")
    deploy_cmd = wrangler_bin + ["deploy", f"--config={target_toml_path}"]
    if secrets_file.exists():
        deploy_cmd.append(f"--secrets-file={secrets_file}")

    rc_deploy, deploy_out = _run_cmd(deploy_cmd, job_dir, env_vars, log_fn, timeout=180)
    if rc_deploy != 0:
        log_fn("❌ Worker 部署发布失败")
        fail_fn(f"Wrangler deploy 失败: {_extract_error_summary(deploy_out)}")
        return

    if secrets_file.exists():
        try:
            secrets_file.unlink()
        except Exception:
            pass

    progress_fn(98, "解析部署结果与入口链接...")

    worker_url = ""
    url_match = re.search(r'https://[a-zA-Z0-9.-]+\.workers\.dev', deploy_out)
    if url_match:
        worker_url = url_match.group(0)
    else:
        worker_url = f"https://{worker_name}.workers.dev"

    real_entries = []
    admin_entries = []
    if route_prefix:
        prefixes = [p.strip().strip('/') for p in re.split(r'[,;| ]+', route_prefix) if p.strip()]
        for p in prefixes:
            real_entries.append(f"{worker_url}/{p}/")
            admin_entries.append(f"{worker_url}/{p}/admin")
    else:
        real_entries.append(f"{worker_url}/")
        admin_entries.append(f"{worker_url}/admin")

    result = {
        "ok": True,
        "mode": "update" if is_update else "fresh",
        "version": get_project_version(),
        "worker_name": worker_name,
        "worker_url": worker_url,
        "disguise_url": f"{worker_url}/",
        "disguise_host": disguise_host,
        "route_prefix": route_prefix,
        "real_entry_urls": real_entries,
        "admin_urls": admin_entries,
        "admin_username": admin_user,
        "admin_password": admin_pass if (not is_update or admin_pass_explicit) else "(保持原密码不变)",
        "d1_database_id": d1_id,
        "kv_namespace_id": kv_id,
        "kv_recreated": kv_recovery_required,
        "storage_type": storage_type,
        "r2_bucket": r2_name,
        "r2_available": r2_available,
        "calls_enabled": bool(calls_app_id and calls_app_secret),
        "calls_app_id": calls_app_id,
        "account_id": account_id,
        "deployed_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
    }

    log_fn("=========================================================")
    log_fn(f"🎉 [Edgechat v{get_project_version()}] 部署完成！")
    log_fn(f"🎭 伪装访问地址: {worker_url}/ (反代: {disguise_host})")
    for idx, r_url in enumerate(real_entries, 1):
        log_fn(f"🔒 真实聊天入口 {idx}: {r_url}")
        log_fn(f"🔑 系统管理后台 {idx}: {admin_entries[idx-1]}")
    admin_pass_display = admin_pass if (not is_update or admin_pass_explicit) else "(保持原密码不变)"
    log_fn(f"👤 管理员账户: {admin_user} | 密码: {admin_pass_display}")
    if calls_app_id and calls_app_secret:
        log_fn(f"📞 语音通话 SFU: 已启用 (App ID: {calls_app_id})")
    else:
        log_fn("📞 语音通话 SFU: 未配置（可在管理后台音视频设置随时填入）")
    log_fn("=========================================================")

    progress_fn(100, "部署成功！")
    success_fn(result)


def _execute_admin_reset_pipeline(
    job_id: str,
    config: Dict[str, Any],
    log_fn: Callable[[str], None],
    progress_fn: Callable[[int, str], None],
    success_fn: Callable[[Dict[str, Any]], None],
    fail_fn: Callable[[str], None],
) -> None:
    def _s(val: Any, default: str = "") -> str:
        if val is None:
            return default
        s = str(val).strip()
        return s if s else default

    token = _s(config.get("api_token"))
    account_id = _s(config.get("account_id"))
    worker_name = _s(config.get("worker_name"), "cfchat")
    d1_name = _s(config.get("d1_name"), "cfchat-db")
    admin_user = _s(config.get("admin_username"), "admin")
    admin_pass = _s(config.get("admin_password"))
    admin_display = _s(config.get("admin_display_name"), "Administrator")

    if not admin_pass:
        admin_pass = secrets.token_urlsafe(12)

    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    log_fn(f"👤 [Edgechat Web Deployer] 开始执行管理员 [{admin_user}] 密码重置流水线...")
    progress_fn(10, "验证 Cloudflare 凭证与账号...")

    if not account_id:
        log_fn("🔍 正在探测 Cloudflare 账号列表...")
        acc_res = _cf_api_call(token, "/accounts?per_page=50")
        if not acc_res.get("success") or not acc_res.get("result"):
            errors = acc_res.get("errors", [])
            err_msg = "; ".join(f"{e.get('code')}: {e.get('message')}" for e in errors) or "未能获取账号信息"
            log_fn(f"❌ 账号校验失败: {err_msg}")
            fail_fn(f"Cloudflare 账号校验失败: {err_msg}")
            return
        account_id = str(acc_res["result"][0]["id"]).strip()
        log_fn(f"✅ 自动锁定 Account ID: {account_id}")

    # 如果指定了 Worker 服务名，尝试从现有绑定自动反解 D1
    if worker_name:
        wb = probe_worker_bindings(token, account_id, worker_name)
        if wb.get("found") and wb.get("d1_name"):
            if not d1_name or d1_name == "cfchat-db":
                d1_name = wb["d1_name"]
            log_fn(f"ℹ️ 从 Worker [{worker_name}] 绑定反解 D1 数据库: {d1_name}")

    progress_fn(30, f"查找目标 D1 数据库: {d1_name}...")
    d1_id = ""
    d1_list_res = _cf_api_call(token, f"/accounts/{account_id}/d1/database?per_page=100")
    if d1_list_res.get("success") and d1_list_res.get("result"):
        for item in d1_list_res["result"]:
            if item.get("name") == d1_name or item.get("database_name") == d1_name:
                d1_id = str(item.get("uuid") or item.get("id") or item.get("database_id"))
                break

    if not d1_id:
        fail_fn(f"未在 Cloudflare 账号中找到名为 [{d1_name}] 的 D1 数据库，请检查数据库名称是否正确。")
        return
    log_fn(f"✅ 锁定 D1 数据库: {d1_name} (ID: {d1_id})")

    progress_fn(50, "生成重置密码 SQL 与参数...")
    env_vars = {
        "CLOUDFLARE_API_TOKEN": token,
        "CLOUDFLARE_ACCOUNT_ID": account_id,
        "EDGECHAT_ADMIN_USERNAME": admin_user,
        "EDGECHAT_ADMIN_PASSWORD": admin_pass,
        "EDGECHAT_ADMIN_DISPLAY_NAME": admin_display,
        "EDGECHAT_ADMIN_RESET_PASSWORD": "1",
    }

    admin_script = REPO_ROOT / ".github/scripts/generate-admin-bootstrap-sql.mjs"
    (job_dir / ".tmp").mkdir(parents=True, exist_ok=True)
    rc, out = _run_cmd(["node", str(admin_script)], job_dir, env_vars, log_fn, timeout=30)
    if rc != 0:
        fail_fn(f"生成密码重置 SQL 失败: {_extract_error_summary(out)}")
        return

    admin_sql = job_dir / ".tmp/edgechat-admin-upsert.sql"
    if not admin_sql.exists() or admin_sql.stat().st_size == 0:
        fail_fn("未找到生成的管理员 SQL 文件")
        return

    target_toml_path = job_dir / "wrangler.toml"
    with open(target_toml_path, "w", encoding="utf-8") as f:
        f.write(f"""name = "{worker_name or 'cfchat'}"
main = "worker/src/index.js"
compatibility_date = "2024-09-23"

[[d1_databases]]
binding = "DB"
database_name = "{d1_name}"
database_id = "{d1_id}"
""")

    progress_fn(75, f"执行远程 D1 数据库更新 (用户: {admin_user})...")
    log_fn(f"🔐 正在将新密码写入 D1 数据库并强制注销该用户历史登录凭据...")
    wrangler_bin = _get_wrangler_cmd()
    d1_cmd = wrangler_bin + [
        "d1", "execute", d1_name, "--remote",
        "--file=.tmp/edgechat-admin-upsert.sql",
        f"--config={target_toml_path}",
        "--yes"
    ]
    rc, out = _run_cmd(d1_cmd, job_dir, env_vars, log_fn, timeout=60)
    if rc != 0:
        fail_fn(f"远程执行 D1 密码重置 SQL 失败: {_extract_error_summary(out)}")
        return

    log_fn(f"✅ 管理员 [{admin_user}] 密码已成功重置！")
    progress_fn(100, "密码重置完成！")

    success_fn({
        "ok": True,
        "mode": "reset_admin",
        "worker_name": worker_name,
        "account_id": account_id,
        "d1_database_id": d1_id,
        "d1_name": d1_name,
        "admin_username": admin_user,
        "admin_password": admin_pass,
        "deployed_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "summary": f"系统管理员 [{admin_user}] 密码已成功重置！",
    })


def _execute_uninstall_pipeline(
    job_id: str,
    config: Dict[str, Any],
    log_fn: Callable[[str], None],
    progress_fn: Callable[[int, str], None],
    success_fn: Callable[[Dict[str, Any]], None],
    fail_fn: Callable[[str], None],
) -> None:
    def _s(val: Any, default: str = "") -> str:
        if val is None:
            return default
        s = str(val).strip()
        return s if s else default

    token = _s(config.get("api_token"))
    account_id = _s(config.get("account_id"))
    worker_name = _s(config.get("worker_name"), "cfchat")
    d1_name = _s(config.get("d1_name"), "cfchat-db")
    kv_name = _s(config.get("kv_namespace"), "SESSIONS")
    r2_name = _s(config.get("r2_bucket"), "cfchat-files")

    delete_worker = bool(config.get("delete_worker", True))
    delete_d1 = bool(config.get("delete_d1", True))
    delete_kv = bool(config.get("delete_kv", True))
    delete_r2 = bool(config.get("delete_r2", False))
    confirm_text = _s(config.get("confirm_text"))

    # 安全检查：确认文本需等于 "DELETE" 或 worker_name
    expected_confirm = ["DELETE", worker_name.strip()]
    if confirm_text not in expected_confirm:
        fail_fn(f"安全防误触校验未通过：输入的确认文本为 [{confirm_text}]，必须输入 'DELETE' 或目标 Worker 名称 '{worker_name}' 才能继续。")
        return

    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    log_fn("⚠️ [Edgechat Web Deployer] 开始执行云端资源卸载与硬重置流水线...")
    progress_fn(10, "验证 Cloudflare 凭证与账号...")

    if not account_id:
        acc_res = _cf_api_call(token, "/accounts?per_page=50")
        if not acc_res.get("success") or not acc_res.get("result"):
            errors = acc_res.get("errors", [])
            err_msg = "; ".join(f"{e.get('code')}: {e.get('message')}" for e in errors) or "未能获取账号信息"
            fail_fn(f"Cloudflare 账号校验失败: {err_msg}")
            return
        account_id = str(acc_res["result"][0]["id"]).strip()
        log_fn(f"✅ 自动锁定 Account ID: {account_id}")

    # 选定 Worker 决定清理范围。仅删除 Cloudflare 返回的实际绑定资源，
    # 不会将表单默认值误认为绑定目标。
    kv_id = ""
    d1_name = ""
    kv_name = ""
    r2_name = ""
    if worker_name:
        wb = probe_worker_bindings(token, account_id, worker_name)
        if wb.get("found"):
            d1_name = _s(wb.get("d1_name"))
            kv_name = _s(wb.get("kv_namespace"))
            kv_id = _s(wb.get("kv_id"))
            r2_name = _s(wb.get("r2_bucket"))
            log_fn(f"ℹ️ 从 Worker [{worker_name}] 反解关联资源: D1={d1_name or '未绑定'}, KV={kv_name or '未绑定'}, R2={r2_name or '未绑定'}")
        else:
            log_fn(f"⚠️ 未能读取 Worker [{worker_name}] 的关联资源；为避免误删，跳过 D1、KV 与 R2 清理。")

    wrangler_bin = _get_wrangler_cmd()
    env_vars = {
        "CLOUDFLARE_API_TOKEN": token,
        "CLOUDFLARE_ACCOUNT_ID": account_id,
    }

    deleted_items = []
    failed_items = []

    # 1. 删除 Worker
    if delete_worker and worker_name:
        progress_fn(30, f"正在下线 Worker 服务 [{worker_name}]...")
        log_fn(f"🗑️ 正在删除 Cloudflare Worker: {worker_name}...")
        del_w_res = _cf_api_call(token, f"/accounts/{account_id}/workers/scripts/{worker_name}", method="DELETE")
        if del_w_res.get("success"):
            log_fn(f"✅ Worker 服务 [{worker_name}] 已成功删除")
            deleted_items.append(f"Worker: {worker_name}")
        else:
            rc, out = _run_cmd(wrangler_bin + ["delete", "--name", worker_name, "--yes"], job_dir, env_vars, log_fn, timeout=60)
            if rc == 0:
                log_fn(f"✅ Worker 服务 [{worker_name}] 已通过 Wrangler 删除")
                deleted_items.append(f"Worker: {worker_name}")
            else:
                failed_items.append(f"Worker: {worker_name}")
                log_fn(f"❌ Worker [{worker_name}] 删除失败: {_extract_error_summary(out)}")

    # 2. 删除 KV 命名空间
    if delete_kv and kv_name:
        progress_fn(50, f"正在删除 KV 空间 [{kv_name}]...")
        if not kv_id:
            kv_list_res = _cf_api_call(token, f"/accounts/{account_id}/storage/kv/namespaces?per_page=100")
            if kv_list_res.get("success") and kv_list_res.get("result"):
                for item in kv_list_res["result"]:
                    if item.get("title") == kv_name or item.get("id") == kv_name:
                        kv_id = item.get("id")
                        break
        if kv_id:
            log_fn(f"🗑️ 正在删除 KV 命名空间: {kv_name} (ID: {kv_id})...")
            del_kv_res = _cf_api_call(token, f"/accounts/{account_id}/storage/kv/namespaces/{kv_id}", method="DELETE")
            if del_kv_res.get("success"):
                log_fn(f"✅ KV 空间 [{kv_name}] 已成功删除")
                deleted_items.append(f"KV: {kv_name}")
            else:
                rc, out = _run_cmd(wrangler_bin + ["kv", "namespace", "delete", "--namespace-id", kv_id, "--skip-confirmation"], job_dir, env_vars, log_fn, timeout=60)
                if rc == 0:
                    deleted_items.append(f"KV: {kv_name}")
                else:
                    failed_items.append(f"KV: {kv_name}")
                    log_fn(f"❌ KV 删除失败: {_extract_error_summary(out)}")
        else:
            log_fn("ℹ️ Worker 未绑定 KV 命名空间，跳过删除")

    # 3. 删除 D1 数据库
    if delete_d1 and d1_name:
        progress_fn(70, f"正在删除 D1 数据库 [{d1_name}]...")
        log_fn(f"🗑️ 正在删除 D1 数据库: {d1_name}...")
        rc, out = _run_cmd(wrangler_bin + ["d1", "delete", d1_name, "--skip-confirmation"], job_dir, env_vars, log_fn, timeout=60)
        if rc == 0:
            log_fn(f"✅ D1 数据库 [{d1_name}] 已成功删除")
            deleted_items.append(f"D1: {d1_name}")
        else:
            failed_items.append(f"D1: {d1_name}")
            log_fn(f"❌ D1 数据库删除失败: {_extract_error_summary(out)}")

    # 4. 删除 R2 存储桶
    if delete_r2 and r2_name:
        progress_fn(85, f"正在尝试删除 R2 存储桶 [{r2_name}]...")
        log_fn(f"🗑️ 尝试删除 R2 存储桶: {r2_name}...")
        rc, out = _run_cmd(wrangler_bin + ["r2", "bucket", "delete", r2_name], job_dir, env_vars, log_fn, timeout=60)
        if rc == 0:
            log_fn(f"✅ R2 存储桶 [{r2_name}] 已成功删除")
            deleted_items.append(f"R2: {r2_name}")
        else:
            if "10008" in out or "not empty" in out.lower():
                log_fn(f"⚠️ R2 存储桶 [{r2_name}] 非空，Cloudflare 要求先清空存储桶内文件才能删除。")
            else:
                log_fn(f"❌ R2 存储桶删除失败: {_extract_error_summary(out)}")
            failed_items.append(f"R2: {r2_name}")

    if failed_items:
        fail_fn(f"卸载未完全完成，以下资源删除失败: {', '.join(failed_items)}；已删除的资源: {', '.join(deleted_items) or '无'}")
        return

    progress_fn(100, "卸载/清理执行完毕！")
    summary_text = f"卸载完成！已成功清理: {', '.join(deleted_items)}" if deleted_items else "卸载流水线执行完成（未检测到需清理的资源）。"

    success_fn({
        "ok": True,
        "mode": "uninstall",
        "worker_name": worker_name,
        "account_id": account_id,
        "deleted_items": deleted_items,
        "deployed_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "summary": summary_text,
    })
