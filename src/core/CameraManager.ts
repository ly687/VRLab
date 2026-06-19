import type { CameraStatus } from './types';

export class CameraManager {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private status: CameraStatus = 'idle';

  constructor() {
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('aria-hidden', 'true');
    this.video.style.display = 'none';
  }

  getStatus(): CameraStatus {
    return this.status;
  }

  async start(): Promise<HTMLVideoElement> {
    if (this.status === 'ready' && this.stream) {
      return this.video;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this.status = 'error';
      throw new Error('当前浏览器不支持摄像头访问。请使用 Chrome 或 Edge。');
    }

    this.status = 'requesting';

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          facingMode: 'user',
        },
        audio: false,
      });

      this.video.srcObject = this.stream;
      await this.waitForMetadata();
      await this.video.play();
      this.status = 'ready';
      return this.video;
    } catch (error) {
      this.status = this.isPermissionError(error) ? 'denied' : 'error';
      throw error;
    }
  }

  stop(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.video.pause();
    this.video.srcObject = null;
    this.status = 'idle';
  }

  private waitForMetadata(): Promise<void> {
    if (this.video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.video.onloadedmetadata = () => resolve();
      this.video.onerror = () => reject(new Error('摄像头视频流加载失败。'));
    });
  }

  private isPermissionError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'NotAllowedError';
  }
}

