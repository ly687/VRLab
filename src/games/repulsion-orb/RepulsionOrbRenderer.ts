import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

interface Orb {
  home: THREE.Vector3;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  scale: number;
}

interface RepulsionState {
  repulsing: boolean;
  grabbing: boolean;
  repulsorTarget: THREE.Vector3 | null;
  grabberTarget: THREE.Vector3 | null;
}

const IS_MOBILE = window.innerWidth < 768;
const ORB_COUNT = IS_MOBILE ? 140 : 240;

export class RepulsionOrbRenderer {
  readonly element: HTMLCanvasElement;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly dummy = new THREE.Object3D();
  private readonly orbs: Orb[] = [];
  private mesh: THREE.InstancedMesh | null = null;
  private wireMesh: THREE.InstancedMesh | null = null;
  private repulsor: THREE.Mesh | null = null;
  private grabMarker: THREE.Mesh | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private grabbedIndex: number | null = null;
  private state: RepulsionState = {
    repulsing: false,
    grabbing: false,
    repulsorTarget: null,
    grabberTarget: null,
  };

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x040612, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.element = this.renderer.domElement;
    this.element.className = 'repulsion-webgl-canvas';

    this.scene.background = new THREE.Color(0x040612);
    this.scene.fog = new THREE.FogExp2(0x040612, 0.05);
    this.camera.position.set(0, 0, 8);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.22, 0.82);
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

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.composer.dispose();
    this.renderer.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
      }
    });
    this.element.remove();
  }

  setState(state: RepulsionState): void {
    this.state = state;
  }

  projectToWorld(x: number, y: number): THREE.Vector3 {
    const ndc = new THREE.Vector3(1 - x * 2, -(y * 2) + 1, 0.5);
    ndc.unproject(this.camera);
    const direction = ndc.sub(this.camera.position).normalize();
    const distance = (0 - this.camera.position.z) / direction.z;
    return this.camera.position.clone().add(direction.multiplyScalar(distance));
  }

  render(deltaSeconds: number, time: number): void {
    const delta = Math.min(deltaSeconds, 0.033);
    this.updateOrbs(delta, time);
    this.updateRepulsor(time);
    this.bloomPass.strength = this.state.repulsing || this.state.grabbing ? 0.62 : 0.36;
    this.composer.render();
  }

  private createScene(): void {
    this.scene.add(new THREE.HemisphereLight(0x88ddff, 0xaa00ff, 0.48));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(2, 4, 6);
    this.scene.add(keyLight);
    const pointLight = new THREE.PointLight(0xffffff, 1.25, 14);
    pointLight.position.set(0, 0, 4);
    this.scene.add(pointLight);

    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: 0xf4f7ff,
      emissive: 0x233444,
      emissiveIntensity: 0.42,
      metalness: 0.15,
      roughness: 0.38,
      flatShading: true,
    });
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: 0xff2d88,
      wireframe: true,
      transparent: true,
      opacity: 0.55,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, ORB_COUNT);
    this.wireMesh = new THREE.InstancedMesh(geometry, wireMaterial, ORB_COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wireMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.mesh, this.wireMesh);

    for (let index = 0; index < ORB_COUNT; index++) {
      const radius = Math.pow(Math.random(), 0.72) * 0.96;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const home = new THREE.Vector3(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta) + 0.12,
        radius * Math.cos(phi) * 0.42
      );
      const scale = 0.095 + Math.random() * 0.115;
      this.orbs.push({
        home,
        position: home.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.16, (Math.random() - 0.5) * 0.16, (Math.random() - 0.5) * 0.06)),
        velocity: new THREE.Vector3(),
        scale,
      });
    }

    const repulsorGeometry = new THREE.IcosahedronGeometry(0.25, 3);
    const repulsorMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 1.15,
      roughness: 0.12,
      metalness: 0.25,
    });
    this.repulsor = new THREE.Mesh(repulsorGeometry, repulsorMaterial);
    const repulsorLight = new THREE.PointLight(0xffffff, 1.7, 7);
    this.repulsor.add(repulsorLight);
    this.repulsor.visible = false;
    this.scene.add(this.repulsor);

    const grabGeometry = new THREE.IcosahedronGeometry(0.16, 2);
    const grabMaterial = new THREE.MeshBasicMaterial({
      color: 0x35d8ff,
      transparent: true,
      opacity: 0.72,
      wireframe: true,
    });
    this.grabMarker = new THREE.Mesh(grabGeometry, grabMaterial);
    this.grabMarker.visible = false;
    this.scene.add(this.grabMarker);
  }

  private updateOrbs(delta: number, time: number): void {
    if (!this.mesh || !this.wireMesh) return;
    const repulsorTarget = this.state.repulsorTarget;
    const grabberTarget = this.state.grabberTarget;

    if (this.state.grabbing && grabberTarget && this.grabbedIndex === null) {
      this.grabbedIndex = this.findClosestOrb(grabberTarget);
    } else if (!this.state.grabbing) {
      this.grabbedIndex = null;
    }

    for (let index = 0; index < this.orbs.length; index++) {
      const orb = this.orbs[index];
      const isGrabbed = this.state.grabbing && this.grabbedIndex === index && grabberTarget !== null;
      const homeForce = orb.home.clone().sub(orb.position).multiplyScalar(isGrabbed ? 0.08 : 1.45);
      const centerForce = orb.position.clone().multiplyScalar(-0.22);
      orb.velocity.add(homeForce.multiplyScalar(delta));
      orb.velocity.add(centerForce.multiplyScalar(delta));

      if (repulsorTarget && this.state.repulsing) {
        const away = orb.position.clone().sub(repulsorTarget);
        const distance = Math.max(0.18, away.length());
        const force = 10.5 / (distance * distance);
        orb.velocity.add(away.normalize().multiplyScalar(force * delta));
      }

      if (isGrabbed && grabberTarget) {
        const pull = grabberTarget.clone().sub(orb.position).multiplyScalar(18 * delta);
        orb.velocity.add(pull);
      }

      orb.velocity.multiplyScalar(isGrabbed ? 0.82 : 0.93);
      orb.position.add(orb.velocity);
    }

    this.applyClusterCollisionConstraints();

    for (let index = 0; index < this.orbs.length; index++) {
      const orb = this.orbs[index];
      const pulse = 1 + Math.sin(time * 2.2 + index) * 0.04;
      this.dummy.position.copy(orb.position);
      this.dummy.rotation.set(time * 0.18 + index, time * 0.11 + index * 0.3, time * 0.09);
      this.dummy.scale.setScalar(orb.scale * pulse);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(index, this.dummy.matrix);

      this.dummy.scale.setScalar(orb.scale * 1.08 * pulse);
      this.dummy.updateMatrix();
      this.wireMesh.setMatrixAt(index, this.dummy.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    this.wireMesh.instanceMatrix.needsUpdate = true;
  }

  private applyClusterCollisionConstraints(): void {
    for (let pass = 0; pass < 2; pass++) {
      for (let aIndex = 0; aIndex < this.orbs.length; aIndex++) {
        const a = this.orbs[aIndex];
        for (let bIndex = aIndex + 1; bIndex < this.orbs.length; bIndex++) {
          const b = this.orbs[bIndex];
          const offset = b.position.clone().sub(a.position);
          const distance = Math.max(0.0001, offset.length());
          const minimumDistance = (a.scale + b.scale) * 0.88;
          if (distance >= minimumDistance) continue;

          const correction = offset.multiplyScalar(((minimumDistance - distance) / distance) * 0.5);
          a.position.addScaledVector(correction, -1);
          b.position.add(correction);
          a.velocity.multiplyScalar(0.985);
          b.velocity.multiplyScalar(0.985);
        }
      }
    }
  }

  private updateRepulsor(time: number): void {
    if (!this.repulsor || !this.grabMarker) return;
    if (!this.state.repulsorTarget || !this.state.repulsing) {
      this.repulsor.visible = false;
    } else {
      this.repulsor.visible = true;
      this.repulsor.position.lerp(this.state.repulsorTarget, 0.35);
      const scale = 0.95 + Math.sin(time * 8) * 0.06;
      this.repulsor.scale.setScalar(scale);
    }

    if (!this.state.grabberTarget || !this.state.grabbing) {
      this.grabMarker.visible = false;
    } else {
      this.grabMarker.visible = true;
      this.grabMarker.position.lerp(this.state.grabberTarget, 0.4);
      this.grabMarker.scale.setScalar(1 + Math.sin(time * 10) * 0.08);
    }
  }

  private findClosestOrb(target: THREE.Vector3): number | null {
    let closestIndex: number | null = null;
    let closestDistance = Infinity;
    for (let index = 0; index < this.orbs.length; index++) {
      const distance = this.orbs[index].position.distanceTo(target);
      if (distance < closestDistance && distance < 2.2) {
        closestDistance = distance;
        closestIndex = index;
      }
    }
    return closestIndex;
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
