import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export type CameraStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'error';
export type TrackerStatus = 'idle' | 'loading' | 'ready' | 'error';
export type Handedness = 'left' | 'right' | 'unknown';

export interface Point2D {
  x: number;
  y: number;
}

export interface TrackedHand {
  landmarks: NormalizedLandmark[];
  handedness: Handedness;
}

export interface HandFrame {
  hands: TrackedHand[];
  timestamp: number;
}

export interface LabStatus {
  cameraStatus: CameraStatus;
  trackerStatus: TrackerStatus;
  handCount: number;
  fps: number;
  running: boolean;
  message: string;
}

