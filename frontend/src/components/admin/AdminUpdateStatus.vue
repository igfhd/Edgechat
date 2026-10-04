<script setup>
import { computed, onMounted, ref } from "vue";
import { checkForUpdates, getBuildInfo } from "../../update-check.js";
import { parseUtcDate } from "../../date.js";
import UiButton from "../ui/Button.vue";
import UiSurface from "../ui/Surface.vue";

const build = getBuildInfo();
const checking = ref(false);
const result = ref(null);
const error = ref("");

const shortCommit = computed(() => build.commit.slice(0, 7) || "未知");
const statusTone = computed(() => {
	if (error.value) {
		return "error";
	}
	if (checking.value || !result.value) {
		return "neutral";
	}
	return result.value.updateAvailable ? "warning" : "success";
});
const statusTitle = computed(() => {
	if (checking.value) {
		return "正在检查更新";
	}
	if (error.value) {
		return "暂时无法检查";
	}
	if (!result.value) {
		return "等待检查";
	}
	if (result.value.state === "local-ahead") {
		return "当前部署领先于远端";
	}
	return result.value.updateAvailable ? "发现可用更新" : "已是最新版本";
});
const statusDetail = computed(() => {
	if (checking.value) {
		return `正在比对 ${build.repository || "代码仓库"} 的 ${build.branch || "当前"} 分支。`;
	}
	if (error.value) {
		return error.value;
	}
	if (!result.value) {
		return "";
	}
	if (result.value.state === "local-ahead") {
		return `当前部署领先 ${result.value.localCommitCount} 个提交。`;
	}
	if (result.value.state === "diverged") {
		return `远端有 ${result.value.remoteCommitCount} 个新提交，且双方分支已经产生差异。`;
	}
	if (result.value.updateAvailable) {
		return `远端有 ${result.value.remoteCommitCount} 个新提交。`;
	}
	return `当前部署与远端 ${build.branch} 分支一致。`;
});

function formatDate(value) {
	const date = parseUtcDate(value);
	return !date
		? ""
		: date.toLocaleString("zh-CN", { hour12: false });
}

async function checkUpdates() {
	checking.value = true;
	error.value = "";
	try {
		result.value = await checkForUpdates({ build });
	} catch (currentError) {
		result.value = null;
		error.value = currentError instanceof Error ? currentError.message : "版本检查失败";
	} finally {
		checking.value = false;
	}
}

onMounted(checkUpdates);
</script>

<template>
	<UiSurface class="panel admin-update-panel">
		<div class="admin-update-panel__header">
			<div>
				<h3 class="panel-title">版本更新</h3>
				<p class="admin-update-panel__repository">
					<a
						v-if="build.repository"
						:href="`https://github.com/${build.repository}`"
						target="_blank"
						rel="noreferrer"
					>
						{{ build.repository }}
					</a>
					<span v-else>未识别代码仓库</span>
				</p>
			</div>
			<UiButton variant="secondary" size="sm" :disabled="checking" @click="checkUpdates">
				{{ checking ? "检查中..." : "检查更新" }}
			</UiButton>
		</div>

		<div
			class="admin-update-panel__status"
			:class="`admin-update-panel__status--${statusTone}`"
			role="status"
			aria-live="polite"
		>
			<span class="admin-update-panel__indicator" aria-hidden="true"></span>
			<div>
				<strong>{{ statusTitle }}</strong>
				<span>{{ statusDetail }}</span>
			</div>
		</div>

		<div class="admin-update-panel__meta">
			<div>
				<span>当前版本</span>
				<strong>{{ build.version || "未设置" }}</strong>
			</div>
			<div>
				<span>当前提交</span>
				<code>{{ shortCommit }}</code>
			</div>
			<div>
				<span>跟踪分支</span>
				<strong>{{ build.branch || "未知" }}</strong>
			</div>
		</div>

		<div v-if="result?.latestCommit" class="admin-update-panel__latest">
			<div>
				<span>最新提交</span>
				<strong>{{ result.latestCommit.message || result.latestCommit.sha.slice(0, 7) }}</strong>
				<small v-if="result.latestCommit.committedAt">
					{{ formatDate(result.latestCommit.committedAt) }}
				</small>
			</div>
			<a :href="result.compareUrl" target="_blank" rel="noreferrer">查看更新内容</a>
		</div>
	</UiSurface>
</template>

<style scoped src="../../styles/admin/update-status.css"></style>
