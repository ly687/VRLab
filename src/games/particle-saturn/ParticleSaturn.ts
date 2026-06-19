import { HandTracker } from '../../core/HandTracker';
import type { HandFrame, LabStatus, TrackedHand } from '../../core/types';
import { ParticleSaturnRenderer } from './ParticleSaturnRenderer';

interface ParticleSaturnOptions {
  onBack: () => void;
}

const DETECTION_INTERVAL_MS = 40;

export class ParticleSaturn {
  private readonly handTracker = new HandTracker();
  private renderer: ParticleSaturnRenderer | null = null;
  private statusItems = new Map<string, HTMLElement>();
  private startPauseButton: HTMLButtonElement | null = null;
  private stage: HTMLElement | null = null;
  private animationFrameId: number | null = null;
  private running = false;
  private isStarting = false;
  private disposed = false;
  private lastDetectionTimestamp = 0;
  private lastFpsTimestamp = 0;
  private frameCounter = 0;
  private fps = 0;
  private handCount = 0;
  private interactionLabel = '待机轨道';

  constructor(
    private readonly mount: HTMLElement,
    private readonly options: ParticleSaturnOptions
  ) {}

  async start(): Promise<void> {
    if (this.running || this.isStarting) return;
    this.isStarting = true;

    if (!this.renderer) {
      this.render();
      this.attachRenderer();
    }

    this.running = true;
    this.updateControls();
    this.startLoop();
    this.setStatusMessage('正在启动粒子土星和手势识别...');

    try {
      await this.handTracker.initialize();
      if (!this.disposed) this.setStatusMessage('手势识别已启动。拇指和食指距离控制缩放。');
    } catch (error) {
      this.setStatusMessage(this.formatRuntimeError(error));
    } finally {
      this.isStarting = false;
      this.updateControls();
    }
  }

  pause(): void {
    this.running = false;
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
    this.updateControls();
    this.setStatusMessage('已暂停。点击启动继续控制土星。');
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
    this.mount.classList.remove('saturn-shell');
    this.mount.innerHTML = '';
  }

  private render(): void {
    this.mount.classList.add('saturn-shell');
    this.mount.innerHTML = `
      <div class="saturn-game">
        <header class="saturn-topbar">
          <div>
            <p class="eyebrow">Particle Planet Demo</p>
            <h1>Particle Saturn</h1>
          </div>
          <div class="topbar-actions">
            <button class="secondary-button" type="button" data-action="back">返回首页</button>
            <button class="primary-button" type="button" data-action="toggle">启动识别</button>
          </div>
        </header>

        <section class="saturn-stage">
          <div class="stage-badge saturn-badge">
            <span class="live-dot"></span>
            180k particle saturn field
          </div>
        </section>

        <aside class="status-panel saturn-hud" aria-label="土星状态面板">
          <div class="panel-heading">
            <p class="eyebrow">Telemetry</p>
            <h2>土星控制台</h2>
          </div>
          <div class="status-list">
            <div class="status-row"><span>摄像头权限</span><strong data-status="camera">Idle</strong></div>
            <div class="status-row"><span>手势模型</span><strong data-status="tracker">Idle</strong></div>
            <div class="status-row"><span>检测手数</span><strong data-status="hands">0</strong></div>
            <div class="status-row"><span>交互状态</span><strong data-status="interaction">待机轨道</strong></div>
            <div class="status-row"><span>FPS</span><strong data-status="fps">0</strong></div>
          </div>
          <div class="instruction-panel">
            <h3>手势说明</h3>
            <ul>
              <li>拇指 + 食指距离：缩放土星</li>
              <li>手掌上下移动：调整俯仰</li>
              <li>手掌左右移动：调整 Y 轴旋转</li>
            </ul>
          </div>
          <div class="message-console" data-status="message">等待启动...</div>
        </aside>
      </div>
    `;

    this.stage = this.mount.querySelector<HTMLElement>('.saturn-stage');
    this.startPauseButton = this.mount.querySelector<HTMLButtonElement>('[data-action="toggle"]');
    this.mount.querySelector('[data-action="back"]')?.addEventListener('click', () => this.options.onBack());
    this.startPauseButton?.addEventListener('click', () => {
      if (this.running) this.pause();
      else void this.resume();
    });

    for (const key of ['camera', 'tracker', 'hands', 'interaction', 'fps', 'message']) {
      const element = this.mount.querySelector<HTMLElement>(`[data-status="${key}"]`);
      if (element) this.statusItems.set(key, element);
    }
  }

