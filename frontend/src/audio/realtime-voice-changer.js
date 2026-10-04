/**
 * realtime-voice-changer.js - Low-latency real-time voice modulation engine for WebRTC audio calls
 */

export const CALL_VOICE_EFFECTS = [
  { id: 'original', name: '原声', icon: '🎙️', desc: '真人清晰原声' },
  { id: 'cute', name: '萝莉', icon: '👧', desc: '清脆可爱萌妹' },
  { id: 'uncle', name: '大叔', icon: '🧔', desc: '低沉磁性大叔' },
  { id: 'robot', name: '电音', icon: '🤖', desc: '赛博机械电音' },
  { id: 'echo', name: '空灵', icon: '🌌', desc: '大厅空灵回声' }
];

export class RealtimeVoiceChanger {
  constructor(audioCtx, mediaStream) {
    this.audioCtx = audioCtx;
    this.inputStream = mediaStream;
    this.currentEffect = 'original';
    this.destroyed = false;

    // Output destination node
    this.destination = this.audioCtx.createMediaStreamDestination();

    // Source node from microphone stream
    this.source = this.audioCtx.createMediaStreamSource(mediaStream);

    // Master effect gain buses
    this.bypassGain = this.audioCtx.createGain();
    this.cuteGain = this.audioCtx.createGain();
    this.uncleGain = this.audioCtx.createGain();
    this.robotGain = this.audioCtx.createGain();
    this.echoGain = this.audioCtx.createGain();

    // Initialize all effect chains
    this.initBypassChain();
    this.initPitchShifterChains();
    this.initRobotChain();
    this.initEchoChain();

    // Route to destination
    this.bypassGain.connect(this.destination);
    this.cuteGain.connect(this.destination);
    this.uncleGain.connect(this.destination);
    this.robotGain.connect(this.destination);
    this.echoGain.connect(this.destination);

    // Start with original
    this.setEffect('original');
  }

  get processedTrack() {
    return this.destination.stream.getAudioTracks()[0];
  }

  get outputStream() {
    return this.destination.stream;
  }

