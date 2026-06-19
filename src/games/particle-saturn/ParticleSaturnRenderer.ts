import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

interface SaturnState {
  scale: number;
  rotationX: number;
  rotationY: number;
  handActive: boolean;
}

const IS_MOBILE = window.innerWidth < 768;
const SATURN_PARTICLE_COUNT = IS_MOBILE ? 140000 : 320000;
const STAR_COUNT = IS_MOBILE ? 9000 : 22000;
const IDLE_ROTATION_X = 0.34;

const saturnVertexShader = `
attribute vec3 customColor;
attribute float size;
attribute float opacityAttr;
attribute float orbitSpeed;
attribute float isRing;
attribute float randomId;

uniform float uTime;
uniform float uScale;
uniform float uRotationX;
uniform float uRotationY;

varying vec3 vColor;
varying float vOpacity;
varying float vDist;
varying float vScaleFactor;
varying float vIsRing;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

mat3 rotationX(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

mat3 rotationY(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

void main() {
  vec3 pos = position;
  if (isRing > 0.5) {
    float angle = uTime * orbitSpeed * 0.07 + randomId * 0.006;
    float s = sin(angle);
    float c = cos(angle);
    pos.xz = mat2(c, -s, s, c) * pos.xz;
  }

  pos = rotationY(uRotationY) * rotationX(uRotationX) * pos;

  vColor = customColor;
  vOpacity = opacityAttr;
  vScaleFactor = uScale;
  vIsRing = isRing;
  vec4 mvPosition = modelViewMatrix * vec4(pos * uScale, 1.0);
  vDist = -mvPosition.z;
  if (vDist < 25.0 && vDist > 0.1) {
    float chaosIntensity = 1.0 - (vDist / 25.0);
    chaosIntensity = pow(chaosIntensity, 3.0);
    float highFreqTime = uTime * 40.0;
    float noiseX = sin(highFreqTime + pos.x * 10.0) * hash(pos.y);
    float noiseY = cos(highFreqTime + pos.y * 10.0) * hash(pos.x);
    float noiseZ = sin(highFreqTime * 0.5) * hash(pos.z);
    mvPosition.xyz += vec3(noiseX, noiseY, noiseZ) * chaosIntensity * 3.0;
  }
  float pointSize = size * (350.0 / max(8.0, vDist)) * 0.55;
  if (isRing < 0.5 && vDist < 50.0) pointSize *= 0.8;
  gl_PointSize = clamp(pointSize, 0.0, 18.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const saturnFragmentShader = `
varying vec3 vColor;
varying float vOpacity;
varying float vDist;
varying float vScaleFactor;
varying float vIsRing;

void main() {
  vec2 cxy = 2.0 * gl_PointCoord - 1.0;
  float r = dot(cxy, cxy);
  if (r > 1.0) discard;
  float glow = smoothstep(1.0, 0.4, r);
  float t = clamp((vScaleFactor - 0.15) / 2.35, 0.0, 1.0);
  vec3 deepGold = vec3(0.35, 0.22, 0.05);
  vec3 baseColor = mix(deepGold, vColor, smoothstep(0.1, 0.9, t));
  float brightness = 0.2 + 0.85 * t;
  float densityAlpha = 0.18 + 0.36 * smoothstep(0.0, 0.5, t);
  vec3 finalColor = baseColor * brightness;

  if (vDist < 40.0) {
    float closeMix = 1.0 - (vDist / 40.0);
    if (vIsRing < 0.5) {
      vec3 deepTexture = pow(vColor, vec3(1.4)) * 1.15;
      finalColor = mix(finalColor, deepTexture, closeMix * 0.7);
    } else {
      finalColor += vec3(0.08, 0.06, 0.04) * closeMix;
    }
  }

  float depthAlpha = 1.0;
  if (vDist < 10.0) depthAlpha = smoothstep(0.0, 10.0, vDist);
  float alpha = glow * vOpacity * densityAlpha * depthAlpha;
  gl_FragColor = vec4(finalColor, alpha);
}
`;

const starVertexShader = `
attribute vec3 customColor;
attribute float size;
varying vec3 vColor;
uniform float uTime;

