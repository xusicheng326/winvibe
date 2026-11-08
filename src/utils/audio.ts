/**
 * WinVibe 8-bit & Modern 微交互音效管理器
 * 基于原生 Web Audio API，无需引入任何外部 mp3/wav 静态资源
 */

class SoundManager {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('winvibe_muted') === 'true';
    } catch {}
  }

  private getContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem('winvibe_muted', String(this.muted));
    } catch {}
    return this.muted;
  }

  /**
   * 机械键盘微动触感音效 (用于点击按钮、快捷键批准)
   */
  public playClick() {
    const ctx = this.getContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.03);

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.03);
  }

  /**
   * 8-bit 任务就绪/完成提示音：上升三和弦琶音 (C5 -> E5 -> G5 -> C6)
   */
  public playSuccess() {
    const ctx = this.getContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.50];
    const startTime = ctx.currentTime;

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime + idx * 0.07);

      gain.gain.setValueAtTime(0.12, startTime + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + idx * 0.07 + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime + idx * 0.07);
      osc.stop(startTime + idx * 0.07 + 0.12);
    });
  }

  /**
   * 8-bit 提问/高危审批提示音：双频跳跃 (F5 -> A5)
   */
  public playAttention() {
    const ctx = this.getContext();
    if (!ctx) return;

    const startTime = ctx.currentTime;
    const freqs = [698.46, 880.00];

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, startTime + idx * 0.08);

      gain.gain.setValueAtTime(0.08, startTime + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + idx * 0.08 + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime + idx * 0.08);
      osc.stop(startTime + idx * 0.08 + 0.12);
    });
  }

  /**
   * 8-bit 拦截/拒绝/高危警告音：下行低音 (Eb4 -> C4)
   */
  public playDanger() {
    const ctx = this.getContext();
    if (!ctx) return;

    const startTime = ctx.currentTime;
    const freqs = [311.13, 261.63];

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, startTime + idx * 0.1);

      gain.gain.setValueAtTime(0.1, startTime + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + idx * 0.1 + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime + idx * 0.1);
      osc.stop(startTime + idx * 0.1 + 0.15);
    });
  }
}

export const soundManager = new SoundManager();