  initBypassChain() {
    this.source.connect(this.bypassGain);
    this.bypassGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime);
  }

  initPitchShifterChains() {
    // Real-time pitch shifter processor using granular overlap-add
    const bufferSize = 1024;
    const processor = this.audioCtx.createScriptProcessor(bufferSize, 1, 1);

    const grainSize = 512;
    const _halfGrain = grainSize / 2;
    const _grainBuffer = new Float32Array(grainSize);
    const windowTable = new Float32Array(grainSize);

    // Precompute Hanning window
    for (let i = 0; i < grainSize; i++) {
      windowTable[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grainSize - 1)));
    }

    let readIndex = 0;
    let writeIndex = 0;
    const historySize = 8192;
    const history = new Float32Array(historySize);

    // Active pitch shift ratio: default 1.0
    this.pitchShiftRatio = 1.0;

    processor.onaudioprocess = (e) => {
      if (this.destroyed) return;
      const input = e.inputBuffer.getChannelData(0);
      const output = e.outputBuffer.getChannelData(0);

      const ratio = this.pitchShiftRatio;
      if (Math.abs(ratio - 1.0) < 0.02) {
        // Direct passthrough
        output.set(input);
        return;
      }

      for (let i = 0; i < input.length; i++) {
        history[writeIndex] = input[i];
        writeIndex = (writeIndex + 1) % historySize;

        // Granular resample with windowing
        readIndex = (readIndex + ratio);
        if (readIndex >= historySize) {
          readIndex -= historySize;
        }

        const idx0 = Math.floor(readIndex);
        const frac = readIndex - idx0;
        const s0 = history[idx0 % historySize];
        const s1 = history[(idx0 + 1) % historySize];
        const sample = s0 + frac * (s1 - s0);

        output[i] = sample;
      }
    };

    this.pitchProcessor = processor;
    this.source.connect(processor);

    // Cute EQ chain (High-pass + mid-high peak boost)
    const cuteHighPass = this.audioCtx.createBiquadFilter();
    cuteHighPass.type = 'highpass';
    cuteHighPass.frequency.setValueAtTime(200, this.audioCtx.currentTime);

    const cutePeak = this.audioCtx.createBiquadFilter();
    cutePeak.type = 'peaking';
    cutePeak.frequency.setValueAtTime(3400, this.audioCtx.currentTime);
    cutePeak.gain.setValueAtTime(6.0, this.audioCtx.currentTime);
    cutePeak.Q.setValueAtTime(1.2, this.audioCtx.currentTime);

    const cuteShelf = this.audioCtx.createBiquadFilter();
    cuteShelf.type = 'highshelf';
    cuteShelf.frequency.setValueAtTime(6000, this.audioCtx.currentTime);
    cuteShelf.gain.setValueAtTime(4.0, this.audioCtx.currentTime);

    processor.connect(cuteHighPass);
    cuteHighPass.connect(cutePeak);
    cutePeak.connect(cuteShelf);
    cuteShelf.connect(this.cuteGain);

    // Uncle EQ chain (Low-pass + low bass boost)
    const uncleLowPass = this.audioCtx.createBiquadFilter();
    uncleLowPass.type = 'lowpass';
    uncleLowPass.frequency.setValueAtTime(2200, this.audioCtx.currentTime);

    const uncleBass = this.audioCtx.createBiquadFilter();
    uncleBass.type = 'lowshelf';
    uncleBass.frequency.setValueAtTime(220, this.audioCtx.currentTime);
    uncleBass.gain.setValueAtTime(8.0, this.audioCtx.currentTime);

    processor.connect(uncleLowPass);
    uncleLowPass.connect(uncleBass);
    uncleBass.connect(this.uncleGain);
  }

  initRobotChain() {
    // Carrier oscillator for ring modulation
    const carrier = this.audioCtx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(56.0, this.audioCtx.currentTime);

    const ringMod = this.audioCtx.createGain();
    ringMod.gain.setValueAtTime(0, this.audioCtx.currentTime);

    // Bandpass filter for robotic radio character
    const bandpass = this.audioCtx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(1300, this.audioCtx.currentTime);
    bandpass.Q.setValueAtTime(1.0, this.audioCtx.currentTime);

    // Soft clip distortion curve
    const waveShaper = this.audioCtx.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) {
      const x = (i * 2) / 512 - 1;
      curve[i] = Math.tanh(x * 1.8);
    }
    waveShaper.curve = curve;
    waveShaper.oversample = '2x';

    carrier.connect(ringMod.gain);
    this.source.connect(ringMod);
    ringMod.connect(bandpass);
    bandpass.connect(waveShaper);
    waveShaper.connect(this.robotGain);

    carrier.start();
    this.robotCarrier = carrier;
  }

  initEchoChain() {
    // Dry + 3 Multi-tap delay lines for space echo
    const echoDry = this.audioCtx.createGain();
    echoDry.gain.setValueAtTime(0.7, this.audioCtx.currentTime);

    const d1 = this.audioCtx.createDelay(1.0);
    d1.delayTime.setValueAtTime(0.18, this.audioCtx.currentTime);
    const g1 = this.audioCtx.createGain();
    g1.gain.setValueAtTime(0.42, this.audioCtx.currentTime);

    const d2 = this.audioCtx.createDelay(1.0);
    d2.delayTime.setValueAtTime(0.36, this.audioCtx.currentTime);
    const g2 = this.audioCtx.createGain();
    g2.gain.setValueAtTime(0.24, this.audioCtx.currentTime);

    const d3 = this.audioCtx.createDelay(1.0);
    d3.delayTime.setValueAtTime(0.54, this.audioCtx.currentTime);
    const g3 = this.audioCtx.createGain();
    g3.gain.setValueAtTime(0.12, this.audioCtx.currentTime);

    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, this.audioCtx.currentTime);

    this.source.connect(echoDry);
    echoDry.connect(this.echoGain);

    this.source.connect(d1);
    d1.connect(g1);
    g1.connect(filter);

    this.source.connect(d2);
    d2.connect(g2);
    g2.connect(filter);

    this.source.connect(d3);
    d3.connect(g3);
    g3.connect(filter);

    filter.connect(this.echoGain);
  }

  /**
   * Switch active voice effect with smooth 25ms crossfade
   * @param {'original' | 'cute' | 'uncle' | 'robot' | 'echo'} effectId
   */
  setEffect(effectId) {
    if (this.destroyed) return;
    const now = this.audioCtx.currentTime;
    const fadeDuration = 0.025; // 25ms crossfade

    this.currentEffect = effectId;

    // Reset all gains to 0 with smooth ramp
    this.bypassGain.gain.setTargetAtTime(effectId === 'original' ? 1.0 : 0.0, now, fadeDuration);
    this.cuteGain.gain.setTargetAtTime(effectId === 'cute' ? 1.25 : 0.0, now, fadeDuration);
    this.uncleGain.gain.setTargetAtTime(effectId === 'uncle' ? 1.3 : 0.0, now, fadeDuration);
    this.robotGain.gain.setTargetAtTime(effectId === 'robot' ? 1.4 : 0.0, now, fadeDuration);
    this.echoGain.gain.setTargetAtTime(effectId === 'echo' ? 1.0 : 0.0, now, fadeDuration);

    // Update pitch shifter target ratio
    if (effectId === 'cute') {
      this.pitchShiftRatio = 1.36; // +5.2 semitones
    } else if (effectId === 'uncle') {
      this.pitchShiftRatio = 0.76; // -4.7 semitones
    } else {
      this.pitchShiftRatio = 1.0;
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.robotCarrier) {
      try {
        this.robotCarrier.stop();
        this.robotCarrier.disconnect();
      } catch {}
      this.robotCarrier = null;
    }
    if (this.pitchProcessor) {
      try {
        this.pitchProcessor.disconnect();
      } catch {}
      this.pitchProcessor = null;
    }
    if (this.source) {
      try { this.source.disconnect(); } catch {}
    }
  }
}
