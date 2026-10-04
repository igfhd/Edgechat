import { requestDemo } from './api.js';
import { connectDemoInboxSocket, connectDemoRoomSocket } from './realtime.js';
import { getDemoFileUrl, resetDemoState } from './state.js';

export const isDemoMode = true;
export const runtimeSessionToken = 'edgechat-demo-session';
export const requestRuntime = requestDemo;
export const getRuntimeFileUrl = getDemoFileUrl;
export const connectRuntimeRoomSocket = connectDemoRoomSocket;
export const connectRuntimeInboxSocket = connectDemoInboxSocket;

export function resetRuntime() {
  resetDemoState();
}

export function getRuntimeUpdateResult() {
  return {
    state: 'current',
    updateAvailable: false,
    remoteCommitCount: 0,
    localCommitCount: 0,
    compareUrl: '',
    latestCommit: {
      sha: 'demo',
      message: '纯前端演示构建',
      committedAt: '2026-08-14T10:00:00.000Z',
      url: ''
    }
  };
}
