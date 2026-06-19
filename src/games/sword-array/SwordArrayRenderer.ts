import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type SwordMode = 'DRAGON' | 'LOTUS' | 'SHIELD' | 'DAGENG';

interface RendererState {
  mode: SwordMode;
  isTracking: boolean;
  target: THREE.Vector3 | null;
}

const IS_MOBILE =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
  window.innerWidth < 768;

const CONFIG = {
  swordCount: IS_MOBILE ? 300 : 500,
  pathHistoryLength: 300,
  maxSpeed: 25,
  sprintSpeed: 50,
  steerForce: 28,
  separationDist: 3,
  separationForce: 10,
  noiseScale: 0.3,
  noiseStrength: 1,
  shieldRadius: 18,
  shieldOrbitSpeed: 2.5,
  lotusRadius: 24,
  lotusRotateSpeed: 2.5,
  dagengRadius: 30,
  dagengHeight: 20,
  dagengRotateSpeed: 0.2,
};

const simplex = {
  noise3D: (x: number, y: number, z: number) =>
    Math.sin(x * 1.2 + y * 0.8) *
    Math.cos(y * 1.1 + z * 0.9) *
    Math.sin(z * 0.7 + x * 1.3),
};

const circleVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const circleFragmentShader = `
varying vec2 vUv;
uniform float uTime;
uniform float uOpacity;

void main() {
  vec2 center = vec2(0.5, 0.5);
  float dist = distance(vUv, center);
  float ring1 = smoothstep(0.48, 0.485, dist) - smoothstep(0.49, 0.495, dist);
  float ring2 = smoothstep(0.42, 0.425, dist) - smoothstep(0.43, 0.435, dist);
  float angle = atan(vUv.y - 0.5, vUv.x - 0.5);
  float runes = sin(angle * 10.0 + uTime) * 0.5 + 0.5;
  float runeRing = smoothstep(0.35, 0.45, dist) * runes * smoothstep(0.45, 0.35, dist);
  vec3 color = vec3(1.0, 0.9, 0.4);
  float alpha = (ring1 + ring2 + runeRing * 0.3) * uOpacity;
  gl_FragColor = vec4(color, alpha);
}
`;

