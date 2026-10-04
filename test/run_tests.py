import sys
import json
from pathlib import Path
from unittest.mock import patch, MagicMock

SERVER_DIR = Path(__file__).resolve().parent.parent / "server"
sys.path.insert(0, str(SERVER_DIR))

import deployer
real_execute_deploy_pipeline = deployer.execute_deploy_pipeline
deployer.execute_deploy_pipeline = MagicMock()

import jobs
import probe
import main
from main import ProbeRequest, DeployRequest, ProbeWorkerRequest

def test_all():
    print("[1/6] Testing health endpoint directly...", flush=True)
    expected_version = json.loads((SERVER_DIR.parent / "package.json").read_text(encoding="utf-8"))["version"]
    res = main.health_check()
    assert res["status"] == "ok"
    assert res["version"] == expected_version
    ver_res = main.api_version()
    assert ver_res["version"] == expected_version
    print("  -> OK:", res, flush=True)

    print("[2/6] Testing probe with invalid token...", flush=True)
    res = main.api_probe(ProbeRequest(api_token="short"))
    assert res["valid"] is False
    print("  -> OK (rejected short token)", flush=True)

    print("[3/6] Testing probe mock & R2 10042 fallback...", flush=True)
    with patch.object(probe, "_cf_request") as mock_req:
        mock_req.side_effect = lambda t, p, m="GET", b=None, to=15: (
            {"success": True, "result": {"status": "active"}} if p == "/user/tokens/verify"
            else {"success": True, "result": [{"id": "acc_mock_999", "name": "Mock Acc"}]} if "/accounts?per_page=50" in p
            else {"success": True, "result": []} if any(k in p for k in ["workers/scripts", "d1/database", "storage/kv/namespaces"])
            else {"success": False, "errors": [{"code": 10042, "message": "R2 not enabled"}]}
        )
        res = main.api_probe(ProbeRequest(api_token="mock_test_token_123456"))
        assert res["valid"] is True
        assert res["selected_account_id"] == "acc_mock_999"
        assert res["r2_enabled"] is False
        print("  -> OK (R2 10042 detected and degraded safely)", flush=True)

    print("[4/6] Testing job creation, log masking, and state...", flush=True)
    job_id = "test_run_job_001"
    jobs.create_job(job_id, {
        "api_token": "secret_token_val_123456",
        "worker_name": "cfchat-test",
        "admin_password": "super_secret_admin_pass"
    })
    jobs.append_log(job_id, "Auth with secret_token_val_123456 pass super_secret_admin_pass")
    job = jobs.get_job(job_id)
    assert "secret_token_val_123456" not in job["logs"][0]
    assert "super_secret_admin_pass" not in job["logs"][0]
    assert "******" in job["logs"][0]
    print("  -> OK (Logs masked: " + job["logs"][0] + ")", flush=True)

    print("[5/6] Testing immediate data destruction...", flush=True)
    job_dir = jobs.JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "secret_file.txt").write_text("secret")
    assert (job_dir / "secret_file.txt").exists()

    res_del = main.api_destroy_job(job_id)
    assert res_del["success"] is True
    assert not job_dir.exists()
    assert jobs.get_job(job_id) is None
    print("  -> OK (Directory erased and metadata purged)", flush=True)

    print("[6/6] Testing static web files existence & integrity...", flush=True)
    static_index = main.STATIC_DIR / "index.html"
    static_css = main.STATIC_DIR / "style.css"
    static_js = main.STATIC_DIR / "app.js"
    assert static_index.exists() and static_index.stat().st_size > 500
    assert static_css.exists() and static_css.stat().st_size > 500
    assert static_js.exists() and static_js.stat().st_size > 500
    html_content = static_index.read_text(encoding="utf-8")
    assert "appVersionBadge" in html_content
    assert "resVersion" in html_content
    assert "footerVersion" in html_content
    js_content = static_js.read_text(encoding="utf-8")
    assert "syncAppVersion" in js_content
    assert "badge-version" in static_css.read_text(encoding="utf-8")
    print("  -> OK (index.html, style.css, app.js verified)", flush=True)

    print("[7/7] Testing Google Drive storage options & web deployer wiring...", flush=True)
    req_gd = DeployRequest(
        api_token="valid_cf_token_1234567890",
        account_id="acc_test_123",
        storage_type="gdrive",
        gdrive_client_id="123456.apps.googleusercontent.com",
        gdrive_client_secret="GOCSPX-secret",
        gdrive_refresh_token="1//04testtoken",
        gdrive_folder_id="1AbC_FolderId"
    )
    assert req_gd.storage_type == "gdrive"
    assert req_gd.gdrive_client_id == "123456.apps.googleusercontent.com"
    html_content = static_index.read_text(encoding="utf-8")
    assert "storageCardGDrive" in html_content
    assert "gdriveConfigBlock" in html_content
    assert "r2ConfigBlock" in html_content
    assert "Google Drive 云端硬盘 (免绑卡 · 15GB 免费)" in html_content
    js_content = static_js.read_text(encoding="utf-8")
    assert "gdriveConfigBlock" in js_content
    assert "r2ConfigBlock" in js_content
    assert "updateStorageSection" in js_content
    print("  -> OK (Google Drive storage options and frontend toggles validated)", flush=True)

    print("[8/8] Testing deploy_mode (Fresh vs Incremental Update) & existing resource detection...", flush=True)
    req_update = DeployRequest(
        deploy_mode="update",
        api_token="valid_cf_token_1234567890",
        account_id="acc_test_123",
        worker_name="cfchat",
        d1_name="cfchat-db",
        kv_namespace="CUSTOM_SESSIONS",
        r2_bucket="custom-files-bucket"
    )
    assert req_update.deploy_mode == "update"
    assert req_update.kv_namespace == "CUSTOM_SESSIONS"
    assert req_update.r2_bucket == "custom-files-bucket"
    assert req_update.clear_route_prefix is False

    req_update_clear = DeployRequest(
        deploy_mode="update",
        api_token="valid_cf_token_1234567890",
        account_id="acc_test_123",
        worker_name="cfchat",
        clear_route_prefix=True
    )
    assert req_update_clear.clear_route_prefix is True

    html_content_new = static_index.read_text(encoding="utf-8")
    js_content_new = static_js.read_text(encoding="utf-8")
    assert "modeCardFresh" in html_content_new
    assert "modeCardUpdate" in html_content_new
    assert "deploy_mode" in js_content_new
    assert "updateModeSection" in js_content_new
    assert "updateKvNamespace" in html_content_new
    assert "updateR2Bucket" in html_content_new
    assert "btnDetectWorker" in html_content_new
    assert "workerDetectBadge" in html_content_new
    assert "detectWorkerBindings" in js_content_new
    assert "updateClearPrefix" in html_content_new
    assert "clear_route_prefix" in js_content_new
    assert "恢复根目录直接访问" in html_content_new

    mock_bindings = [
        {"name": "DB", "type": "d1", "id": "db-uuid-888", "database_name": "cfchat-db"},
        {"name": "SESSIONS", "type": "kv_namespace", "namespace_id": "kv-id-999"},
        {"name": "FILES", "type": "r2_bucket", "bucket_name": "cfchat-custom-r2"},
        {"name": "CHANNEL_ROOM", "type": "durable_object_namespace", "class_name": "ChannelRoom"},
        {"name": "ROUTE_PREFIX", "type": "plain_text", "text": "secret_entry,portal2"},
        {"name": "DISGUISE_HOST", "type": "plain_text", "text": "my-disguise.com"}
    ]

    with patch.object(probe, "_cf_request") as mock_req_update:
        mock_req_update.side_effect = lambda t, p, m="GET", b=None, to=15: (
            {"success": True, "result": {"status": "active"}} if p == "/user/tokens/verify"
            else {"success": True, "result": [{"id": "acc_mock_999", "name": "Mock Acc"}]} if "/accounts?per_page=50" in p
            else {"success": True, "result": {"bindings": mock_bindings}} if "workers/scripts/cfchat/settings" in p
            else {"success": True, "result": [{"id": "cfchat"}]} if "workers/scripts" in p
            else {"success": True, "result": [{"name": "cfchat-db", "uuid": "db-uuid-888"}]} if "d1/database" in p
            else {"success": True, "result": [{"id": "kv-id-999", "title": "SESSIONS_TITLE"}]} if "storage/kv/namespaces" in p
            else {"success": True, "result": [{"name": "cfchat-custom-r2"}]} if "r2/buckets" in p
            else {"success": False, "errors": [{"code": 0, "message": "error"}]}
        )
        # 1. 验证全局 probe 自动解析绑定资源
        probe_res = main.api_probe(ProbeRequest(api_token="mock_test_token_123456"))
        assert probe_res["valid"] is True
        assert probe_res["existing_deployment"]["detected"] is True
        assert probe_res["existing_deployment"]["worker_name"] == "cfchat"
        assert probe_res["existing_deployment"]["d1_name"] == "cfchat-db"
        assert probe_res["existing_deployment"]["kv_namespace"] == "SESSIONS_TITLE"
        assert probe_res["existing_deployment"]["r2_bucket"] == "cfchat-custom-r2"
        assert probe_res["existing_deployment"]["route_prefix"] == "secret_entry,portal2"
        assert probe_res["existing_deployment"]["disguise_host"] == "my-disguise.com"

        # 2. 验证针对单个 Worker 的 probe API (/api/probe/worker)
        single_res = main.api_probe_worker(ProbeWorkerRequest(
            api_token="mock_test_token_123456",
            account_id="acc_mock_999",
            worker_name="cfchat"
        ))
        assert single_res["found"] is True
        assert single_res["worker_name"] == "cfchat"
        assert single_res["d1_id"] == "db-uuid-888"
        assert single_res["d1_name"] == "cfchat-db"
        assert single_res["kv_id"] == "kv-id-999"
        assert single_res["kv_namespace"] == "SESSIONS_TITLE"
        assert single_res["r2_bucket"] == "cfchat-custom-r2"
        assert single_res["has_do"] is True
        assert single_res["route_prefix"] == "secret_entry,portal2"
        assert single_res["disguise_host"] == "my-disguise.com"

        print("  -> OK (Worker bindings auto-detection & incremental update fields verified)", flush=True)

    print("[9/9] Testing safe update/uninstall behavior when bindings are absent...", flush=True)
    with patch.object(deployer, "probe_worker_bindings", return_value={"found": False}):
        failures = []
        real_execute_deploy_pipeline(
            "test_missing_worker",
            {"deploy_mode": "update", "api_token": "mock_test_token_123456", "account_id": "acc_mock_999", "worker_name": "missing-worker"},
            lambda _line: None,
            lambda _progress, _step: None,
            lambda _result: (_ for _ in ()).throw(AssertionError("missing Worker must not deploy")),
            failures.append,
        )
        assert failures and "不会创建新资源" in failures[0]

    with patch.object(deployer, "probe_worker_bindings", return_value={"found": True, "d1_name": "", "kv_id": "", "kv_namespace": "", "r2_bucket": ""}):
        uninstall_results = []
        deployer._execute_uninstall_pipeline(
            "test_unbound_resources",
            {"api_token": "mock_test_token_123456", "account_id": "acc_mock_999", "worker_name": "boundless-worker", "delete_worker": False, "delete_d1": True, "delete_kv": True, "delete_r2": True, "confirm_text": "DELETE"},
            lambda _line: None,
            lambda _progress, _step: None,
            uninstall_results.append,
            lambda error: (_ for _ in ()).throw(AssertionError(error)),
        )
        assert uninstall_results and uninstall_results[0]["deleted_items"] == []
    print("  -> OK (No implicit resources created or deleted)", flush=True)

    jobs.stop()
    print("\n========================================")
    print("🎉 ALL 9 TEST SUITES PASSED SUCCESSFULLY!")
    print("========================================")

if __name__ == "__main__":
    test_all()
