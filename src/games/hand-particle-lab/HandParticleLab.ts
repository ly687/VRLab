import { HandTracker } from '../../core/HandTracker';
import type { HandFrame, LabStatus } from '../../core/types';
import { GlowHandRenderer } from '../../effects/GlowHandRenderer';
import { TrailCanvas } from '../../effects/TrailCanvas';

interface HandParticleLabOptions {
  onBack: () => void;
}

export class HandParticleLab {
  private readonly mount: HTMLElement;
  private readonly options: HandParticleLabOptions;
  private readonly handTracker = new HandTracker();
  private readonly trailCanvas = new TrailCanvas();
  private readonly handRenderer = new GlowHandRenderer();

  private layout: HTMLElement | null = null;
  private statusItems = new Map<string, HTMLElement>();
  private startPauseButton: HTMLButtonElement | null = null;
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private running = false;
  private isStarting = false;
  private disposed = false;
  private lastTimestamp = 0;
  private frameCounter = 0;
  private fps = 0;
  private lastFpsTimestamp = 0;

  constructor(mount: HTMLElement, options: HandParticleLabOptions) {
    this.mount = mount;
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.running || this.isStarting) {
      return;
    }

    this.isStarting = true;

    if (!this.layout) {
      this.render();
      this.attachCanvas();
    }

    this.setStatus({
      cameraStatus: this.handTracker.camera.getStatus(),
      trackerStatus: this.handTracker.getTrackerStatus(),
      handCount: 0,
      fps: this.fps,
      running: false,
      message: '正在请求摄像头权限并加载手势模型...',
    });

