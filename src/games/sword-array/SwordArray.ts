import * as THREE from 'three';
import { HandTracker } from '../../core/HandTracker';
import type { HandFrame, LabStatus, TrackedHand } from '../../core/types';
import { SwordArrayRenderer, type SwordMode } from './SwordArrayRenderer';

interface SwordArrayOptions {
  onBack: () => void;
}

interface GestureState {
  confirmed: SwordMode;
  pending: SwordMode;
  pendingSince: number;
}

const DETECTION_INTERVAL_MS = 40;

export class SwordArray {
  private readonly mount: HTMLElement;
  private readonly options: SwordArrayOptions;
  private readonly handTracker = new HandTracker();

  private layout: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private renderer: SwordArrayRenderer | null = null;
  private statusItems = new Map<string, HTMLElement>();
  private startPauseButton: HTMLButtonElement | null = null;
  private animationFrameId: number | null = null;
  private running = false;
  private isStarting = false;
  private disposed = false;
  private lastTimestamp = 0;
  private lastDetectionTimestamp = 0;
  private frameCounter = 0;
  private fps = 0;
  private lastFpsTimestamp = 0;
  private lastHandCount = 0;
  private hasTrackingTarget = false;
  private gesture: GestureState = {
    confirmed: 'LOTUS',
    pending: 'LOTUS',
    pendingSince: 0,
  };

  constructor(mount: HTMLElement, options: SwordArrayOptions) {
    this.mount = mount;
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.running || this.isStarting) return;
    this.isStarting = true;

    if (!this.layout) {
      this.render();
      this.attachRenderer();
    }

    this.running = true;
    this.updateControls();
    this.startLoop();

    this.setStatus({
      cameraStatus: this.handTracker.camera.getStatus(),
      trackerStatus: this.handTracker.getTrackerStatus(),
      handCount: 0,
      fps: this.fps,
      running: true,
      message: '正在唤醒飞剑阵与手势识别...',
    });

