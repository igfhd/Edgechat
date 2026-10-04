import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const deployerPyPath = resolve(repoRoot, "server/deployer.py");
const indexHtmlPath = resolve(repoRoot, "server/static/index.html");
const appJsPath = resolve(repoRoot, "server/static/app.js");

test("Web Deployer 后端: DeployRequest Pydantic 模型支持 reset_admin 与 uninstall 模式及清理参数", (t) => {
	try {
		execFileSync("python3", ["-c", "from server.main import DeployRequest"], {
			cwd: repoRoot,
			stdio: "ignore",
		});
	} catch {
		const mainCode = readFileSync(resolve(repoRoot, "server/main.py"), "utf8");
		assert.match(mainCode, /deploy_mode:\s*Literal\[.*"reset_admin"/);
		assert.match(mainCode, /confirm_text:\s*Optional\[str\]/);
		t?.skip?.("Python 运行环境缺少 server.main 依赖，已执行源码静态断言并跳过动态验证");
		return;
	}

	const pythonCode = `
import sys
from server.main import DeployRequest
from pydantic import ValidationError

# 1. 验证合法模式
req_reset = DeployRequest(api_token="cf_tok_123", deploy_mode="reset_admin", worker_name="test-worker", admin_password="NewPass123!")
assert req_reset.deploy_mode == "reset_admin"
assert req_reset.worker_name == "test-worker"

req_uninstall = DeployRequest(
    api_token="cf_tok_123",
    deploy_mode="uninstall",
    worker_name="test-worker",
    delete_worker=True,
    delete_d1=True,
    delete_kv=True,
    delete_r2=False,
    confirm_text="DELETE"
)
assert req_uninstall.deploy_mode == "uninstall"
assert req_uninstall.delete_worker is True
assert req_uninstall.confirm_text == "DELETE"

# 2. 验证非法模式抛出 ValidationError
try:
    DeployRequest(api_token="cf_tok_123", deploy_mode="unsupported_mode")
    sys.exit(1)
except ValidationError:
    pass

print("OK")
`;

	const out = execFileSync("python3", ["-c", pythonCode], {
		cwd: repoRoot,
		encoding: "utf8",
	});
	assert.match(out, /OK/);
});

test("Web Deployer 后端: deployer.py 包含 reset_admin 和 uninstall 流水线及安全防误触校验", () => {
	const deployerCode = readFileSync(deployerPyPath, "utf8");

	assert.match(deployerCode, /def _execute_admin_reset_pipeline/);
	assert.match(deployerCode, /def _execute_uninstall_pipeline/);
	assert.match(deployerCode, /if deploy_mode == "reset_admin":/);
	assert.match(deployerCode, /if deploy_mode in \("uninstall", "reset_hard", "reset"\):/);
	// 安全校验
	assert.match(deployerCode, /expected_confirm = \["DELETE", worker_name\.strip\(\)\]/);
	assert.match(deployerCode, /"EDGECHAT_ADMIN_RESET_PASSWORD": "1"/);
	assert.match(deployerCode, /增量更新不会创建新资源/);
	assert.match(deployerCode, /缺少 Edgechat 必需的 D1 绑定/);
	assert.match(deployerCode, /sessions-recovered/);
	assert.match(deployerCode, /KV 恢复完成：历史登录会话已失效/);
	assert.match(deployerCode, /执行 D1 增量迁移失败/);
});

test("Web Deployer 前端结构: index.html 包含全部 4 种模式卡片与相应表单/交付区", () => {
	const html = readFileSync(indexHtmlPath, "utf8");

	// 模式卡片
	assert.match(html, /id="modeCardFresh"/);
	assert.match(html, /id="modeCardUpdate"/);
	assert.match(html, /id="modeCardResetAdmin"/);
	assert.match(html, /id="modeCardUninstall"/);

	// 表单视图
	assert.match(html, /id="resetAdminSection"/);
	assert.match(html, /id="uninstallSection"/);
	assert.match(html, /id="uninstallWorkerName"/);
	assert.match(html, /id="uninstallConfirmInput"/);
	assert.match(html, /id="delWorkerCheck"/);
	assert.match(html, /id="delD1Check"/);
	assert.match(html, /id="delKvCheck"/);
	assert.match(html, /id="delR2Check"/);

	// 交付视图
	assert.match(html, /id="resUninstallSection"/);
	assert.match(html, /id="resUninstallSummary"/);
});

test("Web Deployer 前端交互: app.js 包含模式切换、确认验证、交付分发与备忘导出", () => {
	const js = readFileSync(appJsPath, "utf8");

	// 模式切换
	assert.match(js, /mode === 'reset_admin'/);
	assert.match(js, /mode === 'uninstall'/);

	// 表单提交安全确认
	assert.match(js, /confirmVal !== 'DELETE' && confirmVal !== workerNameVal/);
	assert.match(js, /安全防误触确认未通过/);

	// 交付展示
	assert.match(js, /res\.mode === 'uninstall'/);
	assert.match(js, /res\.mode === 'reset_admin'/);
	assert.match(js, /resUninstallSection\.classList\.remove\('hidden'\)/);

	// 凭证与报告导出
	assert.match(js, /Edgechat Cloudflare 资源清理与卸载报告/);
	assert.match(js, /Edgechat 管理员密码重置凭据备忘/);
	assert.match(js, /crypto\.getRandomValues/);
});
