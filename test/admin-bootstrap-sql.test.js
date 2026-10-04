import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const scriptPath = resolve(process.cwd(), ".github/scripts/generate-admin-bootstrap-sql.mjs");
const outputPath = resolve(process.cwd(), ".tmp/edgechat-admin-upsert.sql");

test("generate-admin-bootstrap-sql: 默认不覆盖已有用户的密码（CI/CD 或常规部署安全保护）", () => {
	try {
		unlinkSync(outputPath);
	} catch {}

	execFileSync("node", [scriptPath], {
		env: {
			...process.env,
			EDGECHAT_ADMIN_USERNAME: "admin_test",
			EDGECHAT_ADMIN_PASSWORD: "InitialPassword123!",
			EDGECHAT_ADMIN_RESET_PASSWORD: "0",
		},
	});

	const sql = readFileSync(outputPath, "utf8");
	assert.match(sql, /INSERT INTO users/);
	assert.match(sql, /WHERE NOT EXISTS/);
	assert.match(sql, /UPDATE users/);
	// In UPDATE statement, password_hash should NOT be updated
	const updatePart = sql.slice(sql.indexOf("UPDATE users"));
	assert.doesNotMatch(updatePart, /password_hash\s*=/);
	assert.doesNotMatch(updatePart, /password_salt\s*=/);
});

test("generate-admin-bootstrap-sql: 当启用 EDGECHAT_ADMIN_RESET_PASSWORD 时更新已有用户密码与 session_version", () => {
	try {
		unlinkSync(outputPath);
	} catch {}

	execFileSync("node", [scriptPath], {
		env: {
			...process.env,
			EDGECHAT_ADMIN_USERNAME: "admin_test",
			EDGECHAT_ADMIN_PASSWORD: "NewResetPassword456!",
			EDGECHAT_ADMIN_RESET_PASSWORD: "1",
		},
	});

	const sql = readFileSync(outputPath, "utf8");
	assert.match(sql, /INSERT INTO users/);
	const updatePart = sql.slice(sql.indexOf("UPDATE users"));
	assert.match(updatePart, /password_hash\s*=/);
	assert.match(updatePart, /password_salt\s*=/);
	assert.match(updatePart, /session_version\s*=/);
	assert.match(updatePart, /is_admin\s*=\s*1/);
	assert.match(updatePart, /is_disabled\s*=\s*0/);
});

test("deploy_edgechat_Linux.sh: 包含重置密码提示并支持使用原密码", () => {
	const deployScript = readFileSync(resolve(process.cwd(), "deploy_edgechat_Linux.sh"), "utf8");
	assert.match(deployScript, /检测到已存在管理员密码，请输入新密码/);
	assert.match(deployScript, /直接回车使用原密码/);
	assert.match(deployScript, /EDGECHAT_ADMIN_RESET_PASSWORD="1"/);
});
