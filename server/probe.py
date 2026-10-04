"""Cloudflare API 探测与权限检查模块"""
import ssl
import json
import urllib.request
from typing import Any, Dict, List, Optional

API_BASE = "https://api.cloudflare.com/client/v4"


def _cf_request(token: str, path: str, method: str = "GET", body: Optional[dict] = None, timeout: int = 8) -> Dict[str, Any]:
    url = f"{API_BASE}{path}"
    headers = {
        "Authorization": f"Bearer {token.strip()}",
        "Content-Type": "application/json",
        "User-Agent": "Edgechat-Web-Deployer/1.0"
    }
    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    ctx = ssl.create_default_context()
    
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as response:
            res_text = response.read().decode("utf-8")
            return json.loads(res_text)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            return json.loads(err_body)
        except Exception:
            return {"success": False, "errors": [{"code": e.code, "message": str(e)}]}
    except Exception as e:
        return {"success": False, "errors": [{"code": 0, "message": str(e)}]}


def probe_worker_bindings(
    token: str,
    account_id: str,
    worker_name: str,
    d1_list: Optional[List[Dict[str, Any]]] = None,
    kv_list: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    通过 Cloudflare API 查询指定 Worker 的绑定配置 (D1, KV, R2, 环境变量等) 并精确反解资源名
    """
    worker_name = worker_name.strip()
    if not worker_name or not account_id or not token:
        return {"found": False, "error": "缺少必要参数"}

    s_res = _cf_request(token, f"/accounts/{account_id}/workers/scripts/{worker_name}/settings")
    bindings = []
    if s_res.get("success") and isinstance(s_res.get("result"), dict):
        bindings = s_res["result"].get("bindings", [])
    if not bindings:
        b_res = _cf_request(token, f"/accounts/{account_id}/workers/scripts/{worker_name}/bindings")
        if b_res.get("success") and isinstance(b_res.get("result"), list):
            bindings = b_res["result"]

    if not bindings and not s_res.get("success"):
        errors = s_res.get("errors", [])
        err_msg = "; ".join(f"{e.get('code')}: {e.get('message')}" for e in errors) or "Worker 不存在或无权限"
        return {"found": False, "error": err_msg}

    detected_d1_id = None
    detected_d1_name = None
    detected_kv_id = None
    detected_kv_name = None
    detected_r2_bucket = None
    detected_prefix = ""
    detected_disguise = "nginx"
    has_do = False

    for b in bindings:
        if not isinstance(b, dict):
            continue
        b_name = b.get("name")
        b_type = b.get("type")

        # D1 数据库绑定
        if b_type in ["d1", "d1_database"] or b_name == "DB":
            detected_d1_id = str(b.get("id") or b.get("database_id") or "").strip()
            if b.get("database_name"):
                detected_d1_name = str(b.get("database_name")).strip()

        # KV 命名空间绑定
        elif b_type == "kv_namespace" or b_name == "SESSIONS":
            detected_kv_id = str(b.get("namespace_id") or b.get("id") or "").strip()

        # R2 存储桶绑定
        elif b_type == "r2_bucket" or b_name == "FILES":
            detected_r2_bucket = str(b.get("bucket_name") or "").strip()

        # Durable Objects 绑定
        elif b_type == "durable_object_namespace":
            has_do = True

        # 环境变量
        elif b_name == "ROUTE_PREFIX" and b_type in ["plain_text", "secret_text", "var"]:
            detected_prefix = str(b.get("text") or "").strip()
        elif b_name == "DISGUISE_HOST" and b_type in ["plain_text", "secret_text", "var"]:
            detected_disguise = str(b.get("text") or "").strip()

    # 如果有 D1 ID 但未得到名称，查询 D1 列表反向解析名称
    if detected_d1_id and not detected_d1_name:
        if d1_list is None:
            d1_res = _cf_request(token, f"/accounts/{account_id}/d1/database?per_page=100")
            if d1_res.get("success") and d1_res.get("result"):
                d1_list = d1_res["result"]
        if d1_list:
            for d in d1_list:
                uuid = str(d.get("uuid") or d.get("id") or d.get("database_id") or "").strip()
                if uuid == detected_d1_id:
                    detected_d1_name = str(d.get("name") or d.get("database_name") or "").strip()
                    break

    # 如果有 KV ID 但未得到标题，查询 KV 列表反向解析标题
    if detected_kv_id and not detected_kv_name:
        if kv_list is None:
            kv_res = _cf_request(token, f"/accounts/{account_id}/storage/kv/namespaces?per_page=100")
            if kv_res.get("success") and kv_res.get("result"):
                kv_list = kv_res["result"]
        if kv_list:
            for k in kv_list:
                kid = str(k.get("id") or "").strip()
                if kid == detected_kv_id:
                    detected_kv_name = str(k.get("title") or "").strip()
                    break

    return {
        "found": True,
        "worker_name": worker_name,
        "d1_id": detected_d1_id or "",
        # 不回填部署默认值。执行销毁操作的调用方必须能区分“未绑定”与
        # “确实绑定到惯用名称的资源”。
        "d1_name": detected_d1_name or "",
        "kv_id": detected_kv_id or "",
        "kv_namespace": detected_kv_name or "",
        "r2_bucket": detected_r2_bucket or "",
        "has_r2": bool(detected_r2_bucket),
        "has_do": has_do,
        "route_prefix": detected_prefix,
        "disguise_host": detected_disguise or "nginx",
    }


def probe_token(token: str, account_id: Optional[str] = None) -> Dict[str, Any]:
    """
    校验 API Token 并探测当前账号下的可用资源权限与 R2 开通状态
    """
    token = token.strip()
    if not token or len(token) < 10:
        return {
            "valid": False,
            "error": "API Token 格式不正确或为空",
            "accounts": [],
            "r2_enabled": False,
            "permissions": {}
        }

    # 1. 验证 Token 有效性
    verify_res = _cf_request(token, "/user/tokens/verify")
    if not verify_res.get("success"):
        errors = verify_res.get("errors", [])
        err_msg = "; ".join(f"{e.get('code')}: {e.get('message')}" for e in errors) or "Token 无效或已过期"
        return {
            "valid": False,
            "error": f"Cloudflare API 验证失败: {err_msg}",
            "accounts": [],
            "r2_enabled": False,
            "permissions": {}
        }

    # 2. 获取关联的 Account 列表
    accounts: List[Dict[str, str]] = []
    acc_res = _cf_request(token, "/accounts?per_page=50")
    if acc_res.get("success") and acc_res.get("result"):
        for item in acc_res["result"]:
            acc_id = str(item.get("id", "")).strip()
            acc_name = str(item.get("name", "Account")).strip()
            if acc_id:
                accounts.append({"id": acc_id, "name": acc_name})

    # 确定目标 Account ID
    target_acc_id = account_id.strip() if account_id else None
    if not target_acc_id and accounts:
        target_acc_id = accounts[0]["id"]

    permissions = {
        "workers": False,
        "d1": False,
        "kv": False,
        "r2": False,
        "calls": False,
    }
    r2_enabled = False
    missing_permissions = []
    existing_deployment = {
        "detected": False,
        "worker_name": "cfchat",
        "d1_name": "cfchat-db",
        "kv_namespace": "SESSIONS",
        "r2_bucket": "cfchat-files",
    }

    # 3. 如果能锁定具体 Account ID，检查各项子资源权限
    if target_acc_id:
        # 检查 Workers 权限
        w_res = _cf_request(token, f"/accounts/{target_acc_id}/workers/scripts?per_page=50")
        if w_res.get("success"):
            permissions["workers"] = True
        else:
            missing_permissions.append("Workers (编辑/读取)")

        # 检查 D1 权限
        d1_res = _cf_request(token, f"/accounts/{target_acc_id}/d1/database?per_page=50")
        if d1_res.get("success"):
            permissions["d1"] = True
        else:
            missing_permissions.append("D1 (编辑/读取)")

        # 检查 KV 权限
        kv_res = _cf_request(token, f"/accounts/{target_acc_id}/storage/kv/namespaces?per_page=50")
        if kv_res.get("success"):
            permissions["kv"] = True
        else:
            missing_permissions.append("Workers KV (编辑/读取)")

        # 检查 R2 权限与是否绑卡激活
        r2_res = _cf_request(token, f"/accounts/{target_acc_id}/r2/buckets?per_page=50")
        if r2_res.get("success"):
            permissions["r2"] = True
            r2_enabled = True
        else:
            errors = r2_res.get("errors", [])
            error_codes = [e.get("code") for e in errors]
            if 10042 in error_codes:
                # 10042: R2 not enabled / 未绑定信用卡
                r2_enabled = False
                permissions["r2"] = True  # Token 有 R2 权限，但账号尚未激活 R2
            else:
                r2_enabled = False
                permissions["r2"] = False

        # 检查 Calls 权限
        calls_probe = _cf_request(token, f"/accounts/{target_acc_id}/calls/apps?per_page=1")
        if calls_probe.get("success"):
            permissions["calls"] = True
        else:
            permissions["calls"] = False

        # 4. 探测已有的 Edgechat / cfchat 历史部署资源
        if permissions["workers"] or permissions["d1"]:
            detected_w = None
            detected_d = None
            detected_k = None
            detected_r = None

            if w_res.get("success") and w_res.get("result"):
                for s in w_res["result"]:
                    s_id = str(s.get("id", "")).strip()
                    if s_id.lower() in ["cfchat", "edgechat"] or "edgechat" in s_id.lower() or "cfchat" in s_id.lower():
                        detected_w = s_id
                        break

            # 默认兜底名称查找
            if d1_res.get("success") and d1_res.get("result"):
                for d in d1_res["result"]:
                    d_name = str(d.get("name") or d.get("database_name") or "").strip()
                    if d_name.lower() in ["cfchat-db", "edgechat-db"] or "cfchat" in d_name.lower() or "edgechat" in d_name.lower():
                        detected_d = d_name
                        break

            if permissions["kv"] and kv_res.get("success") and kv_res.get("result"):
                for k in kv_res["result"]:
                    k_title = str(k.get("title", "")).strip()
                    if k_title.lower() in ["sessions", "cfchat-sessions", "edgechat-sessions"] or "sessions" in k_title.lower():
                        detected_k = k_title
                        break

            if permissions["r2"] and r2_enabled and r2_res.get("success"):
                raw_b = r2_res.get("result")
                buckets = raw_b if isinstance(raw_b, list) else raw_b.get("buckets", []) if isinstance(raw_b, dict) else []
                for b in buckets:
                    b_name = str(b.get("name", "")).strip()
                    if b_name.lower() in ["cfchat-files", "edgechat-files"] or "cfchat" in b_name.lower() or "edgechat" in b_name.lower():
                        detected_r = b_name
                        break

            detected_prefix = ""
            detected_disguise = "nginx"

            # 优先通过 detected_w 的真实 bindings 精确提取绑定资源
            if detected_w:
                w_bindings = probe_worker_bindings(
                    token,
                    target_acc_id,
                    detected_w,
                    d1_list=d1_res.get("result") if d1_res.get("success") else None,
                    kv_list=kv_res.get("result") if kv_res.get("success") else None,
                )
                if w_bindings.get("found"):
                    detected_d = w_bindings.get("d1_name") or detected_d
                    detected_k = w_bindings.get("kv_namespace") or detected_k
                    detected_r = w_bindings.get("r2_bucket") or detected_r
                    detected_prefix = w_bindings.get("route_prefix") or ""
                    detected_disguise = w_bindings.get("disguise_host") or "nginx"

            if detected_w or detected_d:
                existing_deployment = {
                    "detected": True,
                    "worker_name": detected_w or "cfchat",
                    "d1_name": detected_d or "cfchat-db",
                    "kv_namespace": detected_k or "SESSIONS",
                    "r2_bucket": detected_r or "cfchat-files",
                    "route_prefix": detected_prefix,
                    "disguise_host": detected_disguise or "nginx",
                }

    return {
        "valid": True,
        "accounts": accounts,
        "selected_account_id": target_acc_id,
        "r2_enabled": r2_enabled,
        "permissions": permissions,
        "missing_permissions": missing_permissions,
        "existing_deployment": existing_deployment,
    }