    try {
      await this.handTracker.initialize();
      if (!this.disposed) this.setStatusMessage('手势识别已启动。');
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? '摄像头权限被拒绝。请在浏览器地址栏允许摄像头访问。'
          : error instanceof DOMException && error.name === 'NotReadableError'
            ? '摄像头被其他程序占用。请关闭会议软件、相机或其它摄像头页面后重试。'
            : this.formatRuntimeError(error);

      this.setStatus({
        cameraStatus: this.handTracker.camera.getStatus(),
        trackerStatus: this.handTracker.getTrackerStatus(),
        handCount: 0,
        fps: this.fps,
        running: this.running,
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
    this.renderer?.setState({
      mode: 'LOTUS',
      isTracking: false,
      target: null,
    });
    this.updateControls();
    this.setStatusMessage('已暂停。点击启动继续控制剑阵。');
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
    this.mount.innerHTML = '';
  }

  private render(): void {
    this.mount.classList.add('sword-array-shell');
    this.mount.innerHTML = `
      <div class="game-view sword-array">
        <header class="game-topbar">
          <div>
            <p class="eyebrow">Gesture Formation Demo</p>
            <h1>Sword Array</h1>
          </div>
          <div class="topbar-actions">
            <button class="secondary-button" type="button" data-action="back">返回首页</button>
            <button class="primary-button" type="button" data-action="toggle">启动识别</button>
          </div>
        </header>

        <section class="game-layout sword-array-layout">
          <div class="canvas-stage sword-stage">
            <div class="stage-badge sword-badge">
              <span class="live-dot"></span>
              Qingzhu sword formation
            </div>
          </div>

          <aside class="status-panel" aria-label="剑阵状态面板">
            <div class="panel-heading">
              <p class="eyebrow">Formation</p>
              <h2>剑阵状态</h2>
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
                <span>当前阵型</span>
                <strong data-status="mode">莲花现世</strong>
              </div>
              <div class="status-row">
                <span>检测手数</span>
                <strong data-status="hands">0</strong>
              </div>
              <div class="status-row">
                <span>FPS</span>
                <strong data-status="fps">0</strong>
              </div>
            </div>

            <div class="instruction-panel">
              <h3>手势说明</h3>
              <ul>
                <li>剑指 / 食指伸出：游龙随行</li>
                <li>张开手掌：莲花现世</li>
                <li>握拳：剑盾护体</li>
                <li>食指 + 小指：大庚剑阵</li>
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
    this.stage = this.mount.querySelector<HTMLElement>('.sword-stage');
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

    for (const key of ['camera', 'tracker', 'mode', 'hands', 'fps', 'message']) {
      const element = this.mount.querySelector<HTMLElement>(`[data-status="${key}"]`);
      if (element) this.statusItems.set(key, element);
    }
  }

  private attachRenderer(): void {
    if (!this.stage) throw new Error('Sword WebGL stage was not created.');
    this.renderer = new SwordArrayRenderer(this.stage);
    this.renderer.mount();
  }

  private startLoop(): void {
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.lastTimestamp = 0;
    this.lastDetectionTimestamp = 0;
    this.frameCounter = 0;
    this.lastFpsTimestamp = 0;
    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  private loop = (timestamp: number): void => {
    if (!this.running || this.disposed) return;

    const deltaSeconds =
      this.lastTimestamp > 0 ? Math.min((timestamp - this.lastTimestamp) / 1000, 0.08) : 0.016;
    this.lastTimestamp = timestamp;
    this.updateFps(timestamp);

    try {
      if (this.handTracker.getTrackerStatus() === 'ready') {
        let frame = this.handTracker.getLastFrame();
        if (
          this.lastDetectionTimestamp === 0 ||
          timestamp - this.lastDetectionTimestamp >= DETECTION_INTERVAL_MS
        ) {
          frame = this.handTracker.detect(timestamp);
          this.lastDetectionTimestamp = timestamp;
        }
        this.processFrame(frame, timestamp);
      } else {
        this.lastHandCount = 0;
        this.hasTrackingTarget = false;
        this.renderer?.setState({
          mode: 'LOTUS',
          isTracking: false,
          target: null,
        });
      }
    } catch (error) {
      this.hasTrackingTarget = false;
      this.setStatusMessage(this.formatRuntimeError(error));
    }

    this.renderer?.render(deltaSeconds);
    this.updateStatusPanel();
    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  private processFrame(frame: HandFrame | null, timestamp: number): void {
    this.lastHandCount = frame?.hands.length ?? 0;

    if (!frame || frame.hands.length === 0) {
      this.hasTrackingTarget = false;
      this.renderer?.setState({
        mode: 'LOTUS',
        isTracking: false,
        target: null,
      });
      return;
    }

    const hand = frame.hands[0];
    const detectedMode = this.detectGesture(hand);
    this.updateConfirmedGesture(detectedMode, timestamp);

    const target = this.getGestureTarget(hand, this.gesture.confirmed);
    this.hasTrackingTarget = true;
    this.renderer?.setState({
      mode: this.gesture.confirmed,
      isTracking: true,
      target,
    });
  }

  private detectGesture(hand: TrackedHand): SwordMode {
    const landmarks = hand.landmarks;
    const thumb = this.isFingerExtended(landmarks, [1, 2, 3]);
    const index = this.isFingerExtended(landmarks, [5, 6, 7]);
    const middle = this.isFingerExtended(landmarks, [9, 10, 11]);
    const ring = this.isFingerExtended(landmarks, [13, 14, 15]);
    const pinky = this.isFingerExtended(landmarks, [17, 18, 19]);
    const extendedCount = [thumb, index, middle, ring, pinky].filter(Boolean).length;

    if (index && pinky && !middle && !ring) return 'DAGENG';
    if (extendedCount <= 1) return 'SHIELD';
    if (index && !ring && !pinky) return 'DRAGON';
    if (index && middle && !ring && !pinky) return 'DRAGON';
    if (index && middle && ring && pinky) return 'LOTUS';
    return this.gesture.confirmed;
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

  private updateConfirmedGesture(mode: SwordMode, timestamp: number): void {
    if (mode !== this.gesture.pending) {
      this.gesture.pending = mode;
      this.gesture.pendingSince = timestamp;
      return;
    }

    if (mode !== this.gesture.confirmed && timestamp - this.gesture.pendingSince > 180) {
      this.gesture.confirmed = mode;
    }
  }

  private getGestureTarget(hand: TrackedHand, mode: SwordMode): THREE.Vector3 {
    const point =
      mode === 'DRAGON' || mode === 'DAGENG'
        ? hand.landmarks[8]
        : {
            x: (hand.landmarks[0].x + hand.landmarks[9].x) / 2,
            y: (hand.landmarks[0].y + hand.landmarks[9].y) / 2,
          };

    return this.renderer?.normalizedToWorld(point.x, point.y) ?? new THREE.Vector3(0, 0, 0);
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

  private updateStatusPanel(): void {
    this.setStatus({
      cameraStatus: this.handTracker.camera.getStatus(),
      trackerStatus: this.handTracker.getTrackerStatus(),
      handCount: this.lastHandCount,
      fps: this.fps,
      running: this.running,
      message:
        this.hasTrackingTarget && this.handTracker.getTrackerStatus() === 'ready'
          ? `${this.modeLabel(this.gesture.confirmed)} 已响应手势。`
          : this.handTracker.getTrackerStatus() === 'ready'
            ? '没有检测到手，剑阵保持待机莲花阵。'
            : '飞剑阵正在运行，等待摄像头和手势模型。',
    });
  }

  private setStatus(status: LabStatus): void {
    this.statusItems.get('camera')!.textContent = this.formatCameraStatus(status.cameraStatus);
    this.statusItems.get('tracker')!.textContent = this.formatTrackerStatus(status.trackerStatus);
    this.statusItems.get('hands')!.textContent = `${status.handCount}`;
    this.statusItems.get('fps')!.textContent = `${status.fps}`;
    this.statusItems.get('mode')!.textContent = this.modeLabel(this.gesture.confirmed);
    this.statusItems.get('message')!.textContent = status.message;
  }

  private setStatusMessage(message: string): void {
    const item = this.statusItems.get('message');
    if (item) item.textContent = message;
  }

  private updateControls(): void {
    if (!this.startPauseButton) return;
    this.startPauseButton.disabled = this.isStarting;
    this.startPauseButton.textContent = this.isStarting
      ? '启动中...'
      : this.running
        ? '暂停'
        : '启动识别';
  }

  private modeLabel(mode: SwordMode): string {
    const labels: Record<SwordMode, string> = {
      DRAGON: '游龙随行',
      LOTUS: '莲花现世',
      SHIELD: '剑盾护体',
      DAGENG: '大庚剑阵',
    };
    return labels[mode];
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
    if (!(error instanceof Error)) return '剑阵识别运行时出错，请刷新页面后重试。';
    const message = error.message;
    if (message.includes('Packet timestamp mismatch')) {
      return '手势识别时间戳异常。请点击“启动识别”重试；如果反复出现，请刷新页面。';
    }
    if (message.includes('Could not start video source') || message.includes('Device in use')) {
      return '摄像头被其他程序占用。请关闭会议软件、相机或其它摄像头页面后重试。';
    }
    return message.length > 180 ? `${message.slice(0, 180)}...` : message;
  }
}
