import * as THREE from 'three';
import type { SlashSegment } from './SwordTrail';

export interface ScreenSlashSegment {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  speed: number;
}

interface Crystal {
  mesh: THREE.Mesh;
  radius: number;
  baseY: number;
  spin: THREE.Vector3;
  respawnTimer: number;
  destroyed: boolean;
}

interface Fragment {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface SparkBurst {
  points: THREE.Points;
  positions: Float32Array;
  velocities: THREE.Vector3[];
  life: number;
  maxLife: number;
}

const CRYSTAL_COUNT = 5;
const SLASH_SPEED_THRESHOLD = 2.6;
const SEGMENT_AB = new THREE.Vector3();
const SEGMENT_AC = new THREE.Vector3();
const SEGMENT_CLOSEST = new THREE.Vector3();
const SCREEN_CENTER = new THREE.Vector3();
const SCREEN_EDGE = new THREE.Vector3();

export class CrystalManager {
  private readonly crystals: Crystal[] = [];
  private readonly fragments: Fragment[] = [];
  private readonly bursts: SparkBurst[] = [];
  private readonly crystalGeometries: THREE.BufferGeometry[] = [
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.OctahedronGeometry(1, 1),
    new THREE.DodecahedronGeometry(1, 0),
  ];
  private readonly fragmentGeometry = new THREE.TetrahedronGeometry(1, 0);
  private readonly sparkMaterial = new THREE.PointsMaterial({
    color: 0x7beeff,
    size: 0.065,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  private readonly crystalMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    emissive: 0x0a2540,
    emissiveIntensity: 0.8,
    metalness: 0.9,
    roughness: 0.05,
    transmission: 0.95,
    thickness: 2.0,
    ior: 1.8,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });
  private readonly wireframeMaterial = new THREE.LineBasicMaterial({
    color: 0x7beeff,
    transparent: true,
    opacity: 0.46,
    blending: THREE.AdditiveBlending,
  });
  private readonly tempCenter = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene) {
    for (let index = 0; index < CRYSTAL_COUNT; index++) {
      this.crystals.push(this.createCrystal(index));
    }
  }

  update(delta: number, time: number): void {
    for (let index = 0; index < this.crystals.length; index++) {
      const crystal = this.crystals[index];
      if (crystal.destroyed) {
        crystal.respawnTimer -= delta;
        if (crystal.respawnTimer <= 0) this.respawnCrystal(crystal, index);
        continue;
      }

      crystal.mesh.position.y = crystal.baseY + Math.sin(time * 0.7 + index * 1.7) * 0.24;
      crystal.mesh.rotation.x += crystal.spin.x * delta;
      crystal.mesh.rotation.y += crystal.spin.y * delta;
      crystal.mesh.rotation.z += crystal.spin.z * delta;
    }

    this.updateFragments(delta);
    this.updateBursts(delta);
  }

  checkSlash(segment: SlashSegment | null): number {
    if (!segment || segment.speed < SLASH_SPEED_THRESHOLD) return 0;

    let hits = 0;
    for (const crystal of this.crystals) {
      if (crystal.destroyed) continue;
      this.tempCenter.copy(crystal.mesh.position);
      if (segmentIntersectsSphere(segment.start, segment.end, this.tempCenter, crystal.radius)) {
        this.shatter(crystal, segment);
        hits++;
      }
    }
    return hits;
  }

