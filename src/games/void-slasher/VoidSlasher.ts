import { HandTracker } from '../../core/HandTracker';
import type { HandFrame, LabStatus } from '../../core/types';
import type { ScreenSlashSegment } from './CrystalManager';
import { VoidSlasherRenderer } from './VoidSlasherRenderer';

interface VoidSlasherOptions {
  onBack: () => void;
}

interface FingertipTrailPoint {
  x: number;
  y: number;
  life: number;
}

export class VoidSlasher {
  private readonly handTracker = new HandTracker();
  private renderer: VoidSlasherRenderer | null = null;
  private statusItems = new Map<string, HTMLElement>();
  private startPauseButton: HTMLButtonElement | null = null;
  private stage: HTMLElement | null = null;
  private trailCanvas: HTMLCanvasElement | null = null;
  private trailCtx: CanvasRenderingContext2D | null = null;
  private animationFrameId: number | null = null;
  private running = false;
  private isStarting = false;
  private disposed = false;
  private lastTimestamp = 0;
  private frameCounter = 0;
  private lastFpsTimestamp = 0;
  private fps = 0;
  private handCount = 0;
  private combo = 0;
  private comboTimer = 0;
  private modeLabel = 'Void idle';
  private lastNonEmptyFrame: HandFrame | null = null;
  private lastNonEmptyTimestamp = 0;
  private lastFingerPoint: { x: number; y: number } | null = null;
  private readonly fingertipTrail: FingertipTrailPoint[] = [];

  constructor(
    private readonly mount: HTMLElement,
    private readonly options: VoidSlasherOptions
  ) {}

