export interface GameDefinition {
  id: string;
  title: string;
  eyebrow: string;
  summary: string;
  status: 'available' | 'coming-soon';
  accent: string;
  gestures: string[];
}

export interface DisposableGame {
  start(): Promise<void> | void;
  pause(): void;
  resume(): Promise<void> | void;
  dispose(): void;
}

