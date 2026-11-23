"use client";

/* eslint-disable react/no-unknown-property -- React Three Fiber JSX props. */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { jellyAudio } from "./audio";
import type { JellyFlavor, SoftnessPreset } from "./flavors";
import {
  applyJellyAction,
  createInitialPhysicsState,
  endGrabJelly,
  moveGrabJelly,
  pokeJelly,
  resetPhysicsState,
  startGrabJelly,
  stepJellyPhysics,
  type JellyActionId,
  type JellyPhysicsState,
} from "./physics";

export type JellyCommand =
  | { id: number; type: "action"; action: JellyActionId; strength?: number }
  | { id: number; type: "reset" };

export type JellyInteractionEvent = {
  kind: "poke" | "fling" | "action";
  intensity: "gentle" | "intense";
  screenX?: number;
  screenY?: number;
};

export type JellySceneProps = {
  flavor: JellyFlavor;
  softness: SoftnessPreset;
  comboHeat: number;
  commandQueueRef: { current: JellyCommand[] };
  onInteraction: (event: JellyInteractionEvent) => void;
};

type JellyShaderUniforms = {
  uTime: { value: number };
  uSquash: { value: number };
  uWobble: { value: THREE.Vector2 };
  uTwist: { value: number };
  uGrabPoint: { value: THREE.Vector3 };
  uGrabDisp: { value: THREE.Vector3 };
  uRippleOrigin: { value: THREE.Vector3 };
  uRippleAmp: { value: number };
  uRipplePhase: { value: number };
  uSssColor: { value: THREE.Color };
  uRimColor: { value: THREE.Color };
  uEnergy: { value: number };
  uDogMap: { value: THREE.Texture };
};

type DropletParticle = {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
};

const JELLY_MIN_Y = -1.78;
const JELLY_HEIGHT = 3.74;
const TUMBLER_REST_Y = -0.1;
const PLATE_SURFACE_Y = -1.89;
const DROPLET_COUNT = 16;

