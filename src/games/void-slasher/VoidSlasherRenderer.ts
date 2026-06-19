import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { HandFrame } from '../../core/types';
import { CrystalManager, type ScreenSlashSegment } from './CrystalManager';
import { SwordTrail } from './SwordTrail';

export interface VoidSlasherRenderStats {
  hits: number;
  slashing: boolean;
}

const STAR_COUNT = window.innerWidth < 768 ? 900 : 1600;

export class VoidSlasherRenderer {
  readonly element: HTMLCanvasElement;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 120);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly swordTrail = new SwordTrail();
  private readonly crystalManager = new CrystalManager(this.scene);
  private readonly pointerWorld = new THREE.Vector3();
  private readonly stars: THREE.Points;
  private resizeObserver: ResizeObserver | null = null;
  private flashSpike = 0;

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
    this.element.className = 'void-slasher-canvas';

    this.scene.background = new THREE.Color(0x02050a);
    this.scene.fog = new THREE.FogExp2(0x02050a, 0.055);
    this.camera.position.set(0, 0.45, 8.6);
    this.camera.lookAt(0, 0, 0);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.45, 0.72);
    this.composer.addPass(this.bloomPass);

    this.stars = this.createStars();
    this.createScene();
  }

  mount(): void {
    this.container.prepend(this.element);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.render(0.016, 0, null);
  }

  render(
    deltaSeconds: number,
    time: number,
    frame: HandFrame | null,
    screenSegment: ScreenSlashSegment | null = null
  ): VoidSlasherRenderStats {
    const delta = Math.min(deltaSeconds, 0.033);
    const hand = frame?.hands[0] ?? null;
    const tip = hand?.landmarks[8] ?? null;
    const trailPoint = tip ? this.projectToWorld(tip.x, tip.y, 0.05) : null;
    const segment = this.swordTrail.update(trailPoint, delta);
    const worldHits = this.crystalManager.checkSlash(segment);
    const screenHits = this.crystalManager.checkScreenSlash(screenSegment, this.camera);
    const hits = worldHits + screenHits;
    const slashing = Boolean((segment && segment.speed > 2.6) || (screenSegment && screenSegment.speed > 0.42));
    const intensity = this.swordTrail.getIntensity();
    if (hits > 0) this.triggerFlash();

    this.crystalManager.update(delta, time);
    this.updateSceneMotion(time, intensity);
    this.flashSpike = THREE.MathUtils.lerp(this.flashSpike, 0, delta * 15);
    this.bloomPass.strength = 0.5 + intensity * 0.58 + hits * 0.24 + this.flashSpike;
    this.composer.render();

    return { hits, slashing };
  }

  triggerFlash(): void {
    this.flashSpike = Math.max(this.flashSpike, 2.5);
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.swordTrail.dispose();
    this.crystalManager.dispose();
    this.stars.geometry.dispose();
    const starMaterial = this.stars.material;
    if (Array.isArray(starMaterial)) starMaterial.forEach((material) => material.dispose());
    else starMaterial.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
      }
    });
    this.element.remove();
  }

  private createScene(): void {
    this.scene.add(this.stars);
    this.scene.add(this.swordTrail.mesh);
    this.scene.add(this.swordTrail.tip);

    const ambient = new THREE.HemisphereLight(0x64d8ff, 0x23043f, 0.48);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(3, 4, 6);
    this.scene.add(key);

    const rim = new THREE.PointLight(0x8f7aff, 3.2, 11);
    rim.position.set(-3.2, 1.6, 2.2);
    this.scene.add(rim);
  }

  private createStars(): THREE.Points {
    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    const colorA = new THREE.Color(0x46dcff);
    const colorB = new THREE.Color(0x8f7aff);
    const colorC = new THREE.Color(0xffffff);
    const color = new THREE.Color();

    for (let index = 0; index < STAR_COUNT; index++) {
      const offset = index * 3;
      positions[offset] = (Math.random() - 0.5) * 18;
      positions[offset + 1] = (Math.random() - 0.5) * 10;
      positions[offset + 2] = -2 - Math.random() * 16;
      color.copy(index % 7 === 0 ? colorB : index % 5 === 0 ? colorC : colorA);
      color.multiplyScalar(0.35 + Math.random() * 0.65);
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.024,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(geometry, material);
  }

  private updateSceneMotion(time: number, intensity: number): void {
    this.stars.rotation.y = time * 0.012;
    this.stars.rotation.x = Math.sin(time * 0.16) * 0.025;
    this.camera.position.x = Math.sin(time * 0.18) * 0.05;
    this.camera.position.y = 0.45 + Math.sin(time * 0.22) * 0.04 + intensity * 0.035;
    this.camera.lookAt(0, 0, 0);
  }

  private projectToWorld(x: number, y: number, targetZ: number): THREE.Vector3 {
    const ndc = this.pointerWorld.set(1 - x * 2, -(y * 2) + 1, 0.5);
    ndc.unproject(this.camera);
    const direction = ndc.sub(this.camera.position).normalize();
    const distance = (targetZ - this.camera.position.z) / direction.z;
    return this.pointerWorld.copy(this.camera.position).addScaledVector(direction, distance);
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
