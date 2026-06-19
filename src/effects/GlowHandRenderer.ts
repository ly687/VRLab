import type { HandFrame, TrackedHand } from '../core/types';

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

export const FINGER_TIP_INDICES = [4, 8, 12, 16, 20] as const;

export class GlowHandRenderer {
  update(_deltaSeconds: number): void {
    // Kept as a lifecycle hook so renderers can add subtle motion later.
  }

  drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';

    const gradient = ctx.createRadialGradient(
      width * 0.5,
      height * 0.46,
      0,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.72
    );
    gradient.addColorStop(0, 'rgba(16, 45, 64, 0.16)');
    gradient.addColorStop(0.48, 'rgba(6, 17, 30, 0.18)');
    gradient.addColorStop(1, 'rgba(1, 4, 10, 0.28)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.restore();
  }

  drawIdle(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    const centerX = width * 0.5;
    const centerY = height * 0.5;

    const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 190);
    core.addColorStop(0, 'rgba(84, 230, 255, 0.08)');
    core.addColorStop(0.32, 'rgba(73, 124, 255, 0.035)');
    core.addColorStop(1, 'rgba(73, 124, 255, 0)');

    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 190, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(112, 236, 255, 0.24)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([10, 12]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, 76, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.font = '600 14px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(224, 250, 255, 0.76)';
    ctx.fillText('等待手部进入识别区域', centerX, centerY + 126);
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(143, 177, 198, 0.72)';
    ctx.fillText('摄像头画面已隐藏，仅显示抽象手势视觉', centerX, centerY + 150);
    ctx.restore();
  }

  drawHands(ctx: CanvasRenderingContext2D, frame: HandFrame, width: number, height: number): void {
    for (let handIndex = 0; handIndex < frame.hands.length; handIndex++) {
      const hand = frame.hands[handIndex];
      const accentHue = handIndex === 0 ? 188 : 266;
      this.drawEnergyPalm(ctx, hand, width, height, accentHue);
      this.drawSkeleton(ctx, hand, width, height, accentHue);
    }
  }

  private drawSkeleton(
    ctx: CanvasRenderingContext2D,
    hand: TrackedHand,
    width: number,
    height: number,
    hue: number
  ): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = 8;
    ctx.shadowColor = `hsl(${hue}, 100%, 62%)`;

    for (const [from, to] of HAND_CONNECTIONS) {
      const a = this.toCanvasPoint(hand.landmarks[from], width, height);
      const b = this.toCanvasPoint(hand.landmarks[to], width, height);
      const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      gradient.addColorStop(0, `hsla(${hue}, 86%, 70%, 0.48)`);
      gradient.addColorStop(1, `hsla(${hue + 30}, 84%, 64%, 0.34)`);

      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(238, 252, 255, 0.36)';
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (let index = 0; index < hand.landmarks.length; index++) {
      const point = this.toCanvasPoint(hand.landmarks[index], width, height);
      const isTip = FINGER_TIP_INDICES.includes(index as (typeof FINGER_TIP_INDICES)[number]);
      ctx.fillStyle = isTip ? `hsla(${hue + 18}, 86%, 72%, 0.72)` : 'rgba(238, 253, 255, 0.52)';
      ctx.beginPath();
      ctx.arc(point.x, point.y, isTip ? 3.6 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawEnergyPalm(
    ctx: CanvasRenderingContext2D,
    hand: TrackedHand,
    width: number,
    height: number,
    hue: number
  ): void {
    const palmIndices = [0, 5, 9, 13, 17];
    const palm = palmIndices.map((index) => this.toCanvasPoint(hand.landmarks[index], width, height));
    const center = palm.reduce(
      (sum, point) => ({ x: sum.x + point.x / palm.length, y: sum.y + point.y / palm.length }),
      { x: 0, y: 0 }
    );

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const aura = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, 82);
    aura.addColorStop(0, `hsla(${hue}, 86%, 68%, 0.08)`);
    aura.addColorStop(0.38, `hsla(${hue + 30}, 82%, 48%, 0.035)`);
    aura.addColorStop(1, `hsla(${hue}, 100%, 50%, 0)`);

    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(center.x, center.y, 92, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `hsla(${hue}, 88%, 70%, 0.18)`;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let index = 0; index < palm.length; index++) {
      const point = palm[index];
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  private toCanvasPoint(
    landmark: { x: number; y: number },
    width: number,
    height: number
  ): { x: number; y: number } {
    return {
      x: (1 - landmark.x) * width,
      y: landmark.y * height,
    };
  }
}
