export class TrailCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private devicePixelRatio = 1;

  constructor(className = 'visual-canvas') {
    this.canvas = document.createElement('canvas');
    this.canvas.className = className;

    const context = this.canvas.getContext('2d', {
      alpha: true,
    });

    if (!context) {
      throw new Error('无法创建 2D Canvas 渲染上下文。');
    }

    this.ctx = context;
  }

  resize(width: number, height: number): void {
    this.devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(width * this.devicePixelRatio));
    this.canvas.height = Math.max(1, Math.floor(height * this.devicePixelRatio));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);
  }

  width(): number {
    return this.canvas.width / this.devicePixelRatio;
  }

  height(): number {
    return this.canvas.height / this.devicePixelRatio;
  }

  fade(alpha = 0.16): void {
    const width = this.width();
    const height = this.height();
    const gradient = this.ctx.createRadialGradient(
      width * 0.5,
      height * 0.45,
      0,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.75
    );

    gradient.addColorStop(0, `rgba(6, 12, 24, ${alpha * 0.55})`);
    gradient.addColorStop(0.55, `rgba(3, 7, 16, ${alpha})`);
    gradient.addColorStop(1, `rgba(0, 2, 8, ${Math.min(0.38, alpha + 0.08)})`);

    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width(), this.height());
  }
}

