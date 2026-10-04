"""Edgechat Web Deployer 服务端主入口"""
import os
import sys
import json
import secrets
import asyncio
from pathlib import Path
from typing import Any, Dict, Optional, Literal

SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from fastapi import FastAPI, HTTPException, Request, Response, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import jobs
from probe import probe_token, probe_worker_bindings

STATIC_DIR = SERVER_DIR / "static"

def get_project_version() -> str:
    for candidate in [
        SERVER_DIR.parent / "package.json",
        Path("/app/package.json"),
        Path("package.json"),
    ]:
        if candidate.exists():
            try:
                with open(candidate, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("version"):
                        return str(data["version"])
            except Exception:
                pass
    return "1.0.0"

PROJECT_VERSION = get_project_version()

app = FastAPI(
    title="Edgechat Web Deployer",
    description="通过 Web 界面一键自动化部署 Edgechat 至 Cloudflare",
    version=PROJECT_VERSION,
    docs_url=None,
    redoc_url=None
)

# 允许跨域（方便本地开发或多端口反代）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 初始化任务系统与后台清理线程
jobs.init()


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    svg_icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%233b82f6" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
    return Response(content=svg_icon, media_type="image/svg+xml")


class ProbeRequest(BaseModel):
    api_token: str = Field(..., description="Cloudflare API Token")
    account_id: Optional[str] = Field(None, description="可选的目标 Account ID")


class ProbeWorkerRequest(BaseModel):
    api_token: str = Field(..., description="Cloudflare API Token")
    account_id: Optional[str] = Field(None, description="可选的目标 Account ID")
    worker_name: str = Field(..., description="要探测的 Cloudflare Worker 服务名")


class DeployRequest(BaseModel):
    deploy_mode: Literal["fresh", "update", "reset_admin", "uninstall", "reset_hard", "reset"] = Field("fresh", description="部署模式: fresh (全新部署), update (增量更新), reset_admin (重置管理员密码), uninstall (卸载/硬重置)")
    api_token: str = Field(..., description="Cloudflare API Token")
    account_id: Optional[str] = Field(None, description="目标 Account ID")
    worker_name: str = Field("cfchat", description="Cloudflare Worker 服务名")
    route_prefix: str = Field("", description="隐藏入口路径前缀 (如 secret1,secret2)")
    clear_route_prefix: bool = Field(False, description="是否显式清除隐藏入口路径前缀，恢复根目录直接访问")
    disguise_host: str = Field("nginx", description="反代伪装站点域名")
    admin_username: str = Field("admin", description="管理员用户名")
    admin_password: Optional[str] = Field(None, description="管理员密码 (留空则自动生成)")
    admin_display_name: str = Field("Administrator", description="管理员显示名称")
    d1_name: str = Field("cfchat-db", description="D1 数据库名")
    kv_namespace: str = Field("SESSIONS", description="KV 命名空间名")
    r2_bucket: str = Field("cfchat-files", description="R2 存储桶名")
    enable_r2: bool = Field(True, description="是否启用 R2 文件存储")
    calls_app_id: Optional[str] = Field(None, description="Calls App ID")
    calls_app_secret: Optional[str] = Field(None, description="Calls App Secret")
    r2_access_key_id: Optional[str] = Field(None, description="R2 Access Key ID")
    r2_secret_access_key: Optional[str] = Field(None, description="R2 Secret Access Key")
    r2_account_id: Optional[str] = Field(None, description="R2 Account ID")
    storage_type: str = Field("r2", description="存储引擎类型 (r2 或 gdrive)")
    gdrive_client_id: Optional[str] = Field(None, description="Google Client ID")
    gdrive_client_secret: Optional[str] = Field(None, description="Google Client Secret")
    gdrive_refresh_token: Optional[str] = Field(None, description="Google Refresh Token")
    gdrive_folder_id: Optional[str] = Field(None, description="Google Drive 根目录 Folder ID")
    # 卸载/硬重置专属控制字段
    delete_worker: bool = Field(True, description="卸载模式：是否删除 Worker 服务")
    delete_d1: bool = Field(True, description="卸载模式：是否销毁 D1 数据库")
    delete_kv: bool = Field(True, description="卸载模式：是否销毁 KV 缓存空间")
    delete_r2: bool = Field(False, description="卸载模式：是否尝试清理 R2 存储桶")
    confirm_text: Optional[str] = Field(None, description="卸载模式：防误触安全确认输入")


@app.get("/api/health")
def health_check():
    return {"status": "ok", "app": "Edgechat Web Deployer", "version": PROJECT_VERSION}


@app.get("/api/version")
def api_version():
    return {"version": PROJECT_VERSION}


@app.post("/api/probe")
def api_probe(payload: ProbeRequest):
    """
    探测 Cloudflare API Token 有效性，拉取 Account 列表并检查权限与 R2 激活状态
    """
    token = payload.api_token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="API Token 不能为空")
    result = probe_token(token, payload.account_id)
    return result


