import { getRuntimeUpdateResult, isDemoMode } from './runtime.js';

const GITHUB_API_BASE = "https://api.github.com";

function normalizeBuildInfo(build) {
	return {
		version: String(build?.version || "").trim(),
		repository: String(build?.repository || "").trim(),
		commit: String(build?.commit || "").trim().toLowerCase(),
		branch: String(build?.branch || "").trim(),
		dirty: Boolean(build?.dirty),
	};
}

function requireComparableBuild(build) {
	if (build.dirty) {
		throw new Error("当前部署包含未提交改动，无法准确比对远端版本");
	}
	if (!/^[\w.-]+\/[\w.-]+$/.test(build.repository)) {
		throw new Error("当前构建缺少有效的 GitHub 仓库信息");
	}
	if (!/^[0-9a-f]{7,40}$/.test(build.commit)) {
		throw new Error("当前构建缺少有效的 Git 提交信息");
	}
	if (!build.branch) {
		throw new Error("当前构建缺少 Git 分支信息");
	}
}

function githubError(response) {
	if (response.status === 404) {
		return new Error("当前部署提交尚未同步到代码仓库，暂时无法准确比对");
	}
	if (response.status === 403) {
		return new Error("GitHub 检查次数暂时受限，请稍后再试");
	}
	return new Error("代码仓库暂时无法访问，请稍后再试");
}

export function getBuildInfo() {
	const info = normalizeBuildInfo(globalThis.__EDGECHAT_BUILD__);
	return info;
}

export async function checkForUpdates({ build = getBuildInfo(), fetchImpl = globalThis.fetch } = {}) {
	if (isDemoMode) {
		return getRuntimeUpdateResult();
	}
	const current = normalizeBuildInfo(build);
	requireComparableBuild(current);
	if (typeof fetchImpl !== "function") {
		throw new Error("当前环境无法发起版本检查");
	}

	const [owner, repositoryName] = current.repository.split("/");
	const compareRef = `${encodeURIComponent(current.commit)}...${encodeURIComponent(current.branch)}`;
	const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repositoryName)}/compare/${compareRef}`;
	let response;
	try {
		response = await fetchImpl(url, {
			cache: "no-store",
			headers: {
				Accept: "application/vnd.github+json",
			},
		});
	} catch {
		throw new Error("网络连接失败，无法访问代码仓库");
	}

	if (!response.ok) {
		throw githubError(response);
	}

	const payload = await response.json();
	if (
		!payload ||
		typeof payload.status !== "string" ||
		!Number.isFinite(Number(payload.ahead_by)) ||
		!Number.isFinite(Number(payload.behind_by))
	) {
		throw new Error("代码仓库返回了无法识别的版本信息");
	}
	const remoteCommitCount = Number(payload?.ahead_by || 0);
	const localCommitCount = Number(payload?.behind_by || 0);
	const commits = Array.isArray(payload?.commits) ? payload.commits : [];
	const latestCommit = commits[commits.length - 1];
	const updateAvailable = remoteCommitCount > 0;
	let state = "current";
	if (updateAvailable) {
		state = payload?.status === "diverged" ? "diverged" : "update-available";
	} else if (localCommitCount > 0) {
		state = "local-ahead";
	}

	return {
		state,
		updateAvailable,
		remoteCommitCount,
		localCommitCount,
		compareUrl:
			String(payload?.html_url || "").trim() ||
			`https://github.com/${current.repository}/compare/${compareRef}`,
		latestCommit: latestCommit
			? {
					sha: String(latestCommit.sha || ""),
					message: String(latestCommit.commit?.message || "").split("\n", 1)[0],
					committedAt: String(latestCommit.commit?.committer?.date || ""),
					url: String(latestCommit.html_url || ""),
				}
			: null,
	};
}