  async start(): Promise<void> {
    if (this.running || this.isStarting) return;
    this.isStarting = true;

    if (!this.renderer) {
      this.render();
      this.attachRenderer();
    }

    this.updateControls();
    this.setStatusMessage('正在启动虚空碎影和手势识别...');

    try {
      await this.handTracker.initialize();
      if (this.disposed) return;
      this.running = true;
      this.startLoop();
      this.setStatusMessage('手势识别已启动。移动手指绘制光刃，快速挥动切碎晶体。');
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
    this.setStatusMessage('已暂停。点击启动继续切割。');
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
    this.mount.classList.remove('void-slasher-shell');
    this.mount.innerHTML = '';
  }

  private render(): void {
    this.mount.classList.add('void-slasher-shell');
    this.mount.innerHTML = `
      <div class="void-slasher-game">
        <header class="game-topbar void-slasher-topbar">
          <div>
            <p class="eyebrow">Gesture Slasher Demo</p>
            <h1>Void Slasher / 虚空碎影</h1>
          </div>
          <div class="topbar-actions">
            <button class="secondary-button" type="button" data-action="back">返回首页</button>
            <button class="primary-button" type="button" data-action="toggle">启动识别</button>
          </div>
        </header>

        <section class="void-slasher-stage">
          <canvas class="fingertip-trail-canvas" aria-hidden="true"></canvas>
          <div class="stage-badge void-slasher-badge">
            <span class="live-dot"></span>
            neon blade field
          </div>
          <div class="combo-readout" aria-live="polite">
            <span>COMBO</span>
            <strong data-status="combo-large">0</strong>
          </div>
        </section>

        <aside class="status-panel void-slasher-hud" aria-label="虚空碎影状态面板">
          <div class="panel-heading">
            <p class="eyebrow">Telemetry</p>
            <h2>切割状态</h2>
          </div>

          <div class="status-list">
            <div class="status-row"><span>Camera</span><strong data-status="camera">Idle</strong></div>
            <div class="status-row"><span>Hand Tracking</span><strong data-status="tracker">Idle</strong></div>
            <div class="status-row"><span>Hands</span><strong data-status="hands">0</strong></div>
            <div class="status-row"><span>FPS</span><strong data-status="fps">0</strong></div>
            <div class="status-row"><span>Combo</span><strong data-status="combo">0</strong></div>
            <div class="status-row"><span>Mode</span><strong data-status="mode">Void idle</strong></div>
          </div>

          <div class="instruction-panel">
            <h3>操作说明</h3>
            <ul>
              <li>Move your hand to draw a neon blade.</li>
              <li>Slash crystals to shatter them.</li>
              <li>Fast movement creates stronger trails.</li>
            </ul>
          </div>

          <div class="message-console" data-status="message">等待启动...</div>
        </aside>
      </div>
    `;

    this.stage = this.mount.querySelector<HTMLElement>('.void-slasher-stage');
    this.trailCanvas = this.mount.querySelector<HTMLCanvasElement>('.fingertip-trail-canvas');
    this.trailCtx = this.trailCanvas?.getContext('2d') ?? null;
    this.startPauseButton = this.mount.querySelector<HTMLButtonElement>('[data-action="toggle"]');
    this.mount.querySelector('[data-action="back"]')?.addEventListener('click', () => this.options.onBack());
    this.startPauseButton?.addEventListener('click', () => {
      if (this.running) this.pause();
      else void this.resume();
    });

    for (const key of ['camera', 'tracker', 'hands', 'fps', 'combo', 'combo-large', 'mode', 'message']) {
      const element = this.mount.querySelector<HTMLElement>(`[data-status="${key}"]`);
      if (element) this.statusItems.set(key, element);
    }
  }

  private attachRenderer(): void {
    if (!this.stage) throw new Error('Void Slasher stage was not created.');
    this.renderer = new VoidSlasherRenderer(this.stage);
    this.renderer.mount();
  }

  private startLoop(): void {
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.lastTimestamp = 0;
    this.frameCounter = 0;
    this.lastFpsTimestamp = 0;
    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  private loop = (timestamp: number): void => {
    if (!this.running || this.disposed) return;
    const delta = this.lastTimestamp > 0 ? Math.min((timestamp - this.lastTimestamp) / 1000, 0.08) : 0.016;
    this.lastTimestamp = timestamp;
    this.updateFps(timestamp);

    let frame: HandFrame | null = null;
    try {
      frame = this.handTracker.detect(timestamp);
    } catch (error) {
      this.running = false;
      this.updateControls();
      this.setStatusMessage(this.formatRuntimeError(error));
      this.updateStatus();
      return;
    }

    this.handCount = frame?.hands.length ?? 0;
    if (frame && frame.hands.length > 0) {
      this.lastNonEmptyFrame = frame;
      this.lastNonEmptyTimestamp = timestamp;
    }

    const holdFrame =
      this.handCount === 0 && this.lastNonEmptyFrame && timestamp - this.lastNonEmptyTimestamp < 650
        ? this.lastNonEmptyFrame
        : null;
    const renderFrame = frame && frame.hands.length > 0 ? frame : holdFrame;
    const screenSegment = this.updateFingertipTrail(renderFrame, delta);
    const stats = this.renderer?.render(delta, timestamp / 1000, renderFrame, screenSegment) ?? { hits: 0, slashing: false };
    this.updateCombo(stats.hits, delta);

    if (this.handCount === 0 && holdFrame) this.modeLabel = 'Tracking hold';
    else if (this.handCount === 0) this.modeLabel = 'Void idle';
    else if (stats.slashing) this.modeLabel = 'Blade slash';
    else this.modeLabel = 'Blade tracking';

    if (this.handCount === 0 && !holdFrame && this.handTracker.getTrackerStatus() === 'ready') {
      this.setStatusMessage('手势模型运行中，但当前没有识别到手。请让手掌完整进入摄像头视野，并保持画面光线充足。');
    } else if (this.handCount > 0 && stats.hits === 0) {
      this.setStatusMessage('已识别到手。移动食指生成光刃，快速穿过晶体即可破碎。');
    }

    this.updateStatus();
    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  private updateCombo(hits: number, delta: number): void {
    if (hits > 0) {
      this.combo += hits;
      this.comboTimer = 2.4;
      this.setStatusMessage(`Crystal shattered. Combo x${this.combo}`);
      this.triggerHitAnimation();
      return;
    }

    if (this.combo > 0) {
      this.comboTimer -= delta;
      if (this.comboTimer <= 0) this.combo = 0;
    }
  }

  private updateFingertipTrail(frame: HandFrame | null, delta: number): ScreenSlashSegment | null {
    this.resizeTrailCanvas();

    const hand = frame?.hands[0] ?? null;
    const tip = hand?.landmarks[8] ?? null;
    let segment: ScreenSlashSegment | null = null;

    for (const point of this.fingertipTrail) {
      point.life -= delta * 1.35;
    }

    if (tip) {
      const current = {
        x: 1 - tip.x,
        y: tip.y,
      };

      if (this.lastFingerPoint) {
        const distance = Math.hypot(current.x - this.lastFingerPoint.x, current.y - this.lastFingerPoint.y);
        const speed = distance / Math.max(0.001, delta);
        if (distance > 0.0015) {
          segment = {
            startX: this.lastFingerPoint.x,
            startY: this.lastFingerPoint.y,
            endX: current.x,
            endY: current.y,
            speed,
          };
        }
      }

      this.lastFingerPoint = current;
      this.fingertipTrail.push({ x: current.x, y: current.y, life: 1 });
      if (this.fingertipTrail.length > 34) this.fingertipTrail.shift();
    } else {
      this.lastFingerPoint = null;
    }

    for (let index = this.fingertipTrail.length - 1; index >= 0; index--) {
      if (this.fingertipTrail[index].life <= 0) this.fingertipTrail.splice(index, 1);
    }

    this.drawFingertipTrail();
    return segment;
  }

  private resizeTrailCanvas(): void {
    if (!this.trailCanvas || !this.stage) return;
    const rect = this.stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (this.trailCanvas.width === width && this.trailCanvas.height === height) return;
    this.trailCanvas.width = width;
    this.trailCanvas.height = height;
    this.trailCanvas.style.width = `${rect.width}px`;
    this.trailCanvas.style.height = `${rect.height}px`;
    this.trailCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private drawFingertipTrail(): void {
    if (!this.trailCanvas || !this.trailCtx || !this.stage) return;
    const ctx = this.trailCtx;
    const rect = this.stage.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);
    if (this.fingertipTrail.length === 0) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let index = 1; index < this.fingertipTrail.length; index++) {
      const previous = this.fingertipTrail[index - 1];
      const current = this.fingertipTrail[index];
      const t = index / Math.max(1, this.fingertipTrail.length - 1);
      const taper = t * t * t;
      const alpha = Math.max(0, Math.min(1, current.life)) * (0.16 + t * 0.62);
      const previousX = previous.x * width;
      const previousY = previous.y * height;
      const currentX = current.x * width;
      const currentY = current.y * height;

      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(86, 170, 210, ${alpha * 0.16})`;
      ctx.lineWidth = 24 * taper + 3;
      ctx.beginPath();
      ctx.moveTo(previousX, previousY);
      ctx.lineTo(currentX, currentY);
      ctx.stroke();

      ctx.strokeStyle = `rgba(138, 230, 255, ${alpha * 0.38})`;
      ctx.lineWidth = 9 * taper + 1.5;
      ctx.beginPath();
      ctx.moveTo(previousX, previousY);
      ctx.lineTo(currentX, currentY);
      ctx.stroke();

      ctx.lineCap = 'butt';
      ctx.strokeStyle = `rgba(246, 252, 255, ${alpha * 0.78})`;
      ctx.lineWidth = 2.4 * taper + 0.45;
      ctx.beginPath();
      ctx.moveTo(previousX, previousY);
      ctx.lineTo(currentX, currentY);
      ctx.stroke();
    }

    const tip = this.fingertipTrail[this.fingertipTrail.length - 1];
    const tipAlpha = Math.max(0, Math.min(1, tip.life));
    const gradient = ctx.createRadialGradient(tip.x * width, tip.y * height, 0, tip.x * width, tip.y * height, 18);
    gradient.addColorStop(0, `rgba(255, 255, 255, ${tipAlpha * 0.82})`);
    gradient.addColorStop(0.26, `rgba(146, 232, 255, ${tipAlpha * 0.48})`);
    gradient.addColorStop(1, 'rgba(146, 232, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(tip.x * width, tip.y * height, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private triggerHitAnimation(): void {
    const comboElement = this.statusItems.get('combo-large');
    const hudElement = this.mount.querySelector<HTMLElement>('.void-slasher-hud');
    if (!comboElement || !hudElement) return;

    comboElement.classList.remove('combo-anim-trigger');
    hudElement.classList.remove('hud-hit-trigger');
    void comboElement.offsetWidth;
    comboElement.classList.add('combo-anim-trigger');
    hudElement.classList.add('hud-hit-trigger');
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
    this.statusItems.get('combo')!.textContent = `${this.combo}`;
    this.statusItems.get('combo-large')!.textContent = `${this.combo}`;
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
    if (!(error instanceof Error)) return 'Void Slasher 运行时出错，请刷新页面后重试。';
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