export class SwordArrayRenderer {
  readonly element: HTMLCanvasElement;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 240);
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly clock = new THREE.Clock();
  private readonly dummy = new THREE.Object3D();
  private readonly positions: THREE.Vector3[] = [];
  private readonly velocities: THREE.Vector3[] = [];
  private readonly pathHistory: THREE.Vector3[] = [];
  private readonly targetPosition = new THREE.Vector3(0, 0, 0);
  private readonly smoothTarget = new THREE.Vector3(0, 0, 0);
  private readonly smoothCamPos = new THREE.Vector3(0, 5, 35);
  private readonly smoothLookAt = new THREE.Vector3(0, 0, 0);

  private swordMesh: THREE.InstancedMesh | null = null;
  private auraMesh: THREE.InstancedMesh | null = null;
  private starField: THREE.Points | null = null;
  private spiritParticles: THREE.Points | null = null;
  private lightning: THREE.LineSegments | null = null;
  private magicCircle: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;
  private shieldBarrier: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private state: RendererState = {
    mode: 'LOTUS',
    isTracking: false,
    target: null,
  };
  private smoothZoom = 30;
  private magicOpacity = 0;
  private magicScale = 0;
  private lightningIntensity = 0;
  private transitionPulse = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x010a08, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.element = this.renderer.domElement;
    this.element.className = 'sword-webgl-canvas';

    this.scene.background = new THREE.Color(0x010a08);
    this.scene.fog = new THREE.FogExp2(0x010a08, 0.015);
    this.camera.position.set(0, 5, 35);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.5, 0.4, 0.6);
    this.composer.addPass(this.bloomPass);

    this.createScene();
    this.resetPath(new THREE.Vector3(0, 0, 0));
  }

  mount(): void {
    this.container.prepend(this.element);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.render(1 / 60);
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.renderer.dispose();
    this.composer.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) {
          material.forEach((item) => item.dispose());
        } else {
          material.dispose();
        }
      }
    });
    this.element.remove();
  }

  setState(nextState: RendererState): void {
    if (nextState.mode !== this.state.mode && nextState.isTracking) {
      this.transitionPulse = 1;
    }

    this.state = nextState;

    if (nextState.target) {
      this.targetPosition.lerp(nextState.target, 0.38);
      if (nextState.mode === 'DRAGON') {
        this.updatePath(this.targetPosition);
      }
      return;
    }

    this.targetPosition.lerp(new THREE.Vector3(0, 0, 0), 0.04);
    this.extendPath();
  }

  normalizedToWorld(x: number, y: number): THREE.Vector3 {
    const rect = this.element.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 9;
    return new THREE.Vector3((0.5 - x) * 32 * aspect, (0.5 - y) * 24, 0);
  }

  render(deltaSeconds = this.clock.getDelta()): void {
    const time = this.clock.elapsedTime;
    this.transitionPulse = Math.max(0, this.transitionPulse - deltaSeconds * 1.8);
    this.updateSwarm(time, Math.min(deltaSeconds, 1 / 30));
    this.updateStarField(time);
    this.updateSpiritParticles(time);
    this.updateLightning(time);
    this.updateMagicCircle(time);
    this.updateShieldBarrier(time);
    this.updateCamera(time);
    this.bloomPass.strength = 1.35 + this.transitionPulse * 2.2 + this.lightningIntensity * 0.35;
    this.composer.render();
  }

  private createScene(): void {
    this.scene.add(new THREE.AmbientLight(0x6aa8ff, 0.35));
    const keyLight = new THREE.DirectionalLight(0xd8fff0, 2.4);
    keyLight.position.set(12, 18, 20);
    this.scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xffdd66, 1.2);
    rimLight.position.set(-18, 10, -8);
    this.scene.add(rimLight);
    this.createStarField();
    this.createSpiritParticles();
    this.createSwordSwarm();
    this.createLightning();
    this.createMagicCircle();
    this.createShieldBarrier();
  }

  private createSwordSwarm(): void {
    const bladeGeo = new THREE.ConeGeometry(0.12, 2.5, 4);
    bladeGeo.scale(0.4, 1, 1);
    bladeGeo.rotateX(Math.PI / 2);
    bladeGeo.translate(0, 0, 1);

    const guardGeo = new THREE.BoxGeometry(0.5, 0.08, 0.15);
    guardGeo.translate(0, 0, -0.2);

    const handleGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.7, 6);
    handleGeo.rotateX(Math.PI / 2);
    handleGeo.translate(0, 0, -0.6);

    const geometry = mergeGeometries([bladeGeo, guardGeo, handleGeo]) ?? bladeGeo;
    const material = new THREE.MeshPhysicalMaterial({
      color: 0x001108,
      emissive: 0x1bff9a,
      emissiveIntensity: 2.5,
      metalness: 1,
      roughness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    });

    const auraGeometry = new THREE.ConeGeometry(0.15, 2.6, 4);
    auraGeometry.scale(0.5, 1, 1);
    auraGeometry.rotateX(Math.PI / 2);
    auraGeometry.translate(0, 0, 1);
    const auraMaterial = new THREE.MeshBasicMaterial({
      color: 0xffea77,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.swordMesh = new THREE.InstancedMesh(geometry, material, CONFIG.swordCount);
    this.auraMesh = new THREE.InstancedMesh(auraGeometry, auraMaterial, CONFIG.swordCount);
    this.swordMesh.frustumCulled = false;
    this.auraMesh.frustumCulled = false;
    this.scene.add(this.swordMesh, this.auraMesh);

    for (let index = 0; index < CONFIG.swordCount; index++) {
      this.positions.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 15,
          (Math.random() - 0.5) * 10 - 5
        )
      );
      this.velocities.push(new THREE.Vector3());
    }
  }

  private createStarField(): void {
    const count = 2000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let index = 0; index < count; index++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 80 + Math.random() * 40;
      const brightness = 0.5 + Math.random() * 0.5;
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[index * 3 + 2] = radius * Math.cos(phi);
      colors[index * 3] = brightness;
      colors[index * 3 + 1] = brightness;
      colors[index * 3 + 2] = brightness + Math.random() * 0.2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.3,
      vertexColors: true,
      transparent: true,
      opacity: 0.64,
      sizeAttenuation: true,
    });
    this.starField = new THREE.Points(geometry, material);
    this.scene.add(this.starField);
  }

  private createSpiritParticles(): void {
    const count = 200;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) {
      positions[index * 3] = (Math.random() - 0.5) * 60;
      positions[index * 3 + 1] = (Math.random() - 0.5) * 40;
      positions[index * 3 + 2] = (Math.random() - 0.5) * 40;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      size: 0.15,
      color: 0x88ffaa,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.spiritParticles = new THREE.Points(geometry, material);
    this.scene.add(this.spiritParticles);
  }

  private createLightning(): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(100 * 3 * 2), 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xffdd44,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lightning = new THREE.LineSegments(geometry, material);
    this.lightning.visible = false;
    this.scene.add(this.lightning);
  }

  private createShieldBarrier(): void {
    const geometry = new THREE.SphereGeometry(CONFIG.shieldRadius * 0.95, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0x1bff9a,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      wireframe: true,
    });
    this.shieldBarrier = new THREE.Mesh(geometry, material);
    this.shieldBarrier.scale.setScalar(0.001);
    this.shieldBarrier.visible = false;
    this.scene.add(this.shieldBarrier);
  }

  private createMagicCircle(): void {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader: circleVertexShader,
      fragmentShader: circleFragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
      },
    });
    this.magicCircle = new THREE.Mesh(geometry, material);
    this.magicCircle.rotation.x = -Math.PI / 2;
    this.magicCircle.scale.set(40, 40, 1);
    this.magicCircle.visible = false;
    this.scene.add(this.magicCircle);
  }

  private updateSwarm(time: number, delta: number): void {
    if (!this.swordMesh || !this.auraMesh) return;

    const currentTarget = this.state.isTracking ? this.targetPosition : new THREE.Vector3(0, 0, 0);
    const mode = this.state.isTracking ? this.state.mode : 'LOTUS';

    for (let index = 0; index < CONFIG.swordCount; index++) {
      const position = this.positions[index];
      const velocity = this.velocities[index];
      const target = this.getSwordTarget(index, mode, currentTarget, time, position);
      this.integrateSword(index, position, velocity, target, mode, delta, time);
    }

    this.swordMesh.instanceMatrix.needsUpdate = true;
    this.auraMesh.instanceMatrix.needsUpdate = true;
  }

  private getSwordTarget(
    index: number,
    mode: SwordMode,
    currentTarget: THREE.Vector3,
    time: number,
    currentPosition: THREE.Vector3
  ): THREE.Vector3 {
    const target = new THREE.Vector3();

    if (mode === 'SHIELD') {
      const phi = Math.acos(1 - (2 * (index + 0.5)) / CONFIG.swordCount);
      const theta = Math.PI * (1 + Math.sqrt(5)) * index;
      const orbitX =
        CONFIG.shieldRadius * Math.sin(phi) * Math.cos(theta + time * CONFIG.shieldOrbitSpeed);
      const orbitY =
        CONFIG.shieldRadius * Math.sin(phi) * Math.sin(theta + time * CONFIG.shieldOrbitSpeed);
      const orbitZ = CONFIG.shieldRadius * Math.cos(phi);
      const rotatedX = orbitX * Math.cos(time * 0.3) - orbitZ * Math.sin(time * 0.3);
      const rotatedZ = orbitX * Math.sin(time * 0.3) + orbitZ * Math.cos(time * 0.3);
      target.set(currentTarget.x + rotatedX, currentTarget.y + orbitY, currentTarget.z + rotatedZ);
      target.x += Math.sin(time * 3 + index) * 0.2;
      target.y += Math.cos(time * 3 + index * 0.7) * 0.2;
      return target;
    }

    if (mode === 'LOTUS') {
      if (index === 0) {
        target.set(currentTarget.x, currentTarget.y, currentTarget.z);
        return target;
      }

      const petalCount = 8;
      const petalIndex = index % petalCount;
      const baseAngle = (petalIndex / petalCount) * Math.PI * 2;
      const spread = Math.min(1, Math.floor(index / petalCount) / (CONFIG.swordCount / petalCount));
      const radius = 3 + spread * CONFIG.lotusRadius;
      const theta = baseAngle + spread * 1.5 + time * CONFIG.lotusRotateSpeed;
      const height = currentTarget.y + Math.pow(spread, 1.5) * 6 - 2;
      const breathe = 1 + Math.sin(time * 3 + spread * 2) * 0.05;
      target.set(
        currentTarget.x + radius * breathe * Math.cos(theta),
        height,
        currentTarget.z + radius * breathe * Math.sin(theta)
      );
      return target;
    }

    if (mode === 'DAGENG') {
      if (index === 0) {
        const dropHeight = 5 + this.transitionPulse * 35;
        target.set(currentTarget.x, currentTarget.y + dropHeight, currentTarget.z);
        return target;
      }

      const effectiveIndex = index - 1;
      const layerCount = 10;
      const perLayer = Math.max(1, Math.floor((CONFIG.swordCount - 1) / layerCount));
      const layerIndex = Math.floor(effectiveIndex / perLayer);
      const indexInLayer = effectiveIndex % perLayer;
      const radius = CONFIG.dagengRadius + layerIndex * 1.5 + 2;
      const direction = layerIndex % 2 === 0 ? 1 : -1;
      const theta =
        (indexInLayer / perLayer) * Math.PI * 2 + time * CONFIG.dagengRotateSpeed * direction;
      const hRandom = Math.sin(effectiveIndex * 13.1) * 0.5 + 0.5;
      const height = currentTarget.y - 10 + (hRandom - 0.5) * CONFIG.dagengHeight;
      target.set(currentTarget.x + Math.cos(theta) * radius, height, currentTarget.z + Math.sin(theta) * radius);
      return target;
    }

    if (index < 5) {
      target.copy(currentTarget);
      target.x += Math.sin(time * 8 + index) * 0.3;
      target.y += Math.cos(time * 8 + index) * 0.3;
      return target;
    }

    const pathIndex = index * 0.8;
    const indexA = Math.min(Math.floor(pathIndex), this.pathHistory.length - 1);
    const indexB = Math.min(indexA + 1, this.pathHistory.length - 1);
    const alpha = pathIndex - Math.floor(pathIndex);

    if (this.pathHistory[indexA] && this.pathHistory[indexB]) {
      target.lerpVectors(this.pathHistory[indexA], this.pathHistory[indexB], alpha);
    } else {
      target.copy(currentTarget);
    }

    target.x += Math.sin(time * 10 + index * 0.5) * 0.2;
    target.y += Math.cos(time * 10 + index * 0.5) * 0.2;
    const noiseAmount = CONFIG.noiseStrength * (0.8 + Math.sin(time * 2 + index * 0.05) * 0.4);
    target.x += simplex.noise3D(currentPosition.x * CONFIG.noiseScale, currentPosition.y * CONFIG.noiseScale, time) * noiseAmount;
    target.y += simplex.noise3D(currentPosition.y * CONFIG.noiseScale, currentPosition.z * CONFIG.noiseScale, time + 100) * noiseAmount;
    target.z += simplex.noise3D(currentPosition.z * CONFIG.noiseScale, currentPosition.x * CONFIG.noiseScale, time + 200) * noiseAmount;
    return target;
  }

  private integrateSword(
    index: number,
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    target: THREE.Vector3,
    mode: SwordMode,
    delta: number,
    time: number
  ): void {
    if (!this.swordMesh || !this.auraMesh) return;

    let speed = mode === 'SHIELD' ? CONFIG.sprintSpeed : CONFIG.maxSpeed;
    if (target.distanceTo(position) > 4) speed = CONFIG.sprintSpeed;
    else if (target.distanceTo(position) < 1) speed = target.distanceTo(position) * CONFIG.maxSpeed;

    const desired = target.sub(position);
    const distance = desired.length();
    if (distance > 0) {
      desired.normalize();
      desired.multiplyScalar(distance < 10 ? speed * (distance / 10) : speed);
    }

    const steer = desired.sub(velocity);
    const steerFactor = mode === 'SHIELD' || mode === 'LOTUS' ? 3 : 1;
    steer.clampLength(0, CONFIG.steerForce * delta * steerFactor);
    velocity.add(steer);

    if (index > 0 && mode !== 'SHIELD' && (mode !== 'LOTUS' || !this.state.isTracking)) {
      const previous = this.positions[index - 1];
      const diff = position.clone().sub(previous);
      const separationDistance = diff.length();
      if (separationDistance < CONFIG.separationDist && separationDistance > 0.01) {
        diff.normalize().multiplyScalar(CONFIG.separationForce * delta);
        velocity.add(diff);
      }
    }

    position.add(velocity.clone().multiplyScalar(delta));
    this.dummy.position.copy(position);

    if (mode === 'SHIELD' && this.state.isTracking) {
      const lookTarget =
        velocity.length() > 0.1
          ? position.clone().add(velocity.clone().normalize())
          : position.clone().add(new THREE.Vector3(-position.z, 0, position.x).normalize());
      this.dummy.lookAt(lookTarget);
    } else if (mode === 'LOTUS') {
      const lotusDirection = position.clone().sub(this.targetPosition);
      if (lotusDirection.lengthSq() < 0.001) lotusDirection.set(0, 1, 0);
      this.dummy.lookAt(position.clone().add(lotusDirection.normalize()));
    } else if (mode === 'DAGENG' && this.state.isTracking) {
      this.dummy.lookAt(position.clone().add(new THREE.Vector3(0, -1, 0)));
    } else {
      this.dummy.lookAt(position.clone().add(velocity.length() > 0.1 ? velocity : new THREE.Vector3(0, 0, -1)));
    }

    let targetScale = 1;
    if (mode === 'DRAGON') {
      targetScale = index === 0 ? 3.8 : index < 5 ? 2.2 : Math.max(0.24, 1.08 - index / CONFIG.swordCount);
    } else if (mode === 'DAGENG' && this.state.isTracking) {
      targetScale = index === 0 ? 7.4 : 1.18;
    } else if (mode === 'LOTUS') {
      targetScale = index === 0 ? 3 : 1;
    }
    this.dummy.scale.setScalar(targetScale);
    this.dummy.updateMatrix();
    this.swordMesh.setMatrixAt(index, this.dummy.matrix);

    const isAuraActive =
      mode === 'SHIELD' ? Math.sin(time * 30 + index * 0.5) > 0 : Math.sin(time * 20 + index * 0.7) > 0.3;
    if (!isAuraActive && !(index === 0 && mode === 'DAGENG')) {
      this.dummy.scale.set(0, 0, 0);
    } else {
      this.dummy.scale.setScalar(targetScale * (isAuraActive ? 1.3 : 1));
    }
    this.dummy.updateMatrix();
    this.auraMesh.setMatrixAt(index, this.dummy.matrix);
  }

  private updateLightning(time: number): void {
    if (!this.lightning) return;
    const targetIntensity = this.state.mode === 'DAGENG' && this.state.isTracking ? 1 : 0;
    this.lightningIntensity = THREE.MathUtils.lerp(this.lightningIntensity, targetIntensity, 0.02);
    const intensity = this.lightningIntensity;
    const flash = Math.sin(time * (15 + intensity * 10)) > 0.7 - intensity * 0.3;
    this.lightning.visible = flash && this.state.isTracking && intensity > 0.03;
    if (!this.lightning.visible) return;

    const positionAttribute = this.lightning.geometry.attributes.position;
    const array = positionAttribute.array as Float32Array;
    const count = Math.floor(30 + intensity * 70);
    const maxDistance = 5 + intensity * 20;
    const jitter = 0.2 + intensity * 0.3;
    let cursor = 0;

    for (let index = 0; index < count; index++) {
      const a = Math.random() > 0.2 ? 0 : Math.floor(Math.random() * CONFIG.swordCount);
      const b = Math.floor(Math.random() * CONFIG.swordCount);
      const pointA = this.positions[a];
      const pointB = this.positions[b];
      if (!pointA || !pointB || pointA.distanceTo(pointB) >= maxDistance) continue;

      array[cursor++] = pointA.x + (Math.random() - 0.5) * jitter;
      array[cursor++] = pointA.y + (Math.random() - 0.5) * jitter;
      array[cursor++] = pointA.z + (Math.random() - 0.5) * jitter;
      array[cursor++] = pointB.x + (Math.random() - 0.5) * jitter;
      array[cursor++] = pointB.y + (Math.random() - 0.5) * jitter;
      array[cursor++] = pointB.z + (Math.random() - 0.5) * jitter;
    }

    while (cursor < array.length) array[cursor++] = 0;
    positionAttribute.needsUpdate = true;
  }

  private updateMagicCircle(time: number): void {
    if (!this.magicCircle) return;
    const targetOpacity = this.state.mode === 'DAGENG' && this.state.isTracking ? 1 : 0;
    const targetScale = targetOpacity > 0 ? 1 : 0.18;
    this.magicOpacity = THREE.MathUtils.lerp(this.magicOpacity, targetOpacity, 0.05);
    this.magicScale = THREE.MathUtils.lerp(this.magicScale, targetScale, 0.08);
    this.magicCircle.material.uniforms.uTime.value = time;
    this.magicCircle.material.uniforms.uOpacity.value = this.magicOpacity;
    this.magicCircle.rotation.z = time * 0.18 + this.transitionPulse * 0.6;
    const scale = 40 * this.magicScale;
    this.magicCircle.scale.set(scale, scale, 1);
    this.magicCircle.visible = this.magicOpacity > 0.01;
    if (this.magicCircle.visible) {
      this.magicCircle.position.set(this.targetPosition.x, this.targetPosition.y + 15, this.targetPosition.z);
    }
  }

  private updateShieldBarrier(time: number): void {
    if (!this.shieldBarrier) return;
    const targetScale = this.state.mode === 'SHIELD' && this.state.isTracking ? 1 : 0.001;
    const nextScale = THREE.MathUtils.lerp(this.shieldBarrier.scale.x, targetScale, 0.1);
    this.shieldBarrier.scale.setScalar(nextScale);
    this.shieldBarrier.visible = nextScale > 0.01;
    this.shieldBarrier.position.copy(this.smoothTarget);
    this.shieldBarrier.rotation.y = time * 0.5;
    this.shieldBarrier.rotation.x = time * 0.18;
  }

  private updateCamera(time: number): void {
    let formationSize = 10;
    const formationCenter = new THREE.Vector3(0, 0, 0);

    if (this.positions.length > 0) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const position of this.positions) {
        minX = Math.min(minX, position.x);
        maxX = Math.max(maxX, position.x);
        minY = Math.min(minY, position.y);
        maxY = Math.max(maxY, position.y);
        formationCenter.add(position);
      }
      formationCenter.divideScalar(this.positions.length);
      formationSize = Math.max(maxX - minX, maxY - minY);
    }

    const modeZoomOffset: Record<SwordMode, number> = {
      LOTUS: 16,
      DRAGON: 10,
      SHIELD: 13,
      DAGENG: 19,
    };
    const targetZoom = THREE.MathUtils.clamp(
      formationSize * 1.05 + modeZoomOffset[this.state.mode],
      this.state.mode === 'DRAGON' ? 18 : 22,
      this.state.mode === 'DAGENG' ? 58 : 66
    );
    this.smoothZoom = THREE.MathUtils.lerp(this.smoothZoom, targetZoom, 0.02);

    const followPoint = this.state.isTracking
      ? formationCenter
      : new THREE.Vector3(Math.sin(time * 0.5) * 6, Math.cos(time * 0.4) * 4, 0);
    this.smoothTarget.lerp(followPoint, 0.02);

    const cameraTarget = new THREE.Vector3(
      this.smoothTarget.x * 0.25 + Math.sin(time * 0.42) * 0.35,
      this.smoothTarget.y * 0.15 + 3.2 + Math.cos(time * 0.36) * 0.28,
      this.smoothZoom + Math.sin(time * 0.24) * 0.45
    );
    if (this.state.mode === 'DAGENG' && this.state.isTracking) {
      const shake = this.lightningIntensity * 0.08;
      cameraTarget.x += Math.sin(time * 38) * shake;
      cameraTarget.y += Math.cos(time * 34) * shake;
    }
    this.smoothCamPos.lerp(cameraTarget, 0.02);
    this.camera.position.copy(this.smoothCamPos);

    const lookAtTarget = new THREE.Vector3(
      this.smoothTarget.x * 0.4,
      this.smoothTarget.y * 0.25 + (this.state.mode === 'LOTUS' ? -1.2 : 0),
      this.state.mode === 'DRAGON' ? 1.5 : 4
    );
    this.smoothLookAt.lerp(lookAtTarget, 0.02);
    this.camera.lookAt(this.smoothLookAt);
  }

  private updateStarField(time: number): void {
    if (this.starField) this.starField.rotation.y = time * 0.01;
  }

  private updateSpiritParticles(time: number): void {
    if (!this.spiritParticles) return;
    const positions = this.spiritParticles.geometry.attributes.position.array as Float32Array;
    for (let index = 0; index < positions.length / 3; index++) {
      positions[index * 3 + 1] += Math.sin(time + index) * 0.01;
      if (positions[index * 3 + 1] > 20) positions[index * 3 + 1] = -20;
    }
    this.spiritParticles.geometry.attributes.position.needsUpdate = true;
  }

  private updatePath(position: THREE.Vector3): void {
    const first = this.pathHistory[0];
    if (!first || first.distanceTo(position) > 0.1) {
      this.pathHistory.pop();
      this.pathHistory.unshift(position.clone());
    }
  }

  private extendPath(): void {
    const first = this.pathHistory[0];
    const second = this.pathHistory[1];
    if (!first || !second) return;
    const direction = first.clone().sub(second);
    if (direction.length() < 0.01) return;
    this.pathHistory.pop();
    this.pathHistory.unshift(first.clone().add(direction.normalize().multiplyScalar(0.3)));
  }

  private resetPath(position: THREE.Vector3): void {
    this.pathHistory.length = 0;
    for (let index = 0; index < CONFIG.pathHistoryLength; index++) {
      this.pathHistory.push(position.clone());
    }
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