function createCleanDogTexture(sourceTexture: THREE.Texture) {
  const image = sourceTexture.image as HTMLImageElement;
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx || !width || !height) {
    throw new Error("Unable to prepare dog texture");
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);

  // Strip the yellow circular backdrop while preserving crisp pixel-art dog edges
  for (let i = 0; i < pixels.data.length; i += 4) {
    const r = pixels.data[i];
    const g = pixels.data[i + 1];
    const b = pixels.data[i + 2];
    const isYellowBg =
      r > 180 && g > 155 && b < 130 && r > b * 1.55 && g > b * 1.35;
    if (isYellowBg) {
      pixels.data[i + 3] = 0;
    }
  }
  ctx.putImageData(pixels, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Delicate underglaze typography printed around the porcelain dessert plate rim */
function createPlateRimTexture(accentHex: string) {
  const width = 1024;
  const height = 256;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Subtle hairline glaze ring along the upper plate rim (v ~ 0.72..0.82 -> canvas y ~ 45..72)
    ctx.strokeStyle = accentHex;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 44);
    ctx.lineTo(width, 44);
    ctx.stroke();

    ctx.globalAlpha = 0.42;
    ctx.fillStyle = accentHex;
    ctx.font = '600 18px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textBaseline = "middle";
    const phrase = "TOMORROW · 明天就好了 · JELLY DOG · 等等就好了 · ";
    const repeats = 3;
    const step = width / repeats;
    for (let i = 0; i < repeats; i += 1) {
      ctx.fillText(phrase, i * step + 12, 66);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function createShadowTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.04,
      size / 2,
      size / 2,
      size * 0.48,
    );
    grad.addColorStop(0, "rgba(255,255,255,0.68)");
    grad.addColorStop(0.42, "rgba(255,255,255,0.34)");
    grad.addColorStop(0.78, "rgba(255,255,255,0.08)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function createBackdropTexture(topHex: string, bottomHex: string) {
  const width = 512;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const linear = ctx.createLinearGradient(0, 0, 0, height);
    linear.addColorStop(0, topHex);
    linear.addColorStop(1, bottomHex);
    ctx.fillStyle = linear;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(
      width * 0.5,
      height * 0.43,
      width * 0.03,
      width * 0.5,
      height * 0.48,
      width * 0.58,
    );
    glow.addColorStop(0, "rgba(255, 255, 255, 0.78)");
    glow.addColorStop(0.55, "rgba(255, 255, 255, 0.18)");
    glow.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createStudioEnvironment(gl: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(gl);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color("#f9f2f4");

  const addPanel = (
    color: string,
    intensity: number,
    pos: [number, number, number],
    rot: [number, number, number],
    scale: [number, number, number],
  ) => {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    mesh.scale.set(...scale);
    envScene.add(mesh);
  };

  addPanel("#ffffff", 3.2, [0, 7, 2.2], [Math.PI / 2, 0, 0], [8.5, 5.5, 1]);
  addPanel("#fffaf7", 3.8, [-6.2, 2.4, 4.5], [0, Math.PI / 3, 0], [3.4, 8.5, 1]);
  addPanel("#edf6ff", 2.6, [6.6, 1.8, -1.2], [0, -Math.PI / 2.2, 0], [2.8, 7.5, 1]);
  addPanel("#fff2f5", 1.8, [0, -5.2, 3], [-Math.PI / 2, 0, 0], [10, 10, 1]);

  const rt = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  return rt;
}

function createJellyDomeGeometry() {
  const controlPoints = [
    new THREE.Vector2(0.01, -1.78),
    new THREE.Vector2(0.55, -1.75),
    new THREE.Vector2(1.12, -1.58),
    new THREE.Vector2(1.52, -1.24),
    new THREE.Vector2(1.74, -0.72),
    new THREE.Vector2(1.76, -0.14),
    new THREE.Vector2(1.64, 0.44),
    new THREE.Vector2(1.42, 0.98),
    new THREE.Vector2(1.14, 1.44),
    new THREE.Vector2(0.76, 1.78),
    new THREE.Vector2(0.36, 1.93),
    new THREE.Vector2(0.01, 1.96),
  ];

  const curve = new THREE.SplineCurve(controlPoints);
  const sampled = curve.getPoints(56);
  const geometry = new THREE.LatheGeometry(sampled, 80);

  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const radius = Math.hypot(x, z);
    if (radius > 0.08) {
      const theta = Math.atan2(z, x);
      const h = THREE.MathUtils.clamp((y - JELLY_MIN_Y) / JELLY_HEIGHT, 0, 1);
      const fluteEnvelope = Math.sin(Math.PI * h) * Math.sin(Math.PI * h);
      const flute = 1 + 0.038 * Math.cos(theta * 8) * fluteEnvelope;
      pos.setXYZ(i, x * flute, y, z * flute);
    }
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createPlateGeometry() {
  const pts = [
    new THREE.Vector2(0.01, -0.16),
    new THREE.Vector2(1.9, -0.16),
    new THREE.Vector2(2.35, -0.1),
    new THREE.Vector2(2.82, 0.08),
    new THREE.Vector2(2.96, 0.14),
    new THREE.Vector2(2.92, 0.17),
    new THREE.Vector2(2.74, 0.12),
    new THREE.Vector2(2.2, -0.02),
    new THREE.Vector2(1.5, -0.05),
    new THREE.Vector2(0.01, -0.05),
  ];
  const geo = new THREE.LatheGeometry(pts, 72);
  geo.computeVertexNormals();
  return geo;
}

function applyFlavorVertexColors(geometry: THREE.BufferGeometry, flavor: JellyFlavor) {
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const top = new THREE.Color(flavor.topColor);
  const mid = new THREE.Color(flavor.midColor);
  const bottom = new THREE.Color(flavor.bottomColor);
  const tmp = new THREE.Color();

  for (let i = 0; i < positions.count; i += 1) {
    const y = positions.getY(i);
    const h = THREE.MathUtils.clamp((y - JELLY_MIN_Y) / JELLY_HEIGHT, 0, 1);
    if (h < 0.48) {
      const t = THREE.MathUtils.smoothstep(h, 0.0, 0.48);
      tmp.copy(bottom).lerp(mid, t);
    } else {
      const t = THREE.MathUtils.smoothstep(h, 0.48, 1.0);
      tmp.copy(mid).lerp(top, t);
    }

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
}

function createJellyMaterial(flavor: JellyFlavor, uniforms: JellyShaderUniforms) {
  const material = new THREE.MeshPhysicalMaterial({
    color: "#ffffff",
    vertexColors: true,
    roughness: 0.045,
    metalness: 0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.035,
    transmission: 0.88,
    thickness: 2.5,
    ior: 1.42,
    attenuationColor: new THREE.Color(flavor.attenuationColor),
    attenuationDistance: flavor.attenuationDistance,
    envMapIntensity: 1.35,
    transparent: false,
    side: THREE.FrontSide,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
      uniform float uTime;
      uniform float uSquash;
      uniform vec2 uWobble;
      uniform float uTwist;
      uniform vec3 uGrabPoint;
      uniform vec3 uGrabDisp;
      uniform vec3 uRippleOrigin;
      uniform float uRippleAmp;
      uniform float uRipplePhase;
      varying float vJellyHeight;
      varying vec3 vLocalPos;

      vec3 deformJellyPos(vec3 p) {
        float h = clamp((p.y + 1.78) / 3.74, 0.0, 1.0);
        vec3 q = p;

        // 1. Volume-preserving squash & stretch anchored at bottom (-1.78)
        float sy = clamp(1.0 - uSquash, 0.56, 1.48);
        float sxz = 1.0 / sqrt(sy);
        q.y = -1.78 + (q.y + 1.78) * sy;
        q.xz *= sxz;

        // 2. Two-mode gelatin wobble (top lag + belly S-wave)
        float wobbleEnv = h * h + sin(h * 6.28318) * 0.14;
        q.x += uWobble.x * wobbleEnv * 1.25;
        q.z += uWobble.y * wobbleEnv * 1.25;

        // Subtle living gelatin jiggle
        float breath = sin(uTime * 2.4 + p.y * 1.8) * 0.014 * sin(h * 3.14159);
        q.xz *= (1.0 + breath);

        // 3. Torsional twist around vertical axis
        float angle = uTwist * h * 0.68;
        float ca = cos(angle);
        float sa = sin(angle);
        q.xz = mat2(ca, -sa, sa, ca) * q.xz;

        // 4. Local Gaussian poke / stretchy grab lobe
        float dGrab = distance(p, uGrabPoint);
        float grabInfluence = exp(-dGrab * dGrab * 0.65) * smoothstep(0.0, 0.14, h);
        q += uGrabDisp * grabInfluence;

        // 5. Concentric surface impact ripple
        if (uRippleAmp > 0.001) {
          float dRip = distance(p, uRippleOrigin);
          float rip = sin(dRip * 5.6 - uRipplePhase) * exp(-dRip * 0.55) * uRippleAmp * 0.1;
          vec3 radialDir = normalize(vec3(p.x, p.y * 0.4, p.z) + vec3(0.0001));
          q += radialDir * rip;
        }

        return q;
      }
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      `#include <beginnormal_vertex>
      vec3 baseP = position;
      vec3 deformedP = deformJellyPos(baseP);
      vec3 t1 = normalize(abs(objectNormal.y) < 0.9 ? cross(objectNormal, vec3(0.0, 1.0, 0.0)) : cross(objectNormal, vec3(1.0, 0.0, 0.0)));
      vec3 t2 = normalize(cross(objectNormal, t1));
      float eps = 0.04;
      vec3 dT1 = deformJellyPos(baseP + t1 * eps) - deformedP;
      vec3 dT2 = deformJellyPos(baseP + t2 * eps) - deformedP;
      vec3 computedN = cross(dT1, dT2);
      if (length(computedN) > 0.00001) {
        objectNormal = normalize(computedN);
      }
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `vec3 transformed = deformedP;
      vJellyHeight = clamp((position.y + 1.78) / 3.74, 0.0, 1.0);
      vLocalPos = position;
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
      uniform vec3 uSssColor;
      uniform vec3 uRimColor;
      uniform float uEnergy;
      uniform sampler2D uDogMap;
      varying float vJellyHeight;
      varying vec3 vLocalPos;
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      float dogPrintMask = 0.0;
      if (vLocalPos.z > 0.15) {
        float angleX = atan(vLocalPos.x, vLocalPos.z);
        float dogU = angleX / 1.16 + 0.5;
        float dogV = (vLocalPos.y + 0.92) / 2.0;
        if (dogU > 0.0 && dogU < 1.0 && dogV > 0.0 && dogV < 1.0) {
          vec4 dogTexel = texture2D(uDogMap, vec2(dogU, dogV));
          float frontFade = smoothstep(0.15, 0.55, vLocalPos.z);
          dogPrintMask = dogTexel.a * frontFade;
          diffuseColor.rgb = mix(diffuseColor.rgb, dogTexel.rgb, dogPrintMask * 0.95);
        }
      }
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <transmission_fragment>",
      THREE.ShaderChunk.transmission_fragment.replace(
        "material.transmission = transmission;",
        "material.transmission = transmission * (1.0 - dogPrintMask * 0.64);",
      ),
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `
      vec3 viewDirFrag = normalize(vViewPosition);
      float fresnel = pow(1.0 - max(dot(normalize(normal), viewDirFrag), 0.0), 2.5);
      float sssMask = smoothstep(0.06, 0.94, vJellyHeight);
      gl_FragColor.rgb += uSssColor * (0.16 + uEnergy * 0.13) * sssMask * (0.35 + fresnel * 0.95);
      gl_FragColor.rgb += uRimColor * fresnel * (0.34 + uEnergy * 0.1);
      #include <dithering_fragment>
      `,
    );
  };

  material.customProgramCacheKey = () => "crystal-jelly-dome-dogprint-v3";
  return material;
}

const BUBBLE_SPECS: Array<{ pos: [number, number, number]; radius: number }> = [
  { pos: [-0.88, 0.56, 0.54], radius: 0.09 },
  { pos: [0.92, 0.32, 0.42], radius: 0.07 },
  { pos: [-0.66, -0.76, 0.72], radius: 0.06 },
  { pos: [0.74, -0.68, -0.46], radius: 0.08 },
  { pos: [0.34, 1.02, 0.52], radius: 0.055 },
  { pos: [-0.96, -0.14, -0.38], radius: 0.065 },
  { pos: [0.18, -1.06, 0.62], radius: 0.05 },
];

function createDropletPool(): DropletParticle[] {
  return Array.from({ length: DROPLET_COUNT }, () => ({
    active: false,
    x: 0,
    y: -10,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    maxLife: 0.8,
    size: 0.08,
  }));
}

export function JellyScene({
  flavor,
  softness,
  comboHeat,
  commandQueueRef,
  onInteraction,
}: JellySceneProps) {
  const { gl, camera, viewport } = useThree();
  const physicsRef = useRef<JellyPhysicsState>(createInitialPhysicsState());
  const tumblerGroupRef = useRef<THREE.Group>(null);
  const jellyMeshRef = useRef<THREE.Mesh>(null);
  const shadowMeshRef = useRef<THREE.Mesh>(null);
  const bubblesGroupRef = useRef<THREE.Group>(null);
  const dropletsMeshRef = useRef<THREE.InstancedMesh>(null);
  const dropletsRef = useRef<DropletParticle[]>(createDropletPool());
  const dropletDummy = useMemo(() => new THREE.Object3D(), []);

  const softnessRef = useRef(softness);
  useEffect(() => {
    softnessRef.current = softness;
  }, [softness]);

  const comboHeatRef = useRef(comboHeat);
  useEffect(() => {
    comboHeatRef.current = comboHeat;
  }, [comboHeat]);

  const onInteractionRef = useRef(onInteraction);
  useEffect(() => {
    onInteractionRef.current = onInteraction;
  }, [onInteraction]);

  const spawnDroplets = (originX: number, originY: number, originZ: number, count: number) => {
    const pool = dropletsRef.current;
    let spawned = 0;
    for (let i = 0; i < pool.length && spawned < count; i += 1) {
      const p = pool[i];
      if (!p.active) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.6 + Math.random() * 2.8;
        p.active = true;
        p.x = originX + (Math.random() - 0.5) * 0.45;
        p.y = originY + (Math.random() - 0.5) * 0.35;
        p.z = originZ + (Math.random() - 0.5) * 0.35;
        p.vx = Math.cos(angle) * speed;
        p.vy = 2.6 + Math.random() * 3.4;
        p.vz = Math.sin(angle) * speed * 0.7;
        p.life = 0;
        p.maxLife = 0.65 + Math.random() * 0.45;
        p.size = 0.065 + Math.random() * 0.075;
        spawned += 1;
      }
    }
  };

  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startWorld: THREE.Vector3;
    lastWorld: THREE.Vector3;
    velX: number;
    velY: number;
    lastTime: number;
    dragPlane: THREE.Plane;
  }>({
    active: false,
    moved: false,
    pointerId: -1,
    startClientX: 0,
    startClientY: 0,
    startWorld: new THREE.Vector3(),
    lastWorld: new THREE.Vector3(),
    velX: 0,
    velY: 0,
    lastTime: 0,
    dragPlane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
  });

  const envTarget = useMemo(() => createStudioEnvironment(gl), [gl]);
  useEffect(() => () => envTarget.dispose(), [envTarget]);

  const rawDogTexture = useLoader(THREE.TextureLoader, "./custom-character.png");
  const dogTexture = useMemo(() => createCleanDogTexture(rawDogTexture), [rawDogTexture]);
  useEffect(() => () => dogTexture.dispose(), [dogTexture]);

  const plateRimTexture = useMemo(() => createPlateRimTexture(flavor.accent), [flavor.accent]);
  useEffect(() => () => plateRimTexture.dispose(), [plateRimTexture]);

  const shadowTexture = useMemo(() => createShadowTexture(), []);
  useEffect(() => () => shadowTexture.dispose(), [shadowTexture]);

  const backdropTexture = useMemo(
    () => createBackdropTexture(flavor.backdropTop, flavor.backdropBottom),
    [flavor.backdropTop, flavor.backdropBottom],
  );
  useEffect(() => () => backdropTexture.dispose(), [backdropTexture]);

  const jellyGeometry = useMemo(() => createJellyDomeGeometry(), []);
  useEffect(() => () => jellyGeometry.dispose(), [jellyGeometry]);

  const plateGeometry = useMemo(() => createPlateGeometry(), []);
  useEffect(() => () => plateGeometry.dispose(), [plateGeometry]);

  const jellyResources = useMemo(() => {
    const uniforms: JellyShaderUniforms = {
      uTime: { value: 0 },
      uSquash: { value: 0 },
      uWobble: { value: new THREE.Vector2(0, 0) },
      uTwist: { value: 0 },
      uGrabPoint: { value: new THREE.Vector3(0, 0.1, 1.4) },
      uGrabDisp: { value: new THREE.Vector3(0, 0, 0) },
      uRippleOrigin: { value: new THREE.Vector3(0, 0.1, 1.4) },
      uRippleAmp: { value: 0 },
      uRipplePhase: { value: 0 },
      uSssColor: { value: new THREE.Color(flavor.sssColor) },
      uRimColor: { value: new THREE.Color(flavor.rimColor) },
      uEnergy: { value: 0 },
      uDogMap: { value: dogTexture },
    };
    const material = createJellyMaterial(flavor, uniforms);
    return { uniforms, material };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Created once and updated via ref
  }, []);

  const jellyResourcesRef = useRef(jellyResources);
  useEffect(() => () => jellyResourcesRef.current.material.dispose(), []);

  useEffect(() => {
    applyFlavorVertexColors(jellyGeometry, flavor);
    const { material, uniforms } = jellyResourcesRef.current;
    material.attenuationColor.set(flavor.attenuationColor);
    material.attenuationDistance = flavor.attenuationDistance;
    uniforms.uSssColor.value.set(flavor.sssColor);
    uniforms.uRimColor.value.set(flavor.rimColor);
    uniforms.uDogMap.value = dogTexture;
  }, [flavor, jellyGeometry, dogTexture]);

  useEffect(() => {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hitPoint = new THREE.Vector3();

    const clientToDragPlane = (clientX: number, clientY: number, out: THREE.Vector3) => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(dragRef.current.dragPlane, out);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.active || drag.pointerId !== event.pointerId) return;

      const distPx = Math.hypot(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY,
      );
      if (distPx > 6) {
        drag.moved = true;
      }

      if (clientToDragPlane(event.clientX, event.clientY, hitPoint)) {
        const now = performance.now();
        const dt = Math.max(0.008, (now - drag.lastTime) / 1000);
        const vx = (hitPoint.x - drag.lastWorld.x) / dt;
        const vy = (hitPoint.y - drag.lastWorld.y) / dt;
        drag.velX = THREE.MathUtils.lerp(drag.velX, vx, 0.45);
        drag.velY = THREE.MathUtils.lerp(drag.velY, vy, 0.45);
        drag.lastWorld.copy(hitPoint);
        drag.lastTime = now;

        const deltaX = hitPoint.x - drag.startWorld.x;
        const deltaY = hitPoint.y - drag.startWorld.y;
        moveGrabJelly(physicsRef.current, deltaX, deltaY, softnessRef.current);
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.active || drag.pointerId !== event.pointerId) return;
      drag.active = false;

      const physics = physicsRef.current;
      if (drag.moved) {
        const speed = Math.hypot(drag.velX, drag.velY);
        endGrabJelly(physics, drag.velX, drag.velY, softnessRef.current);
        jellyAudio.playRelease(
          THREE.MathUtils.clamp(0.45 + speed * 0.08, 0.4, 1.5),
          softnessRef.current,
        );
        spawnDroplets(physics.x, TUMBLER_REST_Y + physics.y + 0.6, physics.z + 0.6, 6);
        const rect = gl.domElement.getBoundingClientRect();
        onInteractionRef.current({
          kind: "fling",
          intensity: "intense",
          screenX: ((event.clientX - rect.left) / rect.width) * 100,
          screenY: ((event.clientY - rect.top) / rect.height) * 100,
        });
      } else {
        physics.grabActive = false;
        physics.grabTarget = [0, 0, 0];
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [camera, gl]);

  const handleJellyPointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const mesh = jellyMeshRef.current;
    if (!mesh) return;

    const physics = physicsRef.current;
    const localPoint = mesh.worldToLocal(event.point.clone());
    const localNormal = event.face
      ? event.face.normal.clone().normalize()
      : localPoint.clone().normalize();

    pokeJelly(
      physics,
      [localPoint.x, localPoint.y, localPoint.z],
      [localNormal.x, localNormal.y, localNormal.z],
      0.95,
      softnessRef.current,
    );
    startGrabJelly(physics, [localPoint.x, localPoint.y, localPoint.z]);
    jellyAudio.playPoke(0.92, softnessRef.current);

    if (comboHeatRef.current > 0.35) {
      spawnDroplets(event.point.x, event.point.y, event.point.z, 4);
    }

    const rect = gl.domElement.getBoundingClientRect();
    onInteractionRef.current({
      kind: "poke",
      intensity: comboHeatRef.current > 0.55 ? "intense" : "gentle",
      screenX: ((event.clientX - rect.left) / rect.width) * 100,
      screenY: ((event.clientY - rect.top) / rect.height) * 100,
    });

    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const drag = dragRef.current;
    drag.dragPlane.setFromNormalAndCoplanarPoint(camDir.negate(), event.point);
    drag.active = true;
    drag.moved = false;
    drag.pointerId = event.pointerId;
    drag.startClientX = event.clientX;
    drag.startClientY = event.clientY;
    drag.startWorld.copy(event.point);
    drag.lastWorld.copy(event.point);
    drag.velX = 0;
    drag.velY = 0;
    drag.lastTime = performance.now();
  };

  const handleBackdropPointerDown = (event: ThreeEvent<PointerEvent>) => {
    const side = event.point.x < physicsRef.current.x ? "right" : "left";
    applyJellyAction(physicsRef.current, side, 0.78, softnessRef.current);
    jellyAudio.playPoke(0.8, softnessRef.current);
    const rect = gl.domElement.getBoundingClientRect();
    onInteractionRef.current({
      kind: "poke",
      intensity: "gentle",
      screenX: ((event.clientX - rect.left) / rect.width) * 100,
      screenY: ((event.clientY - rect.top) / rect.height) * 100,
    });
  };

  useFrame((state, delta) => {
    const physics = physicsRef.current;
    const heat = comboHeatRef.current;

    while (commandQueueRef.current.length > 0) {
      const cmd = commandQueueRef.current.shift();
      if (!cmd) break;
      if (cmd.type === "reset") {
        resetPhysicsState(physics);
      } else if (cmd.type === "action") {
        const strength = cmd.strength ?? 1;
        applyJellyAction(physics, cmd.action, strength, softnessRef.current);
        jellyAudio.playPoke(strength, softnessRef.current);
        if (cmd.action === "super" || cmd.action === "stomp" || heat > 0.4) {
          spawnDroplets(physics.x, TUMBLER_REST_Y + physics.y + 0.5, physics.z + 0.5, 6);
        }
      }
    }

    const maxX = Math.max(1.8, viewport.width * 0.36);
    const maxY = Math.max(2.5, viewport.height * 0.34);
    stepJellyPhysics(
      physics,
      delta,
      softnessRef.current,
      { maxX, maxY, minZ: -1.8, maxZ: 1.4 },
      {
        onBounce: (intensity) => {
          jellyAudio.playBounce(intensity, softnessRef.current);
          if (intensity > 0.5) {
            spawnDroplets(physics.x, PLATE_SURFACE_Y + 0.3, physics.z + 0.4, 4);
          }
        },
      },
    );

    if (tumblerGroupRef.current) {
      tumblerGroupRef.current.position.set(
        physics.x,
        TUMBLER_REST_Y + physics.y,
        physics.z,
      );
      tumblerGroupRef.current.rotation.set(
        physics.tiltX,
        physics.yaw,
        physics.tiltZ,
        "YXZ",
      );
    }

    const { uniforms } = jellyResourcesRef.current;
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uSquash.value = physics.squash;
    uniforms.uWobble.value.set(physics.wobbleX, physics.wobbleZ);
    uniforms.uTwist.value = physics.twist;
    uniforms.uGrabPoint.value.set(
      physics.grabPoint[0],
      physics.grabPoint[1],
      physics.grabPoint[2],
    );
    uniforms.uGrabDisp.value.set(
      physics.grabDisp[0],
      physics.grabDisp[1],
      physics.grabDisp[2],
    );
    uniforms.uRippleOrigin.value.set(
      physics.rippleOrigin[0],
      physics.rippleOrigin[1],
      physics.rippleOrigin[2],
    );
    uniforms.uRippleAmp.value = physics.rippleAmp;
    uniforms.uRipplePhase.value = physics.ripplePhase;
    uniforms.uEnergy.value = Math.min(2.2, physics.energy + heat * 0.9);

    if (bubblesGroupRef.current) {
      const jitter = heat > 0.05 ? Math.sin(state.clock.elapsedTime * 22) * 0.03 * heat : 0;
      bubblesGroupRef.current.position.set(
        physics.coreX * 0.85 + jitter,
        physics.coreY * 0.85,
        physics.coreZ * 0.85,
      );
    }

    // Update 3D jelly splash droplets
    if (dropletsMeshRef.current) {
      const dt = Math.min(delta, 0.04);
      const pool = dropletsRef.current;
      for (let i = 0; i < pool.length; i += 1) {
        const p = pool[i];
        if (p.active) {
          p.life += dt;
          if (p.life >= p.maxLife) {
            p.active = false;
            dropletDummy.position.set(0, -20, 0);
            dropletDummy.scale.setScalar(0.0001);
          } else {
            p.vy -= 14.5 * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
            if (p.y < PLATE_SURFACE_Y + 0.06) {
              p.y = PLATE_SURFACE_Y + 0.06;
              p.vy = Math.abs(p.vy) * 0.35;
              p.vx *= 0.72;
              p.vz *= 0.72;
            }
            const progress = p.life / p.maxLife;
            const scale = p.size * Math.sin(Math.PI * (1 - progress * 0.85));
            dropletDummy.position.set(p.x, p.y, p.z);
            dropletDummy.scale.setScalar(Math.max(0.001, scale));
          }
        } else {
          dropletDummy.position.set(0, -20, 0);
          dropletDummy.scale.setScalar(0.0001);
        }
        dropletDummy.updateMatrix();
        dropletsMeshRef.current.setMatrixAt(i, dropletDummy.matrix);
      }
      dropletsMeshRef.current.instanceMatrix.needsUpdate = true;
    }

    if (shadowMeshRef.current) {
      const lift = Math.max(0, physics.y);
      const spread = 1 + lift * 0.16 + Math.max(0, physics.squash) * 0.42;
      const leanOffsetX = -Math.sin(physics.tiltZ) * 0.5;
      const leanOffsetZ = Math.sin(physics.tiltX) * 0.5;
      shadowMeshRef.current.position.set(
        physics.x + leanOffsetX,
        PLATE_SURFACE_Y + 0.015,
        physics.z + leanOffsetZ,
      );
      shadowMeshRef.current.scale.set(3.5 * spread, 3.0 * spread, 1);
      const mat = shadowMeshRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = THREE.MathUtils.clamp(0.78 - lift * 0.15, 0.14, 0.82);
    }
  });

  return (
    <>
      <color attach="background" args={[flavor.backdropBottom]} />
      <primitive object={envTarget.texture} attach="environment" />

      <ambientLight intensity={0.82} color="#fff9fb" />
      <directionalLight position={[-4.5, 7.5, 6.5]} intensity={2.2} color="#ffffff" />
      <directionalLight position={[5.5, 4.0, -4.0]} intensity={1.45} color="#eef6ff" />
      <pointLight position={[0, -1.2, 4.5]} intensity={1.25} distance={14} color={flavor.sssColor} />

      <mesh position={[0, 0.5, -5.8]} onPointerDown={handleBackdropPointerDown}>
        <planeGeometry args={[28, 18]} />
        <meshBasicMaterial map={backdropTexture} toneMapped={false} />
      </mesh>

      <mesh
        position={[0, PLATE_SURFACE_Y - 0.12, -0.4]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={handleBackdropPointerDown}
      >
        <planeGeometry args={[26, 16]} />
        <meshStandardMaterial color={flavor.floorColor} roughness={0.85} metalness={0} />
      </mesh>

      {/* Glossy white porcelain dessert plate with delicate underglaze rim text */}
      <mesh
        geometry={plateGeometry}
        position={[0, PLATE_SURFACE_Y + 0.04, 0]}
        rotation={[0, -0.35, 0]}
        onPointerDown={handleBackdropPointerDown}
      >
        <meshPhysicalMaterial
          map={plateRimTexture}
          color="#ffffff"
          roughness={0.14}
          metalness={0.02}
          clearcoat={0.85}
          clearcoatRoughness={0.1}
        />
      </mesh>

      <mesh
        ref={shadowMeshRef}
        position={[0, PLATE_SURFACE_Y + 0.015, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={shadowTexture}
          color={flavor.shadowColor}
          transparent
          opacity={0.75}
          depthWrite={false}
        />
      </mesh>

      {/* 3D Crystal Jelly Splash Droplets */}
      <instancedMesh ref={dropletsMeshRef} args={[undefined, undefined, DROPLET_COUNT]}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshPhysicalMaterial
          color={flavor.topColor}
          roughness={0.06}
          metalness={0}
          clearcoat={1}
          transmission={0.65}
          thickness={0.4}
          ior={1.4}
        />
      </instancedMesh>

      {/* Pure Crystal Jelly Tumbler Assembly */}
      <group ref={tumblerGroupRef} position={[0, TUMBLER_REST_Y, 0]}>
        <group ref={bubblesGroupRef}>
          {BUBBLE_SPECS.map((bubble, idx) => (
            <mesh key={idx} position={bubble.pos}>
              <sphereGeometry args={[bubble.radius, 16, 16]} />
              <meshStandardMaterial
                color="#ffffff"
                emissive="#ffffff"
                emissiveIntensity={0.55}
                roughness={0.04}
                metalness={0.05}
              />
            </mesh>
          ))}
        </group>

        <mesh
          ref={jellyMeshRef}
          geometry={jellyGeometry}
          material={jellyResources.material}
          onPointerDown={handleJellyPointerDown}
          onPointerOver={() => {
            document.body.style.cursor = "grab";
          }}
          onPointerOut={() => {
            if (!dragRef.current.active) {
              document.body.style.cursor = "auto";
            }
          }}
        />
      </group>
    </>
  );
}
