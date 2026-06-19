import * as THREE from 'three';

export interface SlashSegment {
  start: THREE.Vector3;
  end: THREE.Vector3;
  speed: number;
}

const MAX_POINTS = 30;
const MAX_SEGMENTS = MAX_POINTS - 1;
const VERTICES_PER_SEGMENT = 6;

const vertexShader = `
attribute float aAlpha;
varying float vAlpha;

void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
varying float vAlpha;

void main() {
  vec3 core = vec3(0.78, 0.98, 1.0);
  vec3 edge = vec3(0.22, 0.45, 1.0);
  vec3 color = mix(edge, core, smoothstep(0.08, 1.0, vAlpha));
  gl_FragColor = vec4(color, vAlpha);
}
`;

export class SwordTrail {
  readonly mesh: THREE.Mesh;
  readonly tip: THREE.Mesh;

  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  private readonly positions = new Float32Array(MAX_SEGMENTS * VERTICES_PER_SEGMENT * 3);
  private readonly alphas = new Float32Array(MAX_SEGMENTS * VERTICES_PER_SEGMENT);
  private readonly points = Array.from({ length: MAX_POINTS }, () => new THREE.Vector3());
  private readonly smoothedPoint = new THREE.Vector3();
  private readonly prevPoint = new THREE.Vector3();
  private readonly currPoint = new THREE.Vector3();
  private readonly tempDirection = new THREE.Vector3();
  private readonly tempNormal = new THREE.Vector3();
  private pointCount = 0;
  private inactiveFrames = 0;
  private lastSpeed = 0;

  constructor() {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;

    const tipGeometry = new THREE.SphereGeometry(0.12, 18, 18);
    const tipMaterial = new THREE.MeshBasicMaterial({
      color: 0xbafaff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.tip = new THREE.Mesh(tipGeometry, tipMaterial);
    this.tip.frustumCulled = false;
  }

  update(worldPoint: THREE.Vector3 | null, deltaSeconds: number): SlashSegment | null {
    if (!worldPoint) {
      this.fadeInactive();
      this.rebuildGeometry();
      this.updateTip(null);
      return null;
    }

    this.inactiveFrames = 0;

    if (this.pointCount === 0) {
      this.smoothedPoint.copy(worldPoint);
      this.points[0].copy(this.smoothedPoint);
      this.pointCount = 1;
      this.rebuildGeometry();
      this.updateTip(this.smoothedPoint);
      return null;
    }

    this.prevPoint.copy(this.points[this.pointCount - 1]);
    this.smoothedPoint.lerp(worldPoint, 0.42);
    this.currPoint.copy(this.smoothedPoint);
    const distance = this.currPoint.distanceTo(this.prevPoint);
    this.lastSpeed = distance / Math.max(0.001, deltaSeconds);

    if (distance > 0.015) {
      this.pushPoint(this.currPoint);
    } else {
      this.points[this.pointCount - 1].copy(this.currPoint);
    }

    this.rebuildGeometry();
    this.updateTip(this.currPoint);
    return {
      start: this.prevPoint,
      end: this.currPoint,
      speed: this.lastSpeed,
    };
  }

  getIntensity(): number {
    return THREE.MathUtils.clamp(this.lastSpeed / 18, 0, 1);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.tip.geometry.dispose();
    const material = this.tip.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material.dispose();
  }

  private pushPoint(point: THREE.Vector3): void {
    if (this.pointCount < MAX_POINTS) {
      this.points[this.pointCount].copy(point);
      this.pointCount++;
      return;
    }

    for (let index = 0; index < MAX_POINTS - 1; index++) {
      this.points[index].copy(this.points[index + 1]);
    }
    this.points[MAX_POINTS - 1].copy(point);
  }

  private fadeInactive(): void {
    this.inactiveFrames++;
    this.lastSpeed *= 0.9;
    if (this.inactiveFrames % 3 === 0 && this.pointCount > 0) {
      for (let index = 0; index < this.pointCount - 1; index++) {
        this.points[index].copy(this.points[index + 1]);
      }
      this.pointCount--;
    }
  }

  private rebuildGeometry(): void {
    if (this.pointCount < 2) {
      this.geometry.setDrawRange(0, 0);
      return;
    }

    let vertexOffset = 0;
    for (let index = 0; index < this.pointCount - 1; index++) {
      const a = this.points[index];
      const b = this.points[index + 1];
      const t0 = index / Math.max(1, this.pointCount - 1);
      const t1 = (index + 1) / Math.max(1, this.pointCount - 1);
      const alpha0 = Math.pow(t0, 1.35) * 0.72;
      const alpha1 = Math.pow(t1, 1.35);
      const width0 = 0.025 + alpha0 * (0.08 + this.getIntensity() * 0.07);
      const width1 = 0.025 + alpha1 * (0.1 + this.getIntensity() * 0.09);

      this.tempDirection.copy(b).sub(a);
      if (this.tempDirection.lengthSq() < 0.00001) continue;
      this.tempDirection.normalize();
      this.tempNormal.set(-this.tempDirection.y, this.tempDirection.x, 0).normalize();

      const ax1 = a.x + this.tempNormal.x * width0;
      const ay1 = a.y + this.tempNormal.y * width0;
      const ax2 = a.x - this.tempNormal.x * width0;
      const ay2 = a.y - this.tempNormal.y * width0;
      const bx1 = b.x + this.tempNormal.x * width1;
      const by1 = b.y + this.tempNormal.y * width1;
      const bx2 = b.x - this.tempNormal.x * width1;
      const by2 = b.y - this.tempNormal.y * width1;

      vertexOffset = this.writeVertex(vertexOffset, ax1, ay1, a.z, alpha0);
      vertexOffset = this.writeVertex(vertexOffset, ax2, ay2, a.z, alpha0 * 0.82);
      vertexOffset = this.writeVertex(vertexOffset, bx1, by1, b.z, alpha1);
      vertexOffset = this.writeVertex(vertexOffset, bx1, by1, b.z, alpha1);
      vertexOffset = this.writeVertex(vertexOffset, ax2, ay2, a.z, alpha0 * 0.82);
      vertexOffset = this.writeVertex(vertexOffset, bx2, by2, b.z, alpha1 * 0.82);
    }

    this.geometry.setDrawRange(0, vertexOffset);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  private writeVertex(offset: number, x: number, y: number, z: number, alpha: number): number {
    const positionIndex = offset * 3;
    this.positions[positionIndex] = x;
    this.positions[positionIndex + 1] = y;
    this.positions[positionIndex + 2] = z;
    this.alphas[offset] = alpha;
    return offset + 1;
  }

  private updateTip(point: THREE.Vector3 | null): void {
    const material = this.tip.material as THREE.MeshBasicMaterial;
    if (!point || this.pointCount === 0) {
      material.opacity *= 0.84;
      return;
    }

    const intensity = this.getIntensity();
    this.tip.position.copy(point);
    this.tip.scale.setScalar(0.75 + intensity * 1.15);
    material.opacity = 0.38 + intensity * 0.52;
  }
}
