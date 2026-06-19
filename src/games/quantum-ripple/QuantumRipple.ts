import { HandTracker } from '../../core/HandTracker';
import type { HandFrame, LabStatus, TrackedHand } from '../../core/types';
import { QuantumRippleRenderer, type QuantumHandInput } from './QuantumRippleRenderer';

interface QuantumRippleOptions {
  onBack: () => void;
}

const DETECTION_INTERVAL_MS = 40;

export class QuantumRipple {
  private readonly handTracker = new HandTracker();
  private renderer: QuantumRippleRenderer | null = null;
  private statusItems = new Map<string, HTMLElement>();
  private startPauseButton: HTMLButtonElement | null = null;
  private stage: HTMLElement | null = null;
  private animationFrameId: number | null = null;
  private running = false;
  private isStarting = false;
  private disposed = false;
  private lastTimestamp = 0;
  private lastDetectionTimestamp = 0;
  private lastFpsTimestamp = 0;
  private frameCounter = 0;
  private fps = 0;
  private handCount = 0;
  private score = 0;
  private missed = 0;
  private anomalyCount = 0;
  private modeLabel = 'Quantum idle';
  private previousFistState = false;

  constructor(
    private readonly mount: HTMLElement,
    private readonly options: QuantumRippleOptions
  ) {}

  async start(): Promise<void> {
    if (this.running || this.isStarting) return;
    this.isStarting = true;

    if (!this.renderer) {
      this.render();
      this.attachRenderer();
    }

    this.updateControls();
    this.setStatusMessage('正在启动量子波纹和手势识别...');

    try {
      await this.handTracker.initialize();
      if (this.disposed) return;
      this.running = true;
      this.startLoop();
      this.setStatusMessage('手势识别已启动。移动手掌抬起量子网格，握拳释放冲击波。');
    } catch (error) {
      this.running = false;
      this.setStatusMessage(this.formatRuntimeError(error));
    } finally {
      this.isStarting = false;
      this.updateControls();
      this.updateStatus();
    }
  }

  pause(): void {
    this.running = false;
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
    this.updateControls();
    this.setStatusMessage('已暂停。点击启动继续控制量子场。');
  }

  async resume(): Promise<void> {
    await this.start();
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    this.renderer?.dispose();
    this.renderer = null;
    this.handTracker.dispose();
    this.mount.classList.remove('quantum-ripple-shell');
    this.mount.innerHTML = '';
  }

  private render(): void {
    this.mount.classList.add('quantum-ripple-shell');
    this.mount.innerHTML = `
      <div class="quantum-ripple-game">
        <header class="game-topbar quantum-ripple-topbar">
          <div>
            <p class="eyebrow">Quantum Field Demo</p>
            <h1>Quantum Ripple / 量子波纹</h1>
          </div>
          <div class="topbar-actions">
            <button class="secondary-button" type="button" data-action="back">返回首页</button>
            <button class="primary-button" type="button" data-action="toggle">启动识别</button>
          </div>
        </header>

        <section class="quantum-ripple-stage">
          <div class="stage-badge quantum-ripple-badge">
            <span class="live-dot"></span>
            2.5k visible hex field
          </div>
          <div class="quantum-score" aria-live="polite">
            <span>SCORE</span>
            <strong data-status="score-large">0</strong>
          </div>
          <div class="quantum-alarm" aria-hidden="true"></div>
        </section>

        <aside class="status-panel quantum-ripple-hud" aria-label="量子波纹状态面板">
          <div class="panel-heading">
            <p class="eyebrow">Telemetry</p>
            <h2>量子场状态</h2>
          </div>

          <div class="status-list">
            <div class="status-row"><span>Camera</span><strong data-status="camera">Idle</strong></div>
            <div class="status-row"><span>Hand Tracking</span><strong data-status="tracker">Idle</strong></div>
            <div class="status-row"><span>Hands</span><strong data-status="hands">0</strong></div>
            <div class="status-row"><span>FPS</span><strong data-status="fps">0</strong></div>
            <div class="status-row"><span>Score</span><strong data-status="score">0</strong></div>
            <div class="status-row"><span>Missed</span><strong data-status="missed">0</strong></div>
            <div class="status-row"><span>Anomalies</span><strong data-status="anomalies">0</strong></div>
            <div class="status-row"><span>Mode</span><strong data-status="mode">Quantum idle</strong></div>
          </div>

          <div class="instruction-panel">
            <h3>操作说明</h3>
            <ul>
              <li>移动手掌：抬起量子蜂窝网格</li>
              <li>接住红色异常球：得分</li>
              <li>握拳：释放扩散冲击波</li>
              <li>双手进入画面：生成双波峰</li>
            </ul>
          </div>

          <div class="message-console" data-status="message">等待启动...</div>
        </aside>
      </div>
    `;

    this.stage = this.mount.querySelector<HTMLElement>('.quantum-ripple-stage');
    this.startPauseButton = this.mount.querySelector<HTMLButtonElement>('[data-action="toggle"]');
    this.mount.querySelector('[data-action="back"]')?.addEventListener('click', () => this.options.onBack());
    this.startPauseButton?.addEventListener('click', () => {
      if (this.running) this.pause();
      else void this.resume();
    });

    for (const key of ['camera', 'tracker', 'hands', 'fps', 'score', 'score-large', 'missed', 'anomalies', 'mode', 'message']) {
      const element = this.mount.querySelector<HTMLElement>(`[data-status="${key}"]`);
      if (element) this.statusItems.set(key, element);
    }
  }

