"""部署任务生命周期管理、任务调度与 24 小时数据自动销毁"""
import os
import sys
import time
import json
import shutil
import sqlite3
import threading
from pathlib import Path
from contextlib import contextmanager
from typing import Any, Dict, List, Optional, Callable

SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))
REPO_ROOT = SERVER_DIR.parent
DATA_DIR = Path(os.environ.get("EDGECHAT_DATA_DIR", SERVER_DIR / "data"))
JOBS_DIR = Path(os.environ.get("EDGECHAT_JOBS_DIR", "/tmp/edgechat_deploy_jobs"))
DB_PATH = DATA_DIR / "jobs.sqlite3"

JOB_TTL = int(os.environ.get("EDGECHAT_JOB_TTL", str(24 * 3600)))

_db_lock = threading.RLock()
_mem_lock = threading.RLock()
_stop_event = threading.Event()
_initialized = False

_job_runtime_memory: Dict[str, Dict[str, Any]] = {}


def _s(val: Any, default: str = "") -> str:
    if val is None:
        return default
    s = str(val).strip()
    return s if s else default


@contextmanager
def _db():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init() -> None:
    global _initialized
    if _initialized:
        return
    _initialized = True
    _stop_event.clear()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    JOBS_DIR.mkdir(parents=True, exist_ok=True)

    with _db_lock, _db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,           -- queued | running | success | failed | destroyed
                error TEXT,
                worker_name TEXT,
                account_id TEXT,
                route_prefix TEXT,
                progress INTEGER DEFAULT 0,
                current_step TEXT,
                result_json TEXT,
                created_at REAL NOT NULL,
                finished_at REAL
            )
        """)
        conn.execute("""
            UPDATE jobs 
            SET status='failed', error='服务已重启，部署任务已终止，请重新提交。'
            WHERE status IN ('queued', 'running')
        """)

    t_cleaner = threading.Thread(target=_cleaner_loop, name="deploy-cleaner", daemon=True)
    t_cleaner.start()


def stop() -> None:
    global _initialized
    _stop_event.set()
    _initialized = False


def create_job(job_id: str, config: Dict[str, Any]) -> None:
    init()
    worker_name = _s(config.get("worker_name"), "cfchat")
    account_id = _s(config.get("account_id"))
    route_prefix = _s(config.get("route_prefix"))

    with _mem_lock:
        _job_runtime_memory[job_id] = {
            "config": config,
            "logs": [],
            "listeners": [],
            "masks": set(),
        }
        for key in ("api_token", "admin_password", "calls_app_secret", "r2_secret_access_key", "gdrive_client_secret", "gdrive_refresh_token"):
            val = _s(config.get(key))
            if val and len(val) >= 4:
                _job_runtime_memory[job_id]["masks"].add(val)

    with _db_lock, _db() as conn:
        conn.execute("""
            INSERT INTO jobs (
                id, status, error, worker_name, account_id, route_prefix,
                progress, current_step, created_at
            ) VALUES (?, 'queued', NULL, ?, ?, ?, 0, '正在启动部署任务...', ?)
        """, (job_id, worker_name, account_id, route_prefix, time.time()))

    # 启动独立任务线程，确保立即开始执行
    t = threading.Thread(target=_run_single_job, args=(job_id, config), name=f"job-{job_id}", daemon=True)
    t.start()


def _run_single_job(job_id: str, config: Dict[str, Any]) -> None:
    import deployer

    try:
        update_progress(job_id, 5, "正在准备部署沙盒环境...")
        with _db_lock, _db() as conn:
            conn.execute("UPDATE jobs SET status='running', progress=5, current_step='正在准备部署沙盒环境...' WHERE id=?", (job_id,))

        deployer.execute_deploy_pipeline(
            job_id=job_id,
            config=config,
            log_fn=lambda line: append_log(job_id, line),
            progress_fn=lambda p, s: update_progress(job_id, p, s),
            success_fn=lambda res: set_job_success(job_id, res),
            fail_fn=lambda err: set_job_failed(job_id, err),
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        set_job_failed(job_id, f"部署调度异常: {str(e)}")


def append_log(job_id: str, line: str) -> None:
    with _mem_lock:
        runtime = _job_runtime_memory.get(job_id)
        if not runtime:
            return
        
        masked_line = line
        for mask_str in runtime.get("masks", set()):
            if mask_str in masked_line:
                masked_line = masked_line.replace(mask_str, "******")
        
        runtime["logs"].append(masked_line)
        for q in runtime.get("listeners", []):
            try:
                q.put_nowait({"type": "log", "data": masked_line})
            except Exception:
                pass


def update_progress(job_id: str, progress: int, current_step: str) -> None:
    with _mem_lock:
        runtime = _job_runtime_memory.get(job_id)
        if runtime:
            for q in runtime.get("listeners", []):
                try:
                    q.put_nowait({
                        "type": "progress",
                        "progress": progress,
                        "step": current_step
                    })
                except Exception:
                    pass

    with _db_lock, _db() as conn:
        conn.execute("""
            UPDATE jobs 
            SET progress=?, current_step=?
            WHERE id=?
        """, (progress, current_step, job_id))


def set_job_success(job_id: str, result_data: Dict[str, Any]) -> None:
    result_json = json.dumps(result_data, ensure_ascii=False)
    with _mem_lock:
        runtime = _job_runtime_memory.get(job_id)
        if runtime:
            if "config" in runtime and "api_token" in runtime["config"]:
                runtime["config"]["api_token"] = "******"
            for q in runtime.get("listeners", []):
                try:
                    q.put_nowait({
                        "type": "finish",
                        "status": "success",
                        "result": result_data
                    })
                except Exception:
                    pass

    with _db_lock, _db() as conn:
        conn.execute("""
            UPDATE jobs 
            SET status='success', progress=100, current_step='部署成功！',
                result_json=?, finished_at=?
            WHERE id=?
        """, (result_json, time.time(), job_id))


def set_job_failed(job_id: str, error_msg: str) -> None:
    with _mem_lock:
        runtime = _job_runtime_memory.get(job_id)
        if runtime:
            if "config" in runtime and "api_token" in runtime["config"]:
                runtime["config"]["api_token"] = "******"
            for q in runtime.get("listeners", []):
                try:
                    q.put_nowait({
                        "type": "finish",
                        "status": "failed",
                        "error": error_msg
                    })
                except Exception:
                    pass

    with _db_lock, _db() as conn:
        conn.execute("""
            UPDATE jobs 
            SET status='failed', error=?, current_step='部署失败', finished_at=?
            WHERE id=?
        """, (error_msg, time.time(), job_id))


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    with _db_lock, _db() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,))
        record = row.fetchone()
        if not record:
            return None
        info = dict(record)

    with _mem_lock:
        runtime = _job_runtime_memory.get(job_id)
        if runtime:
            info["logs"] = runtime.get("logs", [])
        else:
            info["logs"] = []

    if info.get("result_json"):
        try:
            info["result"] = json.loads(info["result_json"])
        except Exception:
            info["result"] = None
    else:
        info["result"] = None

    return info


def register_listener(job_id: str) -> "queue.Queue":
    import queue as q_mod
    q = q_mod.Queue()
    with _mem_lock:
        if job_id not in _job_runtime_memory:
            _job_runtime_memory[job_id] = {"logs": [], "listeners": [], "masks": set()}
        _job_runtime_memory[job_id]["listeners"].append(q)
    return q


def unregister_listener(job_id: str, q: Any) -> None:
    with _mem_lock:
        runtime = _job_runtime_memory.get(job_id)
        if runtime and q in runtime.get("listeners", []):
            runtime["listeners"].remove(q)


def destroy_job(job_id: str) -> bool:
    job_dir = JOBS_DIR / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)

    with _mem_lock:
        if job_id in _job_runtime_memory:
            del _job_runtime_memory[job_id]

    with _db_lock, _db() as conn:
        conn.execute("DELETE FROM jobs WHERE id=?", (job_id,))

    return True


def _cleaner_loop() -> None:
    while not _stop_event.is_set():
        try:
            cutoff = time.time() - JOB_TTL
            expired_ids = []
            with _db_lock, _db() as conn:
                rows = conn.execute("SELECT id FROM jobs WHERE created_at < ?", (cutoff,)).fetchall()
                expired_ids = [row["id"] for row in rows]
            for job_id in expired_ids:
                destroy_job(job_id)
        except Exception:
            pass
        _stop_event.wait(600)