@app.post("/api/probe/worker")
def api_probe_worker(payload: ProbeWorkerRequest):
    """
    精确查询指定 Worker 绑定的 D1、KV、R2、环境变量与 DO 资源配置
    """
    token = payload.api_token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="API Token 不能为空")
    worker_name = payload.worker_name.strip()
    if not worker_name:
        raise HTTPException(status_code=400, detail="Worker 服务名不能为空")

    account_id = payload.account_id.strip() if payload.account_id else None
    if not account_id:
        probe_res = probe_token(token)
        account_id = probe_res.get("selected_account_id")
        if not account_id:
            raise HTTPException(status_code=400, detail="未能自动确定 Cloudflare Account ID，请先验证 Token 或指定 account_id")

    return probe_worker_bindings(token, account_id, worker_name)


@app.post("/api/deploy")
def api_create_deploy(payload: DeployRequest):
    """
    提交部署任务
    """
    token = payload.api_token.strip()
    if not token or len(token) < 10:
        raise HTTPException(status_code=400, detail="请填写有效的 Cloudflare API Token")

    job_id = secrets.token_urlsafe(12)
    config = payload.model_dump()

    jobs.create_job(job_id, config)
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/jobs/{job_id}")
def api_get_job(job_id: str):
    """
    查询任务状态、进度与日志
    """
    info = jobs.get_job(job_id)
    if not info:
        raise HTTPException(status_code=404, detail="部署任务不存在或已彻底销毁")
    return info


@app.get("/api/jobs/{job_id}/stream")
async def api_job_stream(job_id: str, request: Request):
    """
    SSE 实时事件流推送部署日志与状态
    """
    info = jobs.get_job(job_id)
    if not info:
        raise HTTPException(status_code=404, detail="部署任务不存在或已销毁")

    q = jobs.register_listener(job_id)

    async def event_generator():
        try:
            # 首次连接发送已有历史日志
            existing_info = jobs.get_job(job_id)
            if existing_info:
                init_payload = {
                    "type": "init",
                    "status": existing_info["status"],
                    "progress": existing_info["progress"],
                    "step": existing_info["current_step"],
                    "logs": existing_info.get("logs", []),
                    "result": existing_info.get("result"),
                    "error": existing_info.get("error")
                }
                yield f"data: {json.dumps(init_payload, ensure_ascii=False)}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    # 每 0.5 秒检查队列
                    msg = await asyncio.to_thread(q.get, timeout=0.5)
                    yield f"data: {json.dumps(msg, ensure_ascii=False)}\n\n"
                    if msg.get("type") == "finish":
                        break
                except Exception:
                    # 发送心跳以防客户端超时断开
                    yield ": ping\n\n"
                    await asyncio.sleep(0.5)
        finally:
            jobs.unregister_listener(job_id, q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.post("/api/jobs/{job_id}/destroy")
@app.delete("/api/jobs/{job_id}")
def api_destroy_job(job_id: str):
    """
    立即物理销毁任务的所有数据（临时目录、日志、配置）
    """
    success = jobs.destroy_job(job_id)
    return {
        "success": success,
        "job_id": job_id,
        "message": "本次部署的所有临时数据、日志与凭证已从服务器彻底物理销毁！"
    }


# 挂载纯静态前端
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
