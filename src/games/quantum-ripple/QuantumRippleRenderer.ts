import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface QuantumHandInput {
  x: number;
  z: number;
  active: boolean;
}

export interface QuantumRippleStats {
  caught: number;
  missed: number;
  activeAnomalies: number;
}

interface Anomaly {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  velocity: number;
  active: boolean;
}

interface BurstShard {
  mesh: THREE.Mesh<THREE.TetrahedronGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
}

const IS_MOBILE = window.innerWidth < 768;
const GRID_SIZE = IS_MOBILE ? 46 : 64;
const TILE_COUNT = GRID_SIZE * GRID_SIZE;
const HEX_RADIUS = 0.65;
const HEX_HEIGHT = 0.6;
const GAP = 0.12;
const HEX_SPACING_X = HEX_RADIUS * Math.sqrt(3) + GAP;
const HEX_SPACING_Z = HEX_RADIUS * 1.5 + GAP;
const FIELD_HALF_X = (GRID_SIZE * HEX_SPACING_X) / 2;
const FIELD_HALF_Z = (GRID_SIZE * HEX_SPACING_Z) / 2;
const MAX_HAND_HEIGHT = 4;
const ANOMALY_COUNT = IS_MOBILE ? 3 : 5;

export class QuantumRippleRenderer {
  readonly element: HTMLCanvasElement;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46, 1, 0.1, 140);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly handTargets: QuantumHandInput[] = [];
  private readonly smoothHands = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 0),
  ];
  private readonly smoothHandActive = [0, 0];
  private readonly anomalyGeometry = new THREE.SphereGeometry(0.34, 24, 16);
  private readonly anomalyMaterial = new THREE.MeshStandardMaterial({
    color: 0xff2a55,
    emissive: 0xff1748,
    emissiveIntensity: 2.8,
    metalness: 0.2,
    roughness: 0.18,
  });
  private readonly shardGeometry = new THREE.TetrahedronGeometry(0.12, 0);
  private readonly shardMaterial = new THREE.MeshBasicMaterial({
    color: 0xff3b64,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly anomalies: Anomaly[] = [];
  private readonly burstShards: BurstShard[] = [];
  private readonly rippleOrigin = new THREE.Vector3(0, 0, 0);
  private readonly tempColor = new THREE.Color();
  private readonly baseX = new Float32Array(TILE_COUNT);
  private readonly baseZ = new Float32Array(TILE_COUNT);
  private readonly baseRotation = new Float32Array(TILE_COUNT);
  private readonly tempObject = new THREE.Object3D();
  private readonly tempVector = new THREE.Vector3();
  private readonly handMarkers: THREE.Mesh[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private gridMesh: THREE.InstancedMesh | null = null;
  private stars: THREE.Points | null = null;
  private spawnTimer = 0;
  private rippleAge = 99;
  private flashSpike = 0;
  private alarmSpike = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x02050a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.element = this.renderer.domElement;
    this.element.className = 'quantum-ripple-canvas';

    this.scene.background = new THREE.Color(0x02060c);
    this.scene.fog = new THREE.FogExp2(0x02060c, 0.015);
    this.camera.position.set(0, 18, 32);
    this.camera.lookAt(0, 0, 0);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.42, 0.42);
    this.composer.addPass(this.bloomPass);

    this.createScene();
  }

  mount(): void {
    this.container.prepend(this.element);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.render(0.016, 0);
  }

  setHands(hands: QuantumHandInput[]): void {
    this.handTargets.length = 0;
    this.handTargets.push(...hands.slice(0, 2));
  }

  triggerRipple(x: number, z: number): void {
    this.rippleOrigin.set(x, 0, z);
    this.rippleAge = 0;
    this.flashSpike = Math.max(this.flashSpike, 0.55);
  }

  render(deltaSeconds: number, time: number): QuantumRippleStats {
    const delta = Math.min(deltaSeconds, 0.04);
    this.updateHands(delta);
    this.updateHexField(time);
    const stats = this.updateAnomalies(delta, time);
    this.updateBurstShards(delta);
    this.updateSceneMotion(time);

    this.rippleAge += delta;
    this.flashSpike = THREE.MathUtils.lerp(this.flashSpike, 0, delta * 7);
    this.alarmSpike = THREE.MathUtils.lerp(this.alarmSpike, 0, delta * 5);
    this.bloomPass.strength = 0.62 + this.flashSpike + this.alarmSpike * 0.28;
    this.composer.render();
    return stats;
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.composer.dispose();
    this.renderer.dispose();
    this.anomalyGeometry.dispose();
    this.anomalyMaterial.dispose();
    this.shardGeometry.dispose();
    this.shardMaterial.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.InstancedMesh) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
      }
    });
    this.element.remove();
  }

  private createScene(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    this.scene.add(new THREE.HemisphereLight(0x00ffcc, 0x02060c, 0.8));

    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(20, 40, 20);
    this.scene.add(key);

    const cyanRim = new THREE.PointLight(0x00ffcc, 5.5, 42);
    cyanRim.position.set(-14, 10, -10);
    this.scene.add(cyanRim);

    const violetRim = new THREE.PointLight(0xb829ff, 3.6, 24);
    violetRim.position.set(8, 5, 4);
    this.scene.add(violetRim);

    this.createHexField();
    this.createStars();
    this.createHandMarkers();
  }

  private createHandMarkers(): void {
    const geometry = new THREE.SphereGeometry(0.5, 16, 16);
    const colors = [0x00ffcc, 0xb829ff];
    for (let index = 0; index < 2; index++) {
      const material = new THREE.MeshBasicMaterial({
        color: colors[index],
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const marker = new THREE.Mesh(geometry, material);
      marker.visible = false;
      this.scene.add(marker);
      this.handMarkers.push(marker);
    }
  }

  private createHexField(): void {
    const geometry = new THREE.CylinderGeometry(HEX_RADIUS, HEX_RADIUS, HEX_HEIGHT, 6, 1, false);
    geometry.translate(0, HEX_HEIGHT / 2, 0);
    geometry.rotateY(Math.PI / 6);

    const material = new THREE.MeshStandardMaterial({
      color: 0x166b96,
      emissive: 0x052035,
      metalness: 0.5,
      roughness: 0.25,
    });

    this.gridMesh = new THREE.InstancedMesh(geometry, material, TILE_COUNT);
    this.gridMesh.frustumCulled = false;
    this.scene.add(this.gridMesh);

    let cursor = 0;
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const x = (col - GRID_SIZE / 2) * HEX_SPACING_X + (row % 2) * HEX_SPACING_X * 0.5;
        const z = (row - GRID_SIZE / 2) * HEX_SPACING_Z;
        const rotation = (row + col) % 2 === 0 ? 0 : Math.PI / 6;
        this.baseX[cursor] = x;
        this.baseZ[cursor] = z;
        this.baseRotation[cursor] = rotation;
        this.tempObject.position.set(x, -2, z);
        this.tempObject.rotation.y = rotation;
        this.tempObject.updateMatrix();
        this.gridMesh.setMatrixAt(cursor, this.tempObject.matrix);

        const colorMix = Math.random() * 0.08;
        this.tempColor.setRGB(0.08 + colorMix, 0.3 + colorMix, 0.4 + colorMix);
        this.gridMesh.setColorAt(cursor, this.tempColor);
        cursor++;
      }
    }

    this.gridMesh.instanceMatrix.needsUpdate = true;
    if (this.gridMesh.instanceColor) this.gridMesh.instanceColor.needsUpdate = true;
  }

  private createStars(): void {
    const count = IS_MOBILE ? 900 : 1600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const cyan = new THREE.Color(0x00ffcc);
    const violet = new THREE.Color(0xb829ff);
    const white = new THREE.Color(0xffffff);

    for (let index = 0; index < count; index++) {
      const offset = index * 3;
      positions[offset] = (Math.random() - 0.5) * 54;
      positions[offset + 1] = 3 + Math.random() * 34;
      positions[offset + 2] = (Math.random() - 0.5) * 42;
      this.tempColor.copy(index % 8 === 0 ? violet : index % 5 === 0 ? white : cyan);
      this.tempColor.multiplyScalar(0.2 + Math.random() * 0.6);
      colors[offset] = this.tempColor.r;
      colors[offset + 1] = this.tempColor.g;
      colors[offset + 2] = this.tempColor.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.035,
      vertexColors: true,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(geometry, material);
    this.scene.add(this.stars);
  }

  private updateHands(delta: number): void {
    for (let index = 0; index < 2; index++) {
      const target = this.handTargets[index];
      const activeTarget = target?.active ? 1 : 0;
      if (target) {
        this.tempVector.set(target.x, 0, target.z);
        this.smoothHands[index].lerp(this.tempVector, target.active ? 0.18 : 0.05);
      }
      this.smoothHandActive[index] = THREE.MathUtils.lerp(this.smoothHandActive[index], activeTarget, delta * 8);
    }
  }

  private updateHexField(time: number): void {
    if (!this.gridMesh) return;

    const baseColor = new THREE.Color(0x166b96);
    const cyanColor = new THREE.Color(0x00ffcc);
    const violetColor = new THREE.Color(0xb829ff);
    const voidColor = new THREE.Color(0x02060c);

    for (let index = 0; index < TILE_COUNT; index++) {
      const x = this.baseX[index];
      const z = this.baseZ[index];
      const elevation = this.terrainHeightAt(x, z, time);
      const positiveElevation = Math.max(0, elevation);
      const rippleMix = this.rippleAge < 4 ? this.getRippleAmountAt(x, z) : 0;
      const scaleY = 1 + positiveElevation * 1.5;

      this.tempObject.position.set(x, -2, z);
      this.tempObject.rotation.set(0, this.baseRotation[index], 0);
      this.tempObject.scale.set(1, scaleY, 1);
      this.tempObject.updateMatrix();
      this.gridMesh.setMatrixAt(index, this.tempObject.matrix);

      const glow = THREE.MathUtils.clamp(positiveElevation / MAX_HAND_HEIGHT, 0, 1);
      this.tempColor.copy(baseColor).lerp(cyanColor, glow);
      if (rippleMix > 0.02) this.tempColor.lerp(violetColor, Math.min(0.55, rippleMix * 0.45));
      const distFromCenter = Math.hypot(x, z);
      const maxDist = (GRID_SIZE * HEX_SPACING_X) / 2;
      const fade = THREE.MathUtils.clamp((distFromCenter - maxDist * 0.5) / (maxDist * 0.35), 0, 1);
      this.tempColor.lerp(voidColor, fade);
      this.gridMesh.setColorAt(index, this.tempColor);
    }

    this.gridMesh.instanceMatrix.needsUpdate = true;
    if (this.gridMesh.instanceColor) this.gridMesh.instanceColor.needsUpdate = true;
    this.updateHandMarkers();
  }

  private updateHandMarkers(): void {
    for (let index = 0; index < this.handMarkers.length; index++) {
      const marker = this.handMarkers[index];
      const active = this.smoothHandActive[index] > 0.08;
      marker.visible = active;
      if (!active) continue;
      const hand = this.smoothHands[index];
      const height = this.terrainHeightAt(hand.x, hand.z, performance.now() * 0.001);
      marker.position.set(hand.x, -2 + height * 1.5 * HEX_HEIGHT + 0.5, hand.z);
      marker.scale.setScalar(1 + Math.sin(performance.now() * 0.008) * 0.15);
      const material = marker.material;
      if (!Array.isArray(material)) {
        material.opacity = 0.8 * this.smoothHandActive[index];
      }
    }
  }

  private updateAnomalies(delta: number, time: number): QuantumRippleStats {
    this.spawnTimer -= delta;
    if (this.spawnTimer <= 0 && this.anomalies.filter((item) => item.active).length < ANOMALY_COUNT) {
      this.spawnAnomaly();
      this.spawnTimer = 2.2 + Math.random() * 1.8;
    }

    let caught = 0;
    let missed = 0;
    for (const anomaly of this.anomalies) {
      if (!anomaly.active) continue;
      anomaly.velocity += delta * 0.42;
      anomaly.mesh.position.y -= anomaly.velocity * delta;
      anomaly.mesh.rotation.x += delta * 1.7;
      anomaly.mesh.rotation.y += delta * 2.2;
      const pulse = 1 + Math.sin(time * 8 + anomaly.mesh.position.x) * 0.08;
      anomaly.mesh.scale.setScalar(pulse);

      const terrainHeight = this.terrainHeightAt(anomaly.mesh.position.x, anomaly.mesh.position.z, time);
      if (anomaly.mesh.position.y <= terrainHeight + 0.38 && terrainHeight > 0.62) {
        caught++;
        anomaly.active = false;
        anomaly.mesh.visible = false;
        this.triggerRipple(anomaly.mesh.position.x, anomaly.mesh.position.z);
        this.spawnBurst(anomaly.mesh.position);
      } else if (anomaly.mesh.position.y < -1.4) {
        missed++;
        anomaly.active = false;
        anomaly.mesh.visible = false;
        this.alarmSpike = 1;
      }
    }

    return {
      caught,
      missed,
      activeAnomalies: this.anomalies.filter((item) => item.active).length,
    };
  }

  private spawnAnomaly(): void {
    let anomaly = this.anomalies.find((item) => !item.active);
    if (!anomaly) {
      const mesh = new THREE.Mesh(this.anomalyGeometry, this.anomalyMaterial);
      this.scene.add(mesh);
      anomaly = {
        mesh,
        velocity: 1,
        active: false,
      };
      this.anomalies.push(anomaly);
    }

    anomaly.active = true;
    anomaly.velocity = 1.4 + Math.random() * 0.7;
    anomaly.mesh.visible = true;
    anomaly.mesh.position.set(
      (Math.random() - 0.5) * FIELD_HALF_X * 1.25,
      8.4 + Math.random() * 3.5,
      (Math.random() - 0.5) * FIELD_HALF_Z * 1.35
    );
  }

  private spawnBurst(origin: THREE.Vector3): void {
    for (let index = 0; index < 18; index++) {
      const mesh = new THREE.Mesh(this.shardGeometry, this.shardMaterial);
      mesh.position.copy(origin);
      mesh.scale.setScalar(0.75 + Math.random() * 1.1);
      this.scene.add(mesh);
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        1.5 + Math.random() * 4,
        (Math.random() - 0.5) * 5
      );
      this.burstShards.push({
        mesh,
        velocity,
        spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        life: 0,
        maxLife: 0.55 + Math.random() * 0.35,
      });
    }
  }

  private updateBurstShards(delta: number): void {
    for (let index = this.burstShards.length - 1; index >= 0; index--) {
      const shard = this.burstShards[index];
      shard.life += delta;
      shard.velocity.y -= delta * 3.2;
      shard.mesh.position.addScaledVector(shard.velocity, delta);
      shard.mesh.rotation.x += shard.spin.x * delta;
      shard.mesh.rotation.y += shard.spin.y * delta;
      shard.mesh.rotation.z += shard.spin.z * delta;
      const alpha = 1 - shard.life / shard.maxLife;
      shard.mesh.scale.setScalar(Math.max(0.01, alpha));
      if (shard.life >= shard.maxLife) {
        this.scene.remove(shard.mesh);
        this.burstShards.splice(index, 1);
      }
    }
  }

  private terrainHeightAt(x: number, z: number, time: number): number {
    let height = Math.sin(x * 0.4 + time * 0.8) * 0.15 + Math.cos(z * 0.4 - time * 0.6) * 0.15;
    for (let index = 0; index < 2; index++) {
      const active = this.smoothHandActive[index];
      if (active <= 0.01) continue;
      const hand = this.smoothHands[index];
      const dx = x - hand.x;
      const dz = z - hand.z;
      height += Math.exp(-(dx * dx + dz * dz) * 0.01) * MAX_HAND_HEIGHT * active;
    }

    if (this.rippleAge < 4) {
      height += this.getRippleHeightAt(x, z);
    }
    return height;
  }

  private getRippleAmountAt(x: number, z: number): number {
    const dx = x - this.rippleOrigin.x;
    const dz = z - this.rippleOrigin.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    return THREE.MathUtils.smoothstep(7.5 - Math.abs(dist - this.rippleAge * 7.5), 0, 7.5);
  }

  private getRippleHeightAt(x: number, z: number): number {
    const dx = x - this.rippleOrigin.x;
    const dz = z - this.rippleOrigin.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const ring = this.getRippleAmountAt(x, z);
    return Math.sin(dist * 1.55 - this.rippleAge * 9.2) * Math.exp(-this.rippleAge * 1.65) * ring * 1.35;
  }

  private updateSceneMotion(time: number): void {
    if (this.stars) {
      this.stars.rotation.y = time * 0.01;
      this.stars.rotation.x = Math.sin(time * 0.15) * 0.02;
    }
    this.camera.position.x = Math.sin(time * 0.18) * 0.18;
    this.camera.position.y = 18 + Math.sin(time * 0.2) * 0.18;
    this.camera.position.z = 32 + Math.cos(time * 0.16) * 0.22;
    this.camera.lookAt(0, 0, 0);
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
  }
}