  private attachRenderer(): void {
    if (!this.stage) throw new Error('Particle Saturn stage was not created.');
    this.renderer = new ParticleSaturnRenderer(this.stage);
    this.renderer.mount();
  }

  private startLoop(): void {
    this.lastDetectionTimestamp = 0;
    this.lastFpsTimestamp = 0;
    this.frameCounter = 0;
    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  private loop = (timestamp: number): void => {
    if (!this.running || this.disposed) return;
    const seconds = timestamp / 1000;
    this.updateFps(timestamp);

    try {
      if (this.handTracker.getTrackerStatus() === 'ready') {
        let frame = this.handTracker.getLastFrame();
        if (this.lastDetectionTimestamp === 0 || timestamp - this.lastDetectionTimestamp >= DETECTION_INTERVAL_MS) {
          frame = this.handTracker.detect(timestamp);
          this.lastDetectionTimestamp = timestamp;
        }
        this.processFrame(frame);
      } else {
        this.handCount = 0;
        this.interactionLabel = '等待模型';
      }
    } catch (error) {
      this.setStatusMessage(this.formatRuntimeError(error));
    }

    this.renderer?.render(seconds);
    this.updateStatus();
    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  private processFrame(frame: HandFrame | null): void {
    this.handCount = frame?.hands.length ?? 0;
    if (!frame || frame.hands.length === 0) {
      this.interactionLabel = '待机轨道';
      this.renderer?.setInteraction({
        scale: 0.92,
        rotationX: 0.34,
        rotationY: 0,
        handActive: false,
      });
      return;
    }

    const hand = frame.hands[0];
    const state = this.getSaturnState(hand);
    this.interactionLabel = '手势控制中';
    this.renderer?.setInteraction(state);
  }

  private getSaturnState(hand: TrackedHand): {
    scale: number;
    rotationX: number;
    rotationY: number;
    handActive: boolean;
  } {
    const thumb = hand.landmarks[4];
    const index = hand.landmarks[8];
    const palm = hand.landmarks[9];
    const distance = Math.hypot(thumb.x - index.x, thumb.y - index.y);
    const normDistance = Math.max(0, Math.min(1, (distance - 0.02) / 0.25));
    const normY = Math.max(0, Math.min(1, (palm.y - 0.1) / 0.8));
    const normX = Math.max(0, Math.min(1, (palm.x - 0.1) / 0.7));
    return {
      scale: 0.15 + normDistance * 2.35,
      rotationX: -0.6 + normY * 1.6,
      rotationY: -Math.PI / 2 + normX * Math.PI,
      handActive: true,
    };
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
    this.statusItems.get('interaction')!.textContent = this.interactionLabel;
    this.statusItems.get('fps')!.textContent = `${this.fps}`;
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
      ready: 'Allowed',
      denied: 'Denied',
      error: 'Error',
    };
    return labels[status];
  }

  private formatTrackerStatus(status: LabStatus['trackerStatus']): string {
    const labels: Record<LabStatus['trackerStatus'], string> = {
      idle: 'Idle',
      loading: 'Loading',
      ready: 'Ready',
      error: 'Error',
    };
    return labels[status];
  }

  private formatRuntimeError(error: unknown): string {
    if (!(error instanceof Error)) return '粒子土星运行时出错，请刷新页面后重试。';
    if (error instanceof DOMException && error.name === 'NotAllowedError') return '摄像头权限被拒绝。请在浏览器地址栏允许摄像头访问。';
    if (error.message.includes('Device in use') || error.message.includes('Could not start video source')) {
      return '摄像头被其他程序占用。请关闭会议软件、相机或其它摄像头页面后重试。';
    }
    return error.message.length > 180 ? `${error.message.slice(0, 180)}...` : error.message;
  }
}
