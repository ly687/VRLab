import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { CameraManager } from './CameraManager';
import type { HandFrame, Handedness, TrackerStatus } from './types';

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandTracker {
  readonly camera = new CameraManager();
  private handLandmarker: HandLandmarker | null = null;
  private trackerStatus: TrackerStatus = 'idle';
  private lastVideoTime = -1;
  private lastDetectTimestamp = -1;
  private lastFrame: HandFrame | null = null;
  private initializePromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.trackerStatus === 'ready') {
      return;
    }

    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.trackerStatus = 'loading';
    this.initializePromise = this.initializeInternal();

    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  private async initializeInternal(): Promise<void> {
    try {
      const video = await this.camera.start();
      const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);

      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: HAND_MODEL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });

      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await video.play();
      }

      this.trackerStatus = 'ready';
    } catch (error) {
      this.trackerStatus = 'error';
      throw error;
    }
  }

  detect(timestamp: number): HandFrame | null {
    const video = this.camera.video;

    if (!this.handLandmarker || this.trackerStatus !== 'ready') {
      return null;
    }

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return this.lastFrame;
    }

    if (timestamp <= this.lastDetectTimestamp) {
      return this.lastFrame;
    }

    if (video.currentTime === this.lastVideoTime) {
      return this.lastFrame;
    }

    this.lastVideoTime = video.currentTime;
    const detectTimestamp = Math.max(timestamp, this.lastDetectTimestamp + 1);
    const result = this.handLandmarker.detectForVideo(video, detectTimestamp);
    this.lastDetectTimestamp = detectTimestamp;
    this.lastFrame = this.toHandFrame(result, detectTimestamp);
    return this.lastFrame;
  }

  getTrackerStatus(): TrackerStatus {
    return this.trackerStatus;
  }

  getLastFrame(): HandFrame | null {
    return this.lastFrame;
  }

  dispose(): void {
    this.camera.stop();
    this.handLandmarker?.close();
    this.handLandmarker = null;
    this.trackerStatus = 'idle';
    this.lastFrame = null;
    this.lastVideoTime = -1;
    this.lastDetectTimestamp = -1;
    this.initializePromise = null;
  }

  private toHandFrame(result: HandLandmarkerResult, timestamp: number): HandFrame {
    const hands = result.landmarks.map((landmarks, index) => {
      const category = result.handedness[index]?.[0]?.categoryName?.toLowerCase();
      const handedness: Handedness =
        category === 'left' || category === 'right' ? category : 'unknown';

      return {
        landmarks,
        handedness,
      };
    });

    return {
      hands,
      timestamp,
    };
  }
}