    try {
      await this.handTracker.initialize();
      if (this.disposed) return;
      this.running = true;
      this.updateControls();
      this.startLoop();
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? '摄像头权限被拒绝。请在浏览器地址栏允许摄像头访问。'
          : error instanceof DOMException && error.name === 'NotReadableError'
            ? '摄像头被其他程序占用。请关闭会议软件、相机或其它摄像头页面后重试。'
          : error instanceof Error
            ? this.formatRuntimeError(error)
            : '摄像头或手势模型初始化失败。';

      this.running = false;
      this.updateControls();
      this.drawStaticError(message);
      this.setStatus({
        cameraStatus: this.handTracker.camera.getStatus(),
        trackerStatus: this.handTracker.getTrackerStatus(),
        handCount: 0,
        fps: this.fps,
        running: false,
        message,
      });
    } finally {
      this.isStarting = false;
      this.updateControls();
    }
  }

  pause(): void {
    this.running = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.updateControls();
    this.setMessage('已暂停。点击启动继续识别。');
  }

  async resume(): Promise<void> {
    await this.start();
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.handTracker.dispose();
    this.mount.innerHTML = '';
  }

  private render(): void {
    this.mount.innerHTML = `
      <div class="game-view hand-particle-lab">
        <header class="game-topbar">
          <div>
            <p class="eyebrow">Live Gesture Demo</p>
            <h1>Hand Particle Lab</h1>
          </div>
          <div class="topbar-actions">
            <button class="secondary-button" type="button" data-action="back">返回首页</button>
            <button class="primary-button" type="button" data-action="toggle">启动识别</button>
          </div>
        </header>

        <section class="game-layout">
          <div class="canvas-stage">
            <div class="stage-badge">
              <span class="live-dot"></span>
              Abstract hand-space renderer
            </div>
          </div>

          <aside class="status-panel" aria-label="状态面板">
            <div class="panel-heading">
              <p class="eyebrow">Telemetry</p>
              <h2>状态面板</h2>
            </div>

            <div class="status-list">
              <div class="status-row">
                <span>摄像头权限</span>
                <strong data-status="camera">Idle</strong>
              </div>
              <div class="status-row">
                <span>手势模型</span>
                <strong data-status="tracker">Idle</strong>
              </div>
              <div class="status-row">
                <span>检测手数</span>
                <strong data-status="hands">0</strong>
              </div>
              <div class="status-row">
                <span>FPS</span>
                <strong data-status="fps">0</strong>
              </div>
              <div class="status-row">
                <span>运行状态</span>
                <strong data-status="running">Stopped</strong>
              </div>
            </div>

            <div class="instruction-panel">
              <h3>操作说明</h3>
              <p>允许摄像头后，将一只或两只手放入摄像头视野。画面不会显示真实摄像头，只会显示抽象手部骨架和柔和能量残影。</p>
              <ul>
                <li>移动手掌：生成柔和拖尾</li>
                <li>移动五个指尖：显示发光关键点</li>
                <li>双手同时进入：显示双手骨架</li>
              </ul>
            </div>

            <div class="message-console" data-status="message">
              等待启动...
            </div>
          </aside>
        </section>
      </div>
    `;

    this.layout = this.mount.querySelector('.game-view');
    this.startPauseButton = this.mount.querySelector<HTMLButtonElement>('[data-action="toggle"]');

    this.mount.querySelector('[data-action="back"]')?.addEventListener('click', () => {
      this.options.onBack();
    });

    this.startPauseButton?.addEventListener('click', () => {
      if (this.running) {
        this.pause();
      } else {
        void this.resume();
      }
    });

    for (const key of ['camera', 'tracker', 'hands', 'fps', 'running', 'message']) {
      const element = this.mount.querySelector<HTMLElement>(`[data-status="${key}"]`);
      if (element) {
        this.statusItems.set(key, element);
      }
    }
  }

  private attachCanvas(): void {
    const stage = this.mount.querySelector<HTMLElement>('.canvas-stage');
    if (!stage) {
      throw new Error('Canvas stage was not created.');
    }

    stage.prepend(this.trailCanvas.canvas);

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      this.trailCanvas.resize(rect.width, rect.height);
      this.trailCanvas.clear();
      this.drawFrame(null, 0.016);
    };

    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(stage);
    resize();
  }

  private loop = (timestamp: number): void => {
    if (!this.running || this.disposed) {
      return;
    }

    const deltaSeconds =
      this.lastTimestamp > 0 ? Math.min((timestamp - this.lastTimestamp) / 1000, 0.08) : 0.016;
    this.lastTimestamp = timestamp;
    this.updateFps(timestamp);

    let frame: HandFrame | null = null;

    try {
      frame = this.handTracker.detect(timestamp);
    } catch (error) {
      this.running = false;
      this.updateControls();
      this.setStatus({
        cameraStatus: this.handTracker.camera.getStatus(),
        trackerStatus: this.handTracker.getTrackerStatus(),
        handCount: 0,
        fps: this.fps,
        running: false,
        message: this.formatRuntimeError(error),
      });
      return;
    }

    this.drawFrame(frame, deltaSeconds);

    this.setStatus({
      cameraStatus: this.handTracker.camera.getStatus(),
      trackerStatus: this.handTracker.getTrackerStatus(),
      handCount: frame?.hands.length ?? 0,
      fps: this.fps,
      running: this.running,
      message:
        frame && frame.hands.length > 0
          ? `识别中：${frame.hands.length} 只手正在驱动画面。`
          : '没有检测到手。请让手掌进入摄像头视野。',
    });

    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  private drawFrame(frame: HandFrame | null, deltaSeconds: number): void {
    const ctx = this.trailCanvas.ctx;
    const width = this.trailCanvas.width();
    const height = this.trailCanvas.height();

    this.trailCanvas.fade(frame && frame.hands.length > 0 ? 0.28 : 0.32);
    this.handRenderer.update(deltaSeconds);
    this.handRenderer.drawBackground(ctx, width, height);

    if (frame && frame.hands.length > 0) {
      this.handRenderer.drawHands(ctx, frame, width, height);
    } else {
      this.handRenderer.drawIdle(ctx, width, height);
    }
  }

  private drawStaticError(message: string): void {
    const ctx = this.trailCanvas.ctx;
    const width = this.trailCanvas.width();
    const height = this.trailCanvas.height();

    this.trailCanvas.fade(0.26);
    this.handRenderer.drawBackground(ctx, width, height);
    ctx.save();
    ctx.fillStyle = 'rgba(255, 232, 214, 0.92)';
    ctx.textAlign = 'center';
    ctx.font = '600 16px Inter, system-ui, sans-serif';
    ctx.fillText(message, width * 0.5, height * 0.5);
    ctx.restore();
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

  private setStatus(status: LabStatus): void {
    this.statusItems.get('camera')!.textContent = this.formatCameraStatus(status.cameraStatus);
    this.statusItems.get('tracker')!.textContent = this.formatTrackerStatus(status.trackerStatus);
    this.statusItems.get('hands')!.textContent = `${status.handCount}`;
    this.statusItems.get('fps')!.textContent = `${status.fps}`;
    this.statusItems.get('running')!.textContent = status.running ? 'Running' : 'Stopped';
    this.statusItems.get('message')!.textContent = status.message;
  }

  private setMessage(message: string): void {
    const item = this.statusItems.get('message');
    if (item) item.textContent = message;
  }

  private updateControls(): void {
    if (this.startPauseButton) {
      this.startPauseButton.disabled = this.isStarting;
      this.startPauseButton.textContent = this.isStarting
        ? '启动中...'
        : this.running
          ? '暂停'
          : '启动识别';
    }
  }

  private startLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.lastTimestamp = 0;
    this.frameCounter = 0;
    this.lastFpsTimestamp = 0;
    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  private formatRuntimeError(error: unknown): string {
    if (!(error instanceof Error)) {
      return '手势识别运行时出错，请刷新页面后重试。';
    }

    const message = error.message;

    if (message.includes('Packet timestamp mismatch')) {
      return '手势识别时间戳异常，已停止本轮识别。请点击“启动识别”重试；如果反复出现，请刷新页面。';
    }

    if (message.includes('Could not start video source') || message.includes('Device in use')) {
      return '摄像头被其他程序占用。请关闭会议软件、相机或其它摄像头页面后重试。';
    }

    return message.length > 180 ? `${message.slice(0, 180)}...` : message;
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
}
