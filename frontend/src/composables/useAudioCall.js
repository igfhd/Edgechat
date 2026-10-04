import { computed, onBeforeUnmount, ref } from 'vue';
import api from '../api.js';
import { CALL_VOICE_EFFECTS, RealtimeVoiceChanger } from '../audio/realtime-voice-changer.js';

// Sound synthesizer using Web Audio API for ringtones and call alerts
class CallSoundSynthesizer {
  constructor() {
    this.audioCtx = null;
    this.ringInterval = null;
  }

  ensureContext() {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  // Play outgoing ringtone (dialing tone: standard 440Hz + 480Hz dual-tone)
  startOutgoingRingtone() {
    this.stopRingtone();
    const ctx = this.ensureContext();
    if (!ctx) return;

    const playTone = () => {
      if (!this.audioCtx) return;
      try {
        const osc1 = this.audioCtx.createOscillator();
        const osc2 = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc1.frequency.value = 440;
        osc2.frequency.value = 480;

        gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 1.8);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc1.start();
        osc2.start();
        osc1.stop(this.audioCtx.currentTime + 1.8);
        osc2.stop(this.audioCtx.currentTime + 1.8);
      } catch {
        // ignore
      }
    };

    playTone();
    this.ringInterval = setInterval(playTone, 4000);
  }

  // Play incoming ringtone (pleasant chime melody)
  startIncomingRingtone() {
    this.stopRingtone();
    const ctx = this.ensureContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    const playChime = () => {
      if (!this.audioCtx) return;
      notes.forEach((freq, idx) => {
        try {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          const startTime = this.audioCtx.currentTime + idx * 0.15;

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, startTime);

          gain.gain.setValueAtTime(0.12, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.6);

          osc.connect(gain);
          gain.connect(this.audioCtx.destination);

          osc.start(startTime);
          osc.stop(startTime + 0.6);
        } catch {
          // ignore
        }
      });
    };

    playChime();
    this.ringInterval = setInterval(playChime, 2500);
  }

  // Play call connected beep
  playConnectedSound() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch {}
  }

  // Play call ended beep
  playEndedSound() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(330, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {}
  }

  stopRingtone() {
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
  }

  cleanup() {
    this.stopRingtone();
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }
}