void main() {
  vColor = customColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float dist = -mvPosition.z;
  gl_PointSize = clamp(size * (900.0 / max(80.0, dist)), 0.7, 5.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const starFragmentShader = `
varying vec3 vColor;
uniform float uTime;
float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }
void main() {
  vec2 cxy = 2.0 * gl_PointCoord - 1.0;
  float radius = dot(cxy, cxy);
  if (radius > 1.0) discard;
  float twinkle = 0.72 + 0.28 * sin(uTime * 1.8 + random(gl_FragCoord.xy) * 10.0);
  float glow = pow(1.0 - radius, 1.5);
  gl_FragColor = vec4(vColor * twinkle, glow * 0.78);
}
`;

export class ParticleSaturnRenderer {
  readonly element: HTMLCanvasElement;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(56, 1, 1, 5000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private saturnMaterial: THREE.ShaderMaterial | null = null;
  private starMaterial: THREE.ShaderMaterial | null = null;
  private saturn: THREE.Points | null = null;
  private stars: THREE.Points | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private currentState: SaturnState = {
    scale: 0.92,
    rotationX: IDLE_ROTATION_X,
    rotationY: 0,
    handActive: false,
  };
  private targetState: SaturnState = {
    scale: 0.92,
    rotationX: IDLE_ROTATION_X,
    rotationY: 0,
    handActive: false,
  };

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setClearColor(0x02040a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.element = this.renderer.domElement;
    this.element.className = 'saturn-webgl-canvas';

    this.scene.background = new THREE.Color(0x02040a);
    this.scene.fog = new THREE.FogExp2(0x02040a, 0.00055);
    this.camera.position.set(0, 10, 104);
    this.camera.lookAt(0, 0, 0);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.28, 0.86);
    this.composer.addPass(this.bloomPass);

    this.createSaturn();
    this.createStars();
  }

  mount(): void {
    this.container.prepend(this.element);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.render(0);
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.composer.dispose();
    this.renderer.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Points) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
      }
    });
    this.element.remove();
  }

  setInteraction(state: SaturnState): void {
    this.targetState = state;
  }

  render(time: number): void {
    const lerp = this.targetState.handActive ? 0.12 : 0.035;
    this.currentState.scale += (this.targetState.scale - this.currentState.scale) * lerp;
    this.currentState.rotationX += (this.targetState.rotationX - this.currentState.rotationX) * lerp;
    this.currentState.rotationY += (this.targetState.rotationY - this.currentState.rotationY) * lerp;
    this.currentState.handActive = this.targetState.handActive;

    if (this.saturnMaterial) {
      const displayRotationX = this.currentState.handActive
        ? this.currentState.rotationX
        : IDLE_ROTATION_X + Math.sin(time * 0.3) * 0.025;
      this.saturnMaterial.uniforms.uTime.value = time;
      this.saturnMaterial.uniforms.uScale.value = this.currentState.scale;
      this.saturnMaterial.uniforms.uRotationX.value = displayRotationX;
      this.saturnMaterial.uniforms.uRotationY.value = this.currentState.rotationY;
    }

    if (this.starMaterial) this.starMaterial.uniforms.uTime.value = time;
    if (this.stars) this.stars.rotation.y = time * 0.006;
    if (this.saturn) this.saturn.rotation.z = 26.73 * (Math.PI / 180) + Math.sin(time * 0.2) * 0.015;

    this.bloomPass.strength = this.currentState.handActive ? 0.34 : 0.24;
    this.composer.render();
  }

  private createSaturn(): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(SATURN_PARTICLE_COUNT * 3);
    const colors = new Float32Array(SATURN_PARTICLE_COUNT * 3);
    const sizes = new Float32Array(SATURN_PARTICLE_COUNT);
    const opacities = new Float32Array(SATURN_PARTICLE_COUNT);
    const orbitSpeeds = new Float32Array(SATURN_PARTICLE_COUNT);
    const isRings = new Float32Array(SATURN_PARTICLE_COUNT);
    const randomIds = new Float32Array(SATURN_PARTICLE_COUNT);

    const bodyColors = ['#E3DAC5', '#C9A070', '#E3DAC5', '#B08D55'].map((color) => new THREE.Color(color));
    const ringColors = {
      c: new THREE.Color('#2A2520'),
      bInner: new THREE.Color('#CDBFA0'),
      bOuter: new THREE.Color('#DCCBBA'),
      cassini: new THREE.Color('#050505'),
      a: new THREE.Color('#989085'),
      f: new THREE.Color('#AFAFA0'),
    };
    const planetRadius = 18;

    for (let index = 0; index < SATURN_PARTICLE_COUNT; index++) {
      randomIds[index] = Math.random() * Math.PI * 2;
      let x = 0;
      let y = 0;
      let z = 0;
      let color = bodyColors[0];
      let size = 1;
      let opacity = 0.75;
      let speed = 0;
      let ring = 0;

      if (index < SATURN_PARTICLE_COUNT * 0.25) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        x = planetRadius * Math.sin(phi) * Math.cos(theta);
        const rawY = planetRadius * Math.cos(phi);
        y = rawY * 0.9;
        z = planetRadius * Math.sin(phi) * Math.sin(theta);
        const lat = (rawY / planetRadius + 1) * 0.5;
        const bandNoise = Math.cos(lat * 40) * 0.8 + Math.cos(lat * 15) * 0.4;
        color = bodyColors[Math.max(0, Math.floor(lat * 4 + bandNoise) % 4)];
        size = 1 + Math.random() * 0.8;
        opacity = 0.58;
      } else {
        ring = 1;
        const zone = Math.random();
        let radius = planetRadius * 1.8;
        if (zone < 0.15) {
          radius = planetRadius * (1.235 + Math.random() * (1.525 - 1.235));
          color = ringColors.c;
          size = 0.5;
          opacity = 0.3;
        } else if (zone < 0.65) {
          const t = Math.random();
          radius = planetRadius * (1.525 + t * (1.95 - 1.525));
          color = ringColors.bInner.clone().lerp(ringColors.bOuter, t);
          size = 0.8 + Math.random() * 0.6;
          opacity = Math.sin(radius * 2) > 0.8 ? 0.78 : 0.62;
        } else if (zone < 0.69) {
          radius = planetRadius * (1.95 + Math.random() * (2.025 - 1.95));
          color = ringColors.cassini;
          size = 0.3;
          opacity = 0.08;
        } else if (zone < 0.99) {
          radius = planetRadius * (2.025 + Math.random() * (2.27 - 2.025));
          color = ringColors.a;
          size = 0.7;
          opacity = radius > planetRadius * 2.2 && radius < planetRadius * 2.21 ? 0.08 : 0.42;
        } else {
          radius = planetRadius * (2.32 + Math.random() * 0.02);
          color = ringColors.f;
          size = 1;
          opacity = 0.7;
        }
        const theta = Math.random() * Math.PI * 2;
        x = radius * Math.cos(theta);
        z = radius * Math.sin(theta);
        y = (Math.random() - 0.5) * (radius > planetRadius * 2.3 ? 0.4 : 0.15);
        speed = 8 / Math.sqrt(radius);
      }

      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      sizes[index] = size;
      opacities[index] = opacity;
      orbitSpeeds[index] = speed;
      isRings[index] = ring;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('customColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('opacityAttr', new THREE.BufferAttribute(opacities, 1));
    geometry.setAttribute('orbitSpeed', new THREE.BufferAttribute(orbitSpeeds, 1));
    geometry.setAttribute('isRing', new THREE.BufferAttribute(isRings, 1));
    geometry.setAttribute('randomId', new THREE.BufferAttribute(randomIds, 1));

    this.saturnMaterial = new THREE.ShaderMaterial({
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 1 },
        uRotationX: { value: IDLE_ROTATION_X },
        uRotationY: { value: 0 },
      },
      vertexShader: saturnVertexShader,
      fragmentShader: saturnFragmentShader,
    });
    this.saturn = new THREE.Points(geometry, this.saturnMaterial);
    this.saturn.rotation.z = 26.73 * (Math.PI / 180);
    this.scene.add(this.saturn);
  }

  private createStars(): void {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);
    const palette = ['#9bb0ff', '#ffffff', '#ffcc6f', '#ff7b7b'].map((color) => new THREE.Color(color));

    for (let index = 0; index < STAR_COUNT; index++) {
      const radius = 400 + Math.random() * 2300;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const color = palette[Math.floor(Math.random() * palette.length)];
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = radius * Math.cos(phi);
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      sizes[index] = 1 + Math.random() * 3;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('customColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.starMaterial = new THREE.ShaderMaterial({
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
      uniforms: { uTime: { value: 0 } },
      vertexShader: starVertexShader,
      fragmentShader: starFragmentShader,
    });
    this.stars = new THREE.Points(geometry, this.starMaterial);
    this.scene.add(this.stars);
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