  checkScreenSlash(segment: ScreenSlashSegment | null, camera: THREE.Camera): number {
    if (!segment || segment.speed < 0.42) return 0;

    let hits = 0;
    for (const crystal of this.crystals) {
      if (crystal.destroyed) continue;

      SCREEN_CENTER.copy(crystal.mesh.position).project(camera);
      if (SCREEN_CENTER.z < -1 || SCREEN_CENTER.z > 1) continue;

      const centerX = (SCREEN_CENTER.x + 1) * 0.5;
      const centerY = (1 - SCREEN_CENTER.y) * 0.5;
      SCREEN_EDGE.copy(crystal.mesh.position).add(new THREE.Vector3(crystal.radius, 0, 0)).project(camera);
      const edgeX = (SCREEN_EDGE.x + 1) * 0.5;
      const radius = Math.max(0.055, Math.abs(edgeX - centerX) * 1.65);

      if (screenSegmentIntersectsCircle(segment, centerX, centerY, radius)) {
        const directionX = segment.endX - segment.startX;
        const directionY = segment.endY - segment.startY;
        const length = Math.max(0.0001, Math.hypot(directionX, directionY));
        const slashSegment: SlashSegment = {
          start: crystal.mesh.position.clone().add(new THREE.Vector3(-directionX / length, directionY / length, 0).multiplyScalar(0.35)),
          end: crystal.mesh.position.clone().add(new THREE.Vector3(directionX / length, -directionY / length, 0).multiplyScalar(0.35)),
          speed: segment.speed * 8,
        };
        this.shatter(crystal, slashSegment);
        hits++;
      }
    }
    return hits;
  }

  dispose(): void {
    for (const crystal of this.crystals) {
      this.scene.remove(crystal.mesh);
      for (const child of crystal.mesh.children) {
        if (child instanceof THREE.LineSegments) {
          child.geometry.dispose();
        }
      }
      crystal.mesh.geometry.dispose();
      const material = crystal.mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    }
    for (const fragment of this.fragments) {
      this.scene.remove(fragment.mesh);
      fragment.mesh.geometry.dispose();
      const material = fragment.mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    }
    for (const burst of this.bursts) {
      this.scene.remove(burst.points);
      burst.points.geometry.dispose();
    }
    this.crystalMaterial.dispose();
    this.wireframeMaterial.dispose();
    this.sparkMaterial.dispose();
    this.fragmentGeometry.dispose();
    this.crystalGeometries.forEach((geometry) => geometry.dispose());
  }

