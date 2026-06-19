import * as THREE from 'three';
import { HandTracker } from '../../core/HandTracker';
import type { HandFrame, LabStatus, TrackedHand } from '../../core/types';
import { RepulsionOrbRenderer } from './RepulsionOrbRenderer';

interface RepulsionOrbOptions {
  onBack: () => void;
}

const DETECTION_INTERVAL_MS = 40;

export class RepulsionOrb {
  private readonly handTracker = new HandTracker();
  private renderer: RepulsionOrbRenderer | null = null;
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
  private modeLabel = '待机回流';

  constructor(
    private readonly mount: HTMLElement,
    private readonly options: RepulsionOrbOptions
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
    this.setStatusMessage('正在启动排斥球场和手势识别...');

    try {
      await this.handTracker.initialize();
      if (!this.disposed) this.setStatusMessage('手势识别已启动。右手握拳排斥，左手捏合抓取一颗小球。');
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
    this.renderer?.setState({
      repulsing: false,
      grabbing: false,
      repulsorTarget: null,
      grabberTarget: null,
    });
    this.updateControls();
    this.setStatusMessage('已暂停。点击启动继续控制排斥球。');
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
    this.mount.classList.remove('repulsion-shell');
    this.mount.innerHTML = '';
  }

  private render(): void {
    this.mount.classList.add('repulsion-shell');
    this.mount.innerHTML = `
      <div class="repulsion-game">
        <header class="repulsion-topbar">
          <div>
            <p class="eyebrow">Magnetic Clutter Demo</p>
            <h1>Repulsion Orb</h1>
          </div>
          <div class="topbar-actions">
            <button class="secondary-button" type="button" data-action="back">返回首页</button>
            <button class="primary-button" type="button" data-action="toggle">启动识别</button>
          </div>
        </header>

        <section class="repulsion-stage">
          <div class="stage-badge repulsion-badge">
            <span class="live-dot"></span>
            magnetic repulsion field
          </div>
        </section>

        <aside class="status-panel repulsion-hud" aria-label="排斥球状态面板">
          <div class="panel-heading">
            <p class="eyebrow">Physics Field</p>
            <h2>排斥球状态</h2>
          </div>
          <div class="status-list">
            <div class="status-row"><span>摄像头权限</span><strong data-status="camera">Idle</strong></div>
            <div class="status-row"><span>手势模型</span><strong data-status="tracker">Idle</strong></div>
            <div class="status-row"><span>检测手数</span><strong data-status="hands">0</strong></div>
            <div class="status-row"><span>当前模式</span><strong data-status="mode">待机回流</strong></div>
            <div class="status-row"><span>FPS</span><strong data-status="fps">0</strong></div>
          </div>
          <div class="instruction-panel">
            <h3>手势说明</h3>
            <ul>
              <li>右手握拳：生成排斥核心，推开小球</li>
              <li>左手拇指 + 食指捏合：抓取最近一颗小球</li>
              <li>松开手势：小球缓慢回流</li>
            </ul>
          </div>
          <div class="message-console" data-status="message">等待启动...</div>
        </aside>
      </div>
    `;

    this.stage = this.mount.querySelector<HTMLElement>('.repulsion-stage');
    this.startPauseButton = this.mount.querySelector<HTMLButtonElement>('[data-action="toggle"]');
    this.mount.querySelector('[data-action="back"]')?.addEventListener('click', () => this.options.onBack());
    this.startPauseButton?.addEventListener('click', () => {
      if (this.running) this.pause();
      else void this.resume();
    });

    for (const key of ['camera', 'tracker', 'hands', 'mode', 'fps', 'message']) {
      const element = this.mount.querySelector<HTMLElement>(`[data-status="${key}"]`);
      if (element) this.statusItems.set(key, element);
    }
  }

  private attachRenderer(): void {
    if (!this.stage) throw new Error('Repulsion stage was not created.');
    this.renderer = new RepulsionOrbRenderer(this.stage);
    this.renderer.mount();
  }

  private startLoop(): void {
    this.lastTimestamp = 0;
    this.lastDetectionTimestamp = 0;
    this.frameCounter = 0;
    this.lastFpsTimestamp = 0;
    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  private loop = (timestamp: number): void => {
    if (!this.running || this.disposed) return;
    const delta = this.lastTimestamp > 0 ? Math.min((timestamp - this.lastTimestamp) / 1000, 0.08) : 0.016;
    this.lastTimestamp = timestamp;
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
        this.modeLabel = '等待模型';
      }
    } catch (error) {
      this.setStatusMessage(this.formatRuntimeError(error));
    }

    this.renderer?.render(delta, timestamp / 1000);
    this.updateStatus();
    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  private processFrame(frame: HandFrame | null): void {
    this.handCount = frame?.hands.length ?? 0;
    if (!frame || frame.hands.length === 0) {
      this.modeLabel = '待机回流';
      this.renderer?.setState({
        repulsing: false,
        grabbing: false,
        repulsorTarget: null,
        grabberTarget: null,
      });
      return;
    }

    const rightHand = this.getHandBySide(frame.hands, 'right');
    const leftHand = this.getHandBySide(frame.hands, 'left');
    const rightFist = rightHand ? this.isFist(rightHand) : false;
    const leftPinch = leftHand ? this.isPinching(leftHand) : false;
    const repulsorTarget = rightFist && rightHand
      ? this.getHandWorldTarget(rightHand)
      : null;
    const grabberTarget = leftPinch && leftHand
      ? this.getHandWorldTarget(leftHand)
      : null;

    this.modeLabel = leftPinch ? '左手捏合抓取' : rightFist ? '右手握拳排斥' : '团簇待命';
    this.renderer?.setState({
      repulsing: rightFist,
      grabbing: leftPinch,
      repulsorTarget,
      grabberTarget,
    });
  }

  private getHandBySide(hands: TrackedHand[], side: 'left' | 'right'): TrackedHand | null {
    return hands.find((hand) => hand.handedness === side) ?? null;
  }

  private getHandWorldTarget(hand: TrackedHand): THREE.Vector3 | null {
    const palm = hand.landmarks[9];
    return this.renderer?.projectToWorld(palm.x, palm.y) ?? null;
  }

  private isFist(hand: TrackedHand): boolean {
    const landmarks = hand.landmarks;
    const fingers = [
      this.isFingerExtended(landmarks, [5, 6, 7]),
      this.isFingerExtended(landmarks, [9, 10, 11]),
      this.isFingerExtended(landmarks, [13, 14, 15]),
      this.isFingerExtended(landmarks, [17, 18, 19]),
    ];
    return fingers.filter(Boolean).length <= 1;
  }

  private isPinching(hand: TrackedHand): boolean {
    const thumb = hand.landmarks[4];
    const index = hand.landmarks[8];
    return Math.hypot(thumb.x - index.x, thumb.y - index.y, thumb.z - index.z) < 0.065;
  }

  private isFingerExtended(
    landmarks: TrackedHand['landmarks'],
    indices: [number, number, number]
  ): boolean {
    const [aIndex, bIndex, cIndex] = indices;
    const a = landmarks[aIndex];
    const b = landmarks[bIndex];
    const c = landmarks[cIndex];
    const ab = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    const cb = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
    const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
    const abLength = Math.hypot(ab.x, ab.y, ab.z);
    const cbLength = Math.hypot(cb.x, cb.y, cb.z);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot / Math.max(0.0001, abLength * cbLength))));
    return angle > 2.55;
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
    this.statusItems.get('mode')!.textContent = this.modeLabel;
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
    if (!(error instanceof Error)) return '排斥球运行时出错，请刷新页面后重试。';
    if (error instanceof DOMException && error.name === 'NotAllowedError') return '摄像头权限被拒绝。请在浏览器地址栏允许摄像头访问。';
    if (error.message.includes('Device in use') || error.message.includes('Could not start video source')) {
      return '摄像头被其他程序占用。请关闭会议软件、相机或其它摄像头页面后重试。';
    }
    return error.message.length > 180 ? `${error.message.slice(0, 180)}...` : error.message;
  }
}