export function useAudioCall(options = {}) {
  const soundSynth = new CallSoundSynthesizer();

  // Call status: 'idle' | 'calling' (outgoing) | 'ringing' (incoming) | 'connected' | 'ended'
  const callStatus = ref('idle');
  const callType = ref('dm'); // 'dm' | 'group'
  const currentRoom = ref(null);
  const targetUser = ref(null); // DM other party
  const isMuted = ref(false);
  const isMinimized = ref(false);
  const callDuration = ref(0);
  const errorMessage = ref('');

  // Speaking state (Voice Activity Detection - VAD)
  const isLocalSpeaking = ref(false);
  const isRemoteSpeaking = ref(false);

  // Stage moderation & Raise hand
  const isHandRaised = ref(false);

  // Real-time Voice Changer
  const currentVoiceEffect = ref('original');
  const availableVoiceEffects = CALL_VOICE_EFFECTS;
  let voiceChanger = null;

  // Group conference participants: Array of { userId, displayName, avatarUrl, isMuted, isSpeaking, isHandRaised, role, trackName }
  const groupParticipants = ref([]);

  let durationTimer = null;
  let dialingTimeout = null;
  let vadInterval = null;
  let localAudioSource = null;
  let localAudioAnalyser = null;
  let lastSpeakingBroadcast = 0;

  let localStream = null;
  let peerConnection = null;
  let callsAppId = '';
  let callsSessionId = '';
  let localTrackName = '';
  let remoteAudioStream = null;
  let remoteAudioElement = null;
  let lastGroupAudioRevision = 0;
  const pulledTracks = new Set();
  // Cloudflare Calls allows one SDP renegotiation at a time. Group state
  // broadcasts can contain several participants, so serialize remote pulls.
  let pullQueue = Promise.resolve();

  const isCallActive = computed(() => ['calling', 'ringing', 'connected'].includes(callStatus.value));
  const isConnected = computed(() => callStatus.value === 'connected');

  const formattedDuration = computed(() => {
    const totalSecs = callDuration.value;
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  });

  function startDurationTimer() {
    stopDurationTimer();
    callDuration.value = 0;
    durationTimer = setInterval(() => {
      callDuration.value += 1;
    }, 1000);
  }

  function stopDurationTimer() {
    if (durationTimer) {
      clearInterval(durationTimer);
      durationTimer = null;
    }
  }

  function startDialingTimeout() {
    clearDialingTimeout();
    dialingTimeout = setTimeout(() => {
      if (callStatus.value === 'calling') {
        endCall('对方未应答');
      }
    }, 45000);
  }

  function clearDialingTimeout() {
    if (dialingTimeout) {
      clearTimeout(dialingTimeout);
      dialingTimeout = null;
    }
  }

  function broadcastSpeakingState(speaking) {
    const now = Date.now();
    if (now - lastSpeakingBroadcast < 120) return;
    lastSpeakingBroadcast = now;
    options.sendSignal?.({
      action: 'speaking_state',
      callType: callType.value,
      isSpeaking: speaking
    });
  }

  function startVad() {
    stopVad();
    if (!localStream) return;
    const ctx = soundSynth.ensureContext();
    if (!ctx) return;

    try {
      localAudioSource = ctx.createMediaStreamSource(localStream);
      localAudioAnalyser = ctx.createAnalyser();
      localAudioAnalyser.fftSize = 256;
      localAudioAnalyser.smoothingTimeConstant = 0.3;
      localAudioSource.connect(localAudioAnalyser);

      const dataArray = new Uint8Array(localAudioAnalyser.frequencyBinCount);
      vadInterval = setInterval(() => {
        if (!localAudioAnalyser || isMuted.value || callStatus.value !== 'connected') {
          if (isLocalSpeaking.value) {
            isLocalSpeaking.value = false;
            broadcastSpeakingState(false);
          }
          return;
        }

        localAudioAnalyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        const speakingNow = average > 14;

        if (speakingNow !== isLocalSpeaking.value) {
          isLocalSpeaking.value = speakingNow;
          broadcastSpeakingState(speakingNow);
        }
      }, 120);
    } catch {
      // ignore
    }
  }

  function stopVad() {
    if (vadInterval) {
      clearInterval(vadInterval);
      vadInterval = null;
    }
    if (localAudioSource) {
      try { localAudioSource.disconnect(); } catch {}
      localAudioSource = null;
    }
    localAudioAnalyser = null;
    isLocalSpeaking.value = false;
  }

  // Request microphone and create WebRTC PeerConnection to Cloudflare Calls SFU
  async function initWebRtc() {
    errorMessage.value = '';

    // 1. Get microphone audio track with AEC/ANS/AGC
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
    } catch (err) {
      throw new Error(`无法访问麦克风：${err.message || '请允许浏览器麦克风权限'}`);
    }

    // 2. Request Calls Session from backend
    const sessionRes = await api.createCallsSession();
    callsAppId = sessionRes.appId;
    callsSessionId = sessionRes.sessionId;

    // 3. Create RTCPeerConnection
    peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }]
    });
    const connection = peerConnection;

    // Keep one persistent sink for all SFU tracks. Creating an Audio element
    // only after an async renegotiation can be rejected by autoplay policy.
    remoteAudioStream = new MediaStream();
    remoteAudioElement = new Audio();
    remoteAudioElement.autoplay = true;
    remoteAudioElement.playsInline = true;
    remoteAudioElement.muted = false;
    remoteAudioElement.srcObject = remoteAudioStream;
    const audioStream = remoteAudioStream;
    const audioElement = remoteAudioElement;

    // Handle remote tracks from SFU
    connection.ontrack = (event) => {
      if (remoteAudioStream !== audioStream) return;
      if (!audioStream.getTracks().some((track) => track.id === event.track.id)) {
        audioStream.addTrack(event.track);
      }
      audioElement.play().catch(() => {});
      event.track.addEventListener('unmute', () => {
        if (remoteAudioStream === audioStream) audioElement.play().catch(() => {});
      }, { once: true });
    };
    // Start playback without delaying WebRTC event wiring. Browsers may reject
    // this before a track exists; ontrack/unmute retries it above.
    audioElement.play().catch(() => {});

    // 4. Connect real-time voice changer pipeline
    const ctx = soundSynth.ensureContext();
    if (ctx) {
      try {
        voiceChanger = new RealtimeVoiceChanger(ctx, localStream);
        voiceChanger.setEffect(currentVoiceEffect.value);
      } catch (e) {
        console.warn('RealtimeVoiceChanger initialization fallback to raw mic:', e);
      }
    }

    // 5. Add local audio track as sendonly
    const audioTrack = voiceChanger?.processedTrack || localStream.getAudioTracks()[0];
    const transceiver = peerConnection.addTransceiver(audioTrack, { direction: 'sendonly' });
    localTrackName = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // 6. Create offer & push track to Cloudflare Calls SFU via backend proxy
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const pushData = await api.createCallsNewTracks(callsSessionId, {
      sessionDescription: {
        type: 'offer',
        sdp: peerConnection.localDescription.sdp
      },
      tracks: [
        {
          location: 'local',
          mid: transceiver.mid,
          trackName: localTrackName
        }
      ]
    });

    if (pushData.sessionDescription) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(pushData.sessionDescription));
    }

    return { appId: callsAppId, sessionId: callsSessionId, trackName: localTrackName };
  }

  // Pull a remote track from Cloudflare Calls SFU
  async function pullRemoteTrack(senderSessionId, senderTrackName) {
    const trackKey = `${senderSessionId}:${senderTrackName}`;
    if (!peerConnection || !callsSessionId || !senderSessionId || !senderTrackName || pulledTracks.has(trackKey)) return;
    pulledTracks.add(trackKey);
    const connection = peerConnection;
    const sessionId = callsSessionId;

    const pullOperation = async () => {
      try {
        if (peerConnection !== connection || callsSessionId !== sessionId) return;
        const pullData = await api.createCallsNewTracks(sessionId, {
          tracks: [
            {
              location: 'remote',
              sessionId: senderSessionId,
              trackName: senderTrackName
            }
          ]
        });

        if (pullData.sessionDescription && peerConnection === connection && callsSessionId === sessionId) {
          await connection.setRemoteDescription(new RTCSessionDescription(pullData.sessionDescription));
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);

          // Send renegotiation answer back to Calls API via backend proxy
          await api.renegotiateCallsSession(sessionId, {
            sessionDescription: {
              type: 'answer',
              sdp: connection.localDescription.sdp
            }
          });
        }
      } catch {
        pulledTracks.delete(trackKey);
        // ignore
      }
    };

    const queuedPull = pullQueue.then(pullOperation, pullOperation);
    pullQueue = queuedPull.catch(() => {});
    return queuedPull;
  }

  // Set real-time voice changer effect
  function setVoiceEffect(effectId) {
    currentVoiceEffect.value = effectId;
    if (voiceChanger) {
      voiceChanger.setEffect(effectId);
    }
  }

  // Toggle Mute / Unmute
  function toggleMute() {
    isMuted.value = !isMuted.value;
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => {
        t.enabled = !isMuted.value;
      });
    }
    if (voiceChanger?.outputStream) {
      voiceChanger.outputStream.getAudioTracks().forEach((t) => {
        t.enabled = !isMuted.value;
      });
    }
    if (isMuted.value) {
      isLocalSpeaking.value = false;
      broadcastSpeakingState(false);
    }
    // Broadcast mute state
    options.sendSignal?.({
      action: 'mute_state',
      isMuted: isMuted.value
    });
  }

  // Raise hand / Request to speak
  function raiseHand() {
    isHandRaised.value = true;
    options.sendSignal?.({
      action: 'raise_hand',
      callType: 'group',
      isHandRaised: true
    });
  }

  function lowerHand() {
    isHandRaised.value = false;
    options.sendSignal?.({
      action: 'lower_hand',
      callType: 'group',
      isHandRaised: false
    });
  }

  function toggleHand() {
    if (isHandRaised.value) {
      lowerHand();
    } else {
      raiseHand();
    }
  }

  // Moderator actions: Mute single participant
  function muteParticipant(targetUserId) {
    const p = groupParticipants.value.find((item) => item.userId === targetUserId);
    if (p) {
      p.isMuted = true;
      p.isSpeaking = false;
    }
    options.sendSignal?.({
      action: 'mute_member',
      callType: 'group',
      targetUserId,
      moderatorName: options.currentUserName?.() || '管理员'
    });
  }

  // Moderator actions: Mute all members
  function muteAll() {
    groupParticipants.value.forEach((p) => {
      p.isMuted = true;
      p.isSpeaking = false;
    });
    options.sendSignal?.({
      action: 'mute_all',
      callType: 'group',
      moderatorName: options.currentUserName?.() || '管理员'
    });
  }

  // Moderator actions: Kick participant from conference
  function kickParticipant(targetUserId) {
    groupParticipants.value = groupParticipants.value.filter((p) => p.userId !== targetUserId);
    options.sendSignal?.({
      action: 'kick_member',
      callType: 'group',
      targetUserId,
      moderatorName: options.currentUserName?.() || '管理员'
    });
  }

  // Moderator actions: Approve hand raise
  function approveHand(targetUserId) {
    const p = groupParticipants.value.find((item) => item.userId === targetUserId);
    if (p) {
      p.isHandRaised = false;
      p.isMuted = false;
    }
    options.sendSignal?.({
      action: 'approve_unmute',
      callType: 'group',
      targetUserId,
      moderatorName: options.currentUserName?.() || '管理员'
    });
  }

  // Moderator actions: Reject hand raise
  function rejectHand(targetUserId) {
    const p = groupParticipants.value.find((item) => item.userId === targetUserId);
    if (p) {
      p.isHandRaised = false;
    }
    options.sendSignal?.({
      action: 'reject_unmute',
      callType: 'group',
      targetUserId,
      moderatorName: options.currentUserName?.() || '管理员'
    });
  }

  // 1. Start Outgoing DM Call
  async function startDmCall(room, otherUser) {
    if (isCallActive.value) return;

    currentRoom.value = room;
    targetUser.value = otherUser;
    callType.value = 'dm';
    callStatus.value = 'calling';
    isMuted.value = false;
    isMinimized.value = false;
    isLocalSpeaking.value = false;
    isRemoteSpeaking.value = false;
    isHandRaised.value = false;
    soundSynth.startOutgoingRingtone();
    startDialingTimeout();

    try {
      const { sessionId, trackName } = await initWebRtc();
      // Send call invite signal to other user
      options.sendSignal?.({
        action: 'invite',
        callType: 'dm',
        sessionId,
        trackName,
        targetUserId: otherUser.id
      });
    } catch (err) {
      const msg = err.message || '呼叫失败';
      options.onError?.(msg);
      endCall(msg);
    }
  }

  // 2. Accept Incoming Call
  async function acceptCall() {
    if (callStatus.value !== 'ringing') return;
    soundSynth.stopRingtone();
    soundSynth.playConnectedSound();
    callStatus.value = 'connected';
    startDurationTimer();

    try {
      const { sessionId, trackName } = await initWebRtc();
      startVad();
      // Send accept signal
      options.sendSignal?.({
        action: 'accept',
        callType: callType.value,
        sessionId,
        trackName,
        targetUserId: targetUser.value?.id
      });

      // If we already have the caller's track info, pull it
      if (targetUser.value?.sessionId && targetUser.value?.trackName) {
        await pullRemoteTrack(targetUser.value.sessionId, targetUser.value.trackName);
      }
    } catch (err) {
      const msg = err.message || '接听失败';
      options.onError?.(msg);
      endCall(msg);
    }
  }

  // 3. Reject Incoming Call
  function rejectCall() {
    soundSynth.stopRingtone();
    clearDialingTimeout();
    options.sendSignal?.({
      action: 'reject',
      callType: callType.value,
      targetUserId: targetUser.value?.id
    });
    resetCallState();
  }

  // 4. Hang up / End Call
  function endCall(errorMsg = '') {
    soundSynth.playEndedSound();
    clearDialingTimeout();
    options.sendSignal?.({
      action: callType.value === 'group' ? 'leave' : 'hangup',
      callType: callType.value,
      roomId: currentRoom.value?.id
    });
    if (errorMsg) {
      errorMessage.value = errorMsg;
    }
    resetCallState();
  }

  // 5. Join Group Voice Conference
  async function joinGroupMeeting(room) {
    if (isCallActive.value && currentRoom.value?.id === room?.id && callType.value === 'group') {
      isMinimized.value = false;
      return;
    }

    currentRoom.value = room;
    callType.value = 'group';
    callStatus.value = 'connected';
    isMuted.value = false;
    isMinimized.value = false;
    isLocalSpeaking.value = false;
    isHandRaised.value = false;
    startDurationTimer();

    try {
      const { sessionId, trackName } = await initWebRtc();
      startVad();
      options.sendSignal?.({
        action: 'join',
        callType: 'group',
        roomId: room?.id,
        sessionId,
        trackName,
        isHandRaised: isHandRaised.value,
        role: options.currentUserRole?.() || 'member'
      });
    } catch (err) {
      const msg = err.message || '加入会议失败';
      options.onError?.(msg);
      endCall(msg);
    }
  }

  // 6. Leave Group Voice Conference
  function leaveGroupMeeting() {
    options.sendSignal?.({
      action: 'leave',
      callType: 'group',
      roomId: currentRoom.value?.id
    });
    resetCallState();
  }

  // Reset internal state & close connections
  function resetCallState() {
    soundSynth.stopRingtone();
    stopDurationTimer();
    clearDialingTimeout();
    stopVad();

    if (voiceChanger) {
      voiceChanger.destroy();
      voiceChanger = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((t) => { t.stop(); });
      localStream = null;
    }
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    if (remoteAudioElement) {
      remoteAudioElement.pause();
      remoteAudioElement.srcObject = null;
      remoteAudioElement = null;
    }
    remoteAudioStream?.getTracks().forEach((track) => {
      track.stop();
    });
    remoteAudioStream = null;
    pulledTracks.clear();
    pullQueue = Promise.resolve();
    lastGroupAudioRevision = 0;

    callStatus.value = 'idle';
    targetUser.value = null;
    groupParticipants.value = [];
    callsSessionId = '';
    localTrackName = '';
    isLocalSpeaking.value = false;
    isRemoteSpeaking.value = false;
    isHandRaised.value = false;
  }

  // Handle incoming call signal from WebSocket
  async function handleIncomingSignal(packet) {
    if (!packet || packet.type !== 'call_signal') return;

    const { action, senderId, displayName, avatarUrl, sessionId, trackName, isMuted: remoteMuted, isSpeaking: remoteSpeaking } = packet;
    const packetRevision = packet.roomAudioRevision == null ? null : Number(packet.roomAudioRevision);
    if (packetRevision !== null && Number.isFinite(packetRevision)) {
      if (packetRevision < lastGroupAudioRevision) return;
      lastGroupAudioRevision = Math.max(lastGroupAudioRevision, packetRevision);
    }

    // A. Incoming DM call invite
    if (action === 'invite') {
      // DM invites may arrive through both the room socket and UserInbox.
      // Ignore the duplicate instead of treating it as a second caller.
      const isDuplicateInvite = callStatus.value === 'ringing' &&
        Number(targetUser.value?.id) === Number(senderId) &&
        targetUser.value?.sessionId === sessionId &&
        targetUser.value?.trackName === trackName;
      if (isDuplicateInvite) return;
      if (isCallActive.value) {
        // Line busy
        options.sendSignal?.({
          action: 'busy',
          callType: packet.callType
        });
        return;
      }
      callType.value = packet.callType || 'dm';
      callStatus.value = 'ringing';
      targetUser.value = {
        id: senderId,
        displayName: displayName || '成员',
        avatarUrl,
        sessionId,
        trackName
      };
      soundSynth.startIncomingRingtone();
      return;
    }

    // B. Call accepted by other party
    if (action === 'accept') {
      if (callStatus.value === 'calling') {
        clearDialingTimeout();
        soundSynth.stopRingtone();
        soundSynth.playConnectedSound();
        callStatus.value = 'connected';
        startDurationTimer();
        startVad();

        if (sessionId && trackName) {
          await pullRemoteTrack(sessionId, trackName);
        }
      }
      return;
    }

    // C. Call rejected or line busy
    if (action === 'reject' || action === 'busy') {
      if (callStatus.value === 'calling') {
        clearDialingTimeout();
        endCall(action === 'busy' ? '对方正在通话中' : '对方已拒绝通话');
      }
      return;
    }

    // D. Call hangup
    if (action === 'hangup') {
      if (isCallActive.value) {
        clearDialingTimeout();
        endCall('通话已结束');
      }
      return;
    }

    // D2. Group meeting state broadcast from server
    if (action === 'room_audio_state') {
      const remoteList = Array.isArray(packet.participants) ? packet.participants : [];
      const myId = options.currentUserId?.();
      const otherParticipants = remoteList.filter((p) => Number(p.userId) !== Number(myId));

      // Apply authoritative state even while the local session is finishing
      // its initial WebRTC negotiation; otherwise the meeting host can miss
      // the first participant snapshot and remain stuck showing only "我".
      if (callType.value === 'group' && Number(currentRoom.value?.id) === Number(packet.roomId)) {
        groupParticipants.value = [...otherParticipants];
        for (const p of otherParticipants) {
          if (p.sessionId && p.trackName) {
            void pullRemoteTrack(p.sessionId, p.trackName);
          }
        }
      }
      return;
    }

    // E. Group meeting: participant joined or published track
    if (action === 'join' || action === 'track_published') {
      const myId = options.currentUserId?.();
      if (myId && Number(senderId) === Number(myId)) return;

      if (callType.value === 'group' && (!packet.roomId || Number(currentRoom.value?.id) === Number(packet.roomId))) {
        // Add to participants list
        const exists = groupParticipants.value.find((p) => Number(p.userId) === Number(senderId));
        if (!exists) {
          groupParticipants.value.push({
            userId: senderId,
            displayName: displayName || '成员',
            avatarUrl,
            sessionId,
            trackName,
            isMuted: Boolean(remoteMuted),
            isSpeaking: Boolean(remoteSpeaking),
            isHandRaised: Boolean(packet.isHandRaised),
            role: packet.role || 'member'
          });
          groupParticipants.value = [...groupParticipants.value];
        } else {
          exists.displayName = displayName || exists.displayName;
          exists.avatarUrl = avatarUrl || exists.avatarUrl;
          exists.sessionId = sessionId || exists.sessionId;
          exists.trackName = trackName || exists.trackName;
          exists.isMuted = Boolean(remoteMuted);
          exists.isSpeaking = Boolean(remoteSpeaking);
          if (packet.isHandRaised !== undefined) exists.isHandRaised = Boolean(packet.isHandRaised);
          if (packet.role) exists.role = packet.role;
          groupParticipants.value = [...groupParticipants.value];
        }
        if (sessionId && trackName) {
          await pullRemoteTrack(sessionId, trackName);
        }

        // If someone just joined and we are in the meeting with active track, respond with our track
        if (action === 'join' && callsSessionId && localTrackName) {
          options.sendSignal?.({
            action: 'track_published',
            callType: 'group',
            roomId: currentRoom.value?.id,
            sessionId: callsSessionId,
            trackName: localTrackName,
            isMuted: isMuted.value,
            isSpeaking: isLocalSpeaking.value,
            isHandRaised: isHandRaised.value,
            role: options.currentUserRole?.() || 'member'
          });
        }
      }
      return;
    }

    // F. Group meeting: participant left
    if (action === 'leave') {
      if (callType.value === 'group') {
        groupParticipants.value = groupParticipants.value.filter((p) => Number(p.userId) !== Number(senderId));
      }
      return;
    }

    // G. Remote participant mute state changed
    if (action === 'mute_state') {
      const p = groupParticipants.value.find((item) => item.userId === senderId);
      if (p) {
        p.isMuted = Boolean(remoteMuted);
      }
      if (targetUser.value && targetUser.value.id === senderId) {
        targetUser.value.isMuted = Boolean(remoteMuted);
      }
      return;
    }

    // H. Remote participant speaking state changed
    if (action === 'speaking_state') {
      const isSpk = Boolean(packet.isSpeaking);
      if (callType.value === 'dm' && targetUser.value && targetUser.value.id === senderId) {
        isRemoteSpeaking.value = isSpk;
      } else if (callType.value === 'group') {
        const p = groupParticipants.value.find((item) => item.userId === senderId);
        if (p) {
          p.isSpeaking = isSpk;
        }
      }
      return;
    }

    // I. Stage moderation: Raise / lower hand
    if (action === 'raise_hand') {
      const p = groupParticipants.value.find((item) => item.userId === senderId);
      if (p) {
        p.isHandRaised = true;
      }
      options.onNotice?.(`「${displayName || '成员'}」申请发言`);
      return;
    }

    if (action === 'lower_hand') {
      const p = groupParticipants.value.find((item) => item.userId === senderId);
      if (p) {
        p.isHandRaised = false;
      }
      return;
    }

    // J. Stage moderation: Mute all members
    if (action === 'mute_all') {
      const myId = options.currentUserId?.();
      if (senderId !== myId) {
        if (!isMuted.value) {
          isMuted.value = true;
          if (localStream) {
            localStream.getAudioTracks().forEach((t) => { t.enabled = false; });
          }
          if (voiceChanger?.outputStream) {
            voiceChanger.outputStream.getAudioTracks().forEach((t) => { t.enabled = false; });
          }
          isLocalSpeaking.value = false;
          broadcastSpeakingState(false);
          options.sendSignal?.({
            action: 'mute_state',
            isMuted: true
          });
        }
        options.onNotice?.(`管理员「${packet.moderatorName || displayName || '主持人'}」已开启全员静音`);
      }
      return;
    }

    // K. Stage moderation: Mute single member
    if (action === 'mute_member') {
      const myId = options.currentUserId?.();
      if (packet.targetUserId === myId) {
        if (!isMuted.value) {
          isMuted.value = true;
          if (localStream) {
            localStream.getAudioTracks().forEach((t) => { t.enabled = false; });
          }
          if (voiceChanger?.outputStream) {
            voiceChanger.outputStream.getAudioTracks().forEach((t) => { t.enabled = false; });
          }
          isLocalSpeaking.value = false;
          broadcastSpeakingState(false);
          options.sendSignal?.({
            action: 'mute_state',
            isMuted: true
          });
        }
        options.onNotice?.(`您已被管理员「${packet.moderatorName || displayName || '主持人'}」静音`);
      } else {
        const p = groupParticipants.value.find((item) => item.userId === packet.targetUserId);
        if (p) {
          p.isMuted = true;
          p.isSpeaking = false;
        }
      }
      return;
    }

    // L. Stage moderation: Kick member from conference
    if (action === 'kick_member') {
      const myId = options.currentUserId?.();
      if (packet.targetUserId === myId) {
        leaveGroupMeeting();
        options.onNotice?.(`您已被管理员「${packet.moderatorName || displayName || '主持人'}」移出语音会议`);
      } else {
        groupParticipants.value = groupParticipants.value.filter((p) => p.userId !== packet.targetUserId);
      }
      return;
    }

    // M. Stage moderation: Approve unmute
    if (action === 'approve_unmute') {
      const myId = options.currentUserId?.();
      if (packet.targetUserId === myId) {
        isHandRaised.value = false;
        if (isMuted.value) {
          isMuted.value = false;
          if (localStream) {
            localStream.getAudioTracks().forEach((t) => { t.enabled = true; });
          }
          if (voiceChanger?.outputStream) {
            voiceChanger.outputStream.getAudioTracks().forEach((t) => { t.enabled = true; });
          }
          options.sendSignal?.({
            action: 'mute_state',
            isMuted: false
          });
        }
        options.onNotice?.('管理员已同意您的发言申请，麦克风已开启');
      } else {
        const p = groupParticipants.value.find((item) => item.userId === packet.targetUserId);
        if (p) {
          p.isHandRaised = false;
          p.isMuted = false;
        }
      }
      return;
    }

    // N. Stage moderation: Reject unmute
    if (action === 'reject_unmute') {
      const myId = options.currentUserId?.();
      if (packet.targetUserId === myId) {
        isHandRaised.value = false;
        options.onNotice?.('管理员暂未同意您的发言申请');
      } else {
        const p = groupParticipants.value.find((item) => item.userId === packet.targetUserId);
        if (p) {
          p.isHandRaised = false;
        }
      }
      return;
    }
  }

  onBeforeUnmount(() => {
    resetCallState();
    soundSynth.cleanup();
  });

  return {
    callStatus,
    callType,
    currentRoom,
    targetUser,
    isMuted,
    isMinimized,
    isLocalSpeaking,
    isRemoteSpeaking,
    isHandRaised,
    currentVoiceEffect,
    availableVoiceEffects,
    callDuration,
    formattedDuration,
    errorMessage,
    groupParticipants,
    isCallActive,
    isConnected,
    startDmCall,
    acceptCall,
    rejectCall,
    endCall,
    joinGroupMeeting,
    leaveGroupMeeting,
    toggleMute,
    setVoiceEffect,
    raiseHand,
    lowerHand,
    toggleHand,
    muteParticipant,
    muteAll,
    kickParticipant,
    approveHand,
    rejectHand,
    handleIncomingSignal
  };
}