  private createCrystal(index: number): Crystal {
    const geometry = this.crystalGeometries[index % this.crystalGeometries.length].clone();
    const mesh = new THREE.Mesh(geometry, this.crystalMaterial.clone());
    const edges = new THREE.EdgesGeometry(geometry);
    const wireframe = new THREE.LineSegments(edges, this.wireframeMaterial);
    mesh.add(wireframe);
    const radius = 0.44 + Math.random() * 0.22;
    mesh.scale.setScalar(radius);
    this.scene.add(mesh);

    const crystal: Crystal = {
      mesh,
      radius: radius * 1.75,
      baseY: 0,
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        0.32 + Math.random() * 0.42,
        (Math.random() - 0.5) * 0.44
      ),
      respawnTimer: 0,
      destroyed: false,
    };
    this.respawnCrystal(crystal, index);
    return crystal;
  }

  private respawnCrystal(crystal: Crystal, index: number): void {
    const lane = index - (CRYSTAL_COUNT - 1) / 2;
    crystal.destroyed = false;
    crystal.respawnTimer = 0;
    crystal.baseY = -0.75 + Math.random() * 2.2;
    crystal.mesh.visible = true;
    crystal.mesh.position.set(lane * 1.35 + (Math.random() - 0.5) * 0.55, crystal.baseY, -0.5 + Math.random() * 0.7);
    crystal.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  }

  private shatter(crystal: Crystal, segment: SlashSegment): void {
    crystal.destroyed = true;
    crystal.respawnTimer = 2.1 + Math.random() * 1.2;
    crystal.mesh.visible = false;

    const center = crystal.mesh.position.clone();
    const slashDirection = segment.end.clone().sub(segment.start).normalize();
    const fragmentCount = 14 + Math.floor(Math.random() * 9);

    for (let index = 0; index < fragmentCount; index++) {
      const material = new THREE.MeshBasicMaterial({
        color: index % 3 === 0 ? 0xffffff : 0x7beeff,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.fragmentGeometry.clone(), material);
      const scale = 0.035 + Math.random() * 0.08;
      mesh.scale.setScalar(scale);
      mesh.position.copy(center);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.scene.add(mesh);

      const scatter = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).normalize();
      scatter.addScaledVector(slashDirection, 0.65).normalize();
      const baseSpeed = 4.0 + Math.random() * 5.0;
      this.fragments.push({
        mesh,
        velocity: scatter.multiplyScalar(baseSpeed),
        spin: new THREE.Vector3(Math.random() * 15, Math.random() * 15, Math.random() * 15),
        life: 0,
        maxLife: 0.4 + Math.random() * 0.3,
      });
    }

    this.createSparkBurst(center, segment.speed);
  }

  private createSparkBurst(center: THREE.Vector3, speed: number): void {
    const count = 34;
    const positions = new Float32Array(count * 3);
    const velocities = Array.from({ length: count }, () => {
      const velocity = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).normalize();
      return velocity.multiplyScalar(1.2 + Math.random() * Math.min(4.2, speed * 0.18));
    });
    for (let index = 0; index < count; index++) {
      const offset = index * 3;
      positions[offset] = center.x;
      positions[offset + 1] = center.y;
      positions[offset + 2] = center.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, this.sparkMaterial.clone());
    this.scene.add(points);
    this.bursts.push({ points, positions, velocities, life: 0, maxLife: 0.62 });
  }

  private updateFragments(delta: number): void {
    for (let index = this.fragments.length - 1; index >= 0; index--) {
      const fragment = this.fragments[index];
      fragment.life += delta;
      fragment.mesh.position.addScaledVector(fragment.velocity, delta);
      fragment.mesh.rotation.x += fragment.spin.x * delta;
      fragment.mesh.rotation.y += fragment.spin.y * delta;
      fragment.mesh.rotation.z += fragment.spin.z * delta;
      fragment.velocity.multiplyScalar(0.985);
      const material = fragment.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = Math.max(0, 0.72 * (1 - fragment.life / fragment.maxLife));
      if (fragment.life >= fragment.maxLife) {
        this.scene.remove(fragment.mesh);
        fragment.mesh.geometry.dispose();
        material.dispose();
        this.fragments.splice(index, 1);
      }
    }
  }

  private updateBursts(delta: number): void {
    for (let burstIndex = this.bursts.length - 1; burstIndex >= 0; burstIndex--) {
      const burst = this.bursts[burstIndex];
      burst.life += delta;
      for (let index = 0; index < burst.velocities.length; index++) {
        const offset = index * 3;
        const velocity = burst.velocities[index];
        burst.positions[offset] += velocity.x * delta;
        burst.positions[offset + 1] += velocity.y * delta;
        burst.positions[offset + 2] += velocity.z * delta;
        velocity.multiplyScalar(0.97);
      }
      (burst.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      const material = burst.points.material as THREE.PointsMaterial;
      material.opacity = Math.max(0, 0.9 * (1 - burst.life / burst.maxLife));
      if (burst.life >= burst.maxLife) {
        this.scene.remove(burst.points);
        burst.points.geometry.dispose();
        material.dispose();
        this.bursts.splice(burstIndex, 1);
      }
    }
  }
}

export function segmentIntersectsSphere(
  a: THREE.Vector3,
  b: THREE.Vector3,
  center: THREE.Vector3,
  radius: number
): boolean {
  SEGMENT_AB.copy(b).sub(a);
  SEGMENT_AC.copy(center).sub(a);
  const abLengthSq = Math.max(0.00001, SEGMENT_AB.lengthSq());
  const t = THREE.MathUtils.clamp(SEGMENT_AC.dot(SEGMENT_AB) / abLengthSq, 0, 1);
  SEGMENT_CLOSEST.copy(a).addScaledVector(SEGMENT_AB, t);
  return SEGMENT_CLOSEST.distanceTo(center) <= radius;
}

function screenSegmentIntersectsCircle(
  segment: ScreenSlashSegment,
  centerX: number,
  centerY: number,
  radius: number
): boolean {
  const abX = segment.endX - segment.startX;
  const abY = segment.endY - segment.startY;
  const acX = centerX - segment.startX;
  const acY = centerY - segment.startY;
  const abLengthSq = Math.max(0.000001, abX * abX + abY * abY);
  const t = THREE.MathUtils.clamp((acX * abX + acY * abY) / abLengthSq, 0, 1);
  const closestX = segment.startX + abX * t;
  const closestY = segment.startY + abY * t;
  return Math.hypot(closestX - centerX, closestY - centerY) <= radius;
}