  private attachRenderer(): void {
    if (!this.stage) throw new Error('Quantum Ripple stage was not created.');
    this.renderer = new QuantumRippleRenderer(this.stage);
    this.renderer.mount();
  }

  private startLoop(): void {
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.lastTimestamp = 0;
    this.lastDetectionTimestamp = 0;
    this.lastFpsTimestamp = 0;
    this.frameCounter = 0;
    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  private loop = (timestamp: number): void => {
    if (!this.running || this.disposed) return;
    const delta = this.lastTimestamp > 0 ? Math.min((timestamp - this.lastTimestamp) / 1000, 0.08) : 0.016;
    this.lastTimestamp = timestamp;
    this.updateFps(timestamp);

    let frame: HandFrame | null = this.handTracker.getLastFrame();
    try {
      if (this.lastDetectionTimestamp === 0 || timestamp - this.lastDetectionTimestamp >= DETECTION_INTERVAL_MS) {
        frame = this.handTracker.detect(timestamp);
        this.lastDetectionTimestamp = timestamp;
      }
    } catch (error) {
      this.running = false;
      this.updateControls();
      this.setStatusMessage(this.formatRuntimeError(error));
      this.updateStatus();
      return;
    }

    const hands = this.processFrame(frame);
    this.renderer?.setHands(hands);
    const stats = this.renderer?.render(delta, timestamp / 1000) ?? { caught: 0, missed: 0, activeAnomalies: 0 };
    this.updateScore(stats.caught, stats.missed);
    this.anomalyCount = stats.activeAnomalies;
    this.updateStatus();
    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  private processFrame(frame: HandFrame | null): QuantumHandInput[] {
    this.handCount = frame?.hands.length ?? 0;
    if (!frame || frame.hands.length === 0) {
      this.modeLabel = this.handTracker.getTrackerStatus() === 'ready' ? 'Quantum idle' : 'Waiting model';
      this.previousFistState = false;
      if (this.handTracker.getTrackerStatus() === 'ready') {
        this.setStatusMessage('量子场待机中。让手掌完整进入摄像头视野即可抬起网格。');
      }
      return [];
    }

    const hands = frame.hands.slice(0, 2).map((hand) => this.handToRippleInput(hand));
    const fistNow = frame.hands.some((hand) => this.isFist(hand));
    if (fistNow && !this.previousFistState && hands[0]) {
      this.renderer?.triggerRipple(hands[0].x, hands[0].z);
      this.setStatusMessage('冲击波释放。红色异常球接触波峰即可捕捉。');
    } else if (hands.length > 1) {
      this.setStatusMessage('双手波峰已激活。移动双手可以同时抬起两片量子场。');
    } else {
      this.setStatusMessage('手掌正在控制量子波峰。把红色异常球托住即可得分。');
    }

    this.previousFistState = fistNow;
    this.modeLabel = fistNow ? 'Ripple shockwave' : hands.length > 1 ? 'Dual peak' : 'Gravity peak';
    return hands;
  }

  private handToRippleInput(hand: TrackedHand): QuantumHandInput {
    const palm = hand.landmarks[9] ?? hand.landmarks[0];
    const aspect = this.stage ? this.stage.clientWidth / Math.max(1, this.stage.clientHeight) : 16 / 9;
    const x = (0.5 - palm.x) * 20 * aspect;
    const z = (palm.y - 0.5) * 30;
    return {
      x,
      z,
      active: true,
    };
  }

  private isFist(hand: TrackedHand): boolean {
    const landmarks = hand.landmarks;
    const wrist = landmarks[0];
    const palm = landmarks[9];
    const palmSize = Math.hypot(palm.x - wrist.x, palm.y - wrist.y) || 0.1;
    const folded = [8, 12, 16, 20].filter((tipIndex) => {
      const tip = landmarks[tipIndex];
      return Math.hypot(tip.x - wrist.x, tip.y - wrist.y) < palmSize * 1.55;
    }).length;
    const thumbTip = landmarks[4];
    const indexBase = landmarks[5];
    const thumbFolded = Math.hypot(thumbTip.x - indexBase.x, thumbTip.y - indexBase.y) < palmSize * 1.1;
    return folded >= 3 && thumbFolded;
  }

  private updateScore(caught: number, missed: number): void {
    if (caught > 0) {
      this.score += caught;
      this.triggerScoreAnimation();
      this.setStatusMessage(`异常数据已捕捉。Score ${this.score}`);
    }

    if (missed > 0) {
      this.missed += missed;
      this.mount.querySelector('.quantum-ripple-game')?.classList.add('quantum-missed');
      window.setTimeout(() => this.mount.querySelector('.quantum-ripple-game')?.classList.remove('quantum-missed'), 320);
      this.setStatusMessage('异常数据坠落。移动手掌把下一颗红球托起来。');
    }
  }

  private triggerScoreAnimation(): void {
    const scoreElement = this.statusItems.get('score-large');
    const hudElement = this.mount.querySelector<HTMLElement>('.quantum-ripple-hud');
    if (!scoreElement || !hudElement) return;
    scoreElement.classList.remove('quantum-score-pop');
    hudElement.classList.remove('quantum-hud-hit');
    void scoreElement.offsetWidth;
    scoreElement.classList.add('quantum-score-pop');
    hudElement.classList.add('quantum-hud-hit');
  }

  private updateFps(timestamp: number): void {
    this.frameCounter++;
    if (this.lastFpsTimestamp === 0) {
      this.lastFpsTimestamp = timestamp;
      return;
    }
    const elapsed = timestamp - this.lastFpsTimestamp;
    if (elapsed >= 500) {
      this.fps = Math.round((this.frameCounter * 1000) / elapsed);
      this.frameCounter = 0;
      this.lastFpsTimestamp = timestamp;
    }
  }

  private updateStatus(): void {
    this.statusItems.get('camera')!.textContent = this.formatCameraStatus(this.handTracker.camera.getStatus());
    this.statusItems.get('tracker')!.textContent = this.formatTrackerStatus(this.handTracker.getTrackerStatus());
    this.statusItems.get('hands')!.textContent = `${this.handCount}`;
    this.statusItems.get('fps')!.textContent = `${this.fps}`;
    this.statusItems.get('score')!.textContent = `${this.score}`;
    this.statusItems.get('score-large')!.textContent = `${this.score}`;
    this.statusItems.get('missed')!.textContent = `${this.missed}`;
    this.statusItems.get('anomalies')!.textContent = `${this.anomalyCount}`;
    this.statusItems.get('mode')!.textContent = this.modeLabel;
  }

  private setStatusMessage(message: string): void {
    const item = this.statusItems.get('message');
    if (item) item.textContent = message;
  }

  private updateControls(): void {
    if (!this.startPauseButton) return;
    this.startPauseButton.disabled = this.isStarting;
    this.startPauseButton.textContent = this.isStarting ? '启动中...' : this.running ? '暂停' : '启动识别';
  }

  private formatCameraStatus(status: LabStatus['cameraStatus']): string {
    const labels: Record<LabStatus['cameraStatus'], string> = {
      idle: 'Idle',
      requesting: 'Requesting',
      ready: 'Ready',
      denied: 'Denied',
      error: 'Error',
    };
    return labels[status];
  }

  private formatTrackerStatus(status: LabStatus['trackerStatus']): string {
    const labels: Record<LabStatus['trackerStatus'], string> = {
      idle: 'Idle',
      loading: 'Loading',
      ready: 'Active',
      error: 'Error',
    };
    return labels[status];
  }

  private formatRuntimeError(error: unknown): string {
    if (!(error instanceof Error)) return 'Quantum Ripple 运行时出错，请刷新页面后重试。';
    if (error instanceof DOMException && error.name === 'NotAllowedError') return '摄像头权限被拒绝。请在浏览器地址栏允许摄像头访问。';
    if (error.message.includes('Device in use') || error.message.includes('Could not start video source')) {
      return '摄像头被其他程序占用。请关闭会议软件、相机或其它摄像头页面后重试。';
    }
    if (error.message.includes('Packet timestamp mismatch')) {
      return '手势识别时间戳异常。请点击启动重试；如果反复出现，请刷新页面。';
    }
    return error.message.length > 180 ? `${error.message.slice(0, 180)}...` : error.message;
  }
}
