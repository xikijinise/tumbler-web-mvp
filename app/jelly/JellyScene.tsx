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

export type JellySceneProps = {
  flavor: JellyFlavor;
  softness: SoftnessPreset;
  commandQueueRef: { current: JellyCommand[] };
  onInteraction: (kind: "poke" | "fling" | "action", label: string) => void;
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
};

const TUMBLER_REST_Y = -0.15;
const FLOOR_Y = -2.35;

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
      size * 0.05,
      size / 2,
      size / 2,
      size * 0.48,
    );
    grad.addColorStop(0, "rgba(255,255,255,0.62)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.28)");
    grad.addColorStop(0.8, "rgba(255,255,255,0.06)");
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
      height * 0.44,
      width * 0.04,
      width * 0.5,
      height * 0.48,
      width * 0.58,
    );
    glow.addColorStop(0, "rgba(255, 255, 255, 0.72)");
    glow.addColorStop(0.55, "rgba(255, 255, 255, 0.16)");
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
  envScene.background = new THREE.Color("#f6eef1");

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

  // Overhead softbox for signature glossy jelly crown highlight
  addPanel("#ffffff", 2.8, [0, 7, 2], [Math.PI / 2, 0, 0], [8, 5, 1]);
  // Left window key light strip (creates the curved vertical wet reflection!)
  addPanel("#fff9f5", 3.4, [-6.5, 2.2, 4.2], [0, Math.PI / 3, 0], [3.2, 8.5, 1]);
  // Right cool-warm rim strip
  addPanel("#eef6ff", 2.4, [6.8, 1.8, -1.5], [0, -Math.PI / 2.2, 0], [2.6, 7.5, 1]);
  // Warm lower bounce for luminous jelly belly
  addPanel("#ffe9ee", 1.5, [0, -5.5, 3], [-Math.PI / 2, 0, 0], [10, 10, 1]);

  const rt = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  return rt;
}

function createJellyGeometry() {
  const controlPoints = [
    new THREE.Vector2(0.01, -2.18),
    new THREE.Vector2(0.42, -2.16),
    new THREE.Vector2(0.86, -2.02),
    new THREE.Vector2(1.2, -1.72),
    new THREE.Vector2(1.42, -1.28),
    new THREE.Vector2(1.52, -0.68),
    new THREE.Vector2(1.49, -0.02),
    new THREE.Vector2(1.37, 0.58),
    new THREE.Vector2(1.16, 1.12),
    new THREE.Vector2(1.04, 1.38),
    // Soft jelly cap lip
    new THREE.Vector2(1.22, 1.52),
    new THREE.Vector2(1.24, 1.72),
    new THREE.Vector2(1.16, 2.04),
    new THREE.Vector2(0.94, 2.34),
    new THREE.Vector2(0.56, 2.52),
    new THREE.Vector2(0.01, 2.58),
  ];

  const curve = new THREE.SplineCurve(controlPoints);
  const sampled = curve.getPoints(58);
  const geometry = new THREE.LatheGeometry(sampled, 72);
  geometry.computeVertexNormals();
  return geometry;
}

function applyFlavorVertexColors(geometry: THREE.BufferGeometry, flavor: JellyFlavor) {
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const cap = new THREE.Color(flavor.capColor);
  const body = new THREE.Color(flavor.bodyColor);
  const base = new THREE.Color(flavor.baseColor);
  const tmp = new THREE.Color();

  for (let i = 0; i < positions.count; i += 1) {
    const y = positions.getY(i);
    // Smooth transitions between base, belly, and glossy cap
    const baseBlend = THREE.MathUtils.smoothstep(-y, 1.18, 1.78);
    const capBlend = THREE.MathUtils.smoothstep(y, 1.32, 1.62);

    tmp.copy(body);
    tmp.lerp(base, baseBlend * 0.92);
    tmp.lerp(cap, capBlend);

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
    roughness: 0.055,
    metalness: 0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    transmission: 0.84,
    thickness: 2.3,
    ior: 1.4,
    attenuationColor: new THREE.Color(flavor.attenuationColor),
    attenuationDistance: flavor.attenuationDistance,
    envMapIntensity: 1.25,
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

      vec3 deformJellyPos(vec3 p) {
        float h = clamp((p.y + 2.18) / 4.76, 0.0, 1.0);
        vec3 q = p;

        // 1. Volume-preserving squash & stretch anchored at bottom (-2.18)
        float sy = clamp(1.0 - uSquash, 0.62, 1.42);
        float sxz = 1.0 / sqrt(sy);
        q.y = -2.18 + (q.y + 2.18) * sy;
        q.xz *= sxz;

        // 2. Height-weighted top inertia wobble (secondary spring lag)
        float wobbleEnv = h * h;
        q.x += uWobble.x * wobbleEnv * 1.18;
        q.z += uWobble.y * wobbleEnv * 1.18;

        // Subtle living idle breath
        float breath = sin(uTime * 2.2 + p.y * 1.4) * 0.011 * sin(h * 3.14159);
        q.xz *= (1.0 + breath);

        // 3. Torsional twist around vertical axis
        float angle = uTwist * h * 0.62;
        float ca = cos(angle);
        float sa = sin(angle);
        q.xz = mat2(ca, -sa, sa, ca) * q.xz;

        // 4. Local Gaussian poke / grab deformation
        float dGrab = distance(p, uGrabPoint);
        float grabInfluence = exp(-dGrab * dGrab * 0.72) * smoothstep(0.0, 0.16, h);
        q += uGrabDisp * grabInfluence;

        // 5. Radial surface impact ripple
        if (uRippleAmp > 0.001) {
          float dRip = distance(p, uRippleOrigin);
          float rip = sin(dRip * 5.4 - uRipplePhase) * exp(-dRip * 0.62) * uRippleAmp * 0.085;
          vec3 radialDir = normalize(vec3(p.x, p.y * 0.35, p.z) + vec3(0.0001));
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
      vJellyHeight = clamp((position.y + 2.18) / 4.76, 0.0, 1.0);
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
      uniform vec3 uSssColor;
      uniform vec3 uRimColor;
      uniform float uEnergy;
      varying float vJellyHeight;
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `
      // Juicy Fresnel rim + translucent subsurface scattering glow
      vec3 viewDirFrag = normalize(vViewPosition);
      float fresnel = pow(1.0 - max(dot(normalize(normal), viewDirFrag), 0.0), 2.8);
      float sssMask = smoothstep(0.1, 0.9, vJellyHeight);
      gl_FragColor.rgb += uSssColor * (0.14 + uEnergy * 0.09) * sssMask * (0.4 + fresnel * 0.9);
      gl_FragColor.rgb += uRimColor * fresnel * 0.28;
      #include <dithering_fragment>
      `,
    );
  };

  material.customProgramCacheKey = () => "jelly-tumbler-shader-v1";
  return material;
}

const BUBBLE_SPECS: Array<{ pos: [number, number, number]; radius: number; phase: number }> = [
  { pos: [-0.68, 0.72, 0.52], radius: 0.085, phase: 0.4 },
  { pos: [0.76, 0.44, 0.42], radius: 0.065, phase: 1.7 },
  { pos: [-0.52, -0.92, 0.64], radius: 0.055, phase: 2.5 },
  { pos: [0.62, -0.78, -0.45], radius: 0.075, phase: 3.1 },
  { pos: [0.28, 1.08, 0.56], radius: 0.05, phase: 4.3 },
  { pos: [-0.82, -0.18, -0.35], radius: 0.06, phase: 5.2 },
];

export function JellyScene({
  flavor,
  softness,
  commandQueueRef,
  onInteraction,
}: JellySceneProps) {
  const { gl, camera, viewport } = useThree();
  const physicsRef = useRef<JellyPhysicsState>(createInitialPhysicsState());
  const tumblerGroupRef = useRef<THREE.Group>(null);
  const jellyMeshRef = useRef<THREE.Mesh>(null);
  const coreGroupRef = useRef<THREE.Group>(null);
  const shadowMeshRef = useRef<THREE.Mesh>(null);
  const bubblesGroupRef = useRef<THREE.Group>(null);

  const softnessRef = useRef(softness);
  useEffect(() => {
    softnessRef.current = softness;
  }, [softness]);

  const onInteractionRef = useRef(onInteraction);
  useEffect(() => {
    onInteractionRef.current = onInteraction;
  }, [onInteraction]);

  // Drag tracking in world space
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

  // Procedural studio PMREM environment for crisp wet jelly reflections
  const envTarget = useMemo(() => createStudioEnvironment(gl), [gl]);
  useEffect(() => () => envTarget.dispose(), [envTarget]);

  const rawDogTexture = useLoader(THREE.TextureLoader, "./custom-character.png");
  const dogTexture = useMemo(() => createCleanDogTexture(rawDogTexture), [rawDogTexture]);
  useEffect(() => () => dogTexture.dispose(), [dogTexture]);

  const shadowTexture = useMemo(() => createShadowTexture(), []);
  useEffect(() => () => shadowTexture.dispose(), [shadowTexture]);

  const backdropTexture = useMemo(
    () => createBackdropTexture(flavor.backdropTop, flavor.backdropBottom),
    [flavor.backdropTop, flavor.backdropBottom],
  );
  useEffect(() => () => backdropTexture.dispose(), [backdropTexture]);

  const jellyGeometry = useMemo(() => createJellyGeometry(), []);
  useEffect(() => () => jellyGeometry.dispose(), [jellyGeometry]);

  const jellyResources = useMemo(() => {
    const uniforms: JellyShaderUniforms = {
      uTime: { value: 0 },
      uSquash: { value: 0 },
      uWobble: { value: new THREE.Vector2(0, 0) },
      uTwist: { value: 0 },
      uGrabPoint: { value: new THREE.Vector3(0, 0.2, 1.3) },
      uGrabDisp: { value: new THREE.Vector3(0, 0, 0) },
      uRippleOrigin: { value: new THREE.Vector3(0, 0.2, 1.3) },
      uRippleAmp: { value: 0 },
      uRipplePhase: { value: 0 },
      uSssColor: { value: new THREE.Color(flavor.sssColor) },
      uRimColor: { value: new THREE.Color(flavor.rimColor) },
      uEnergy: { value: 0 },
    };
    const material = createJellyMaterial(flavor, uniforms);
    return { uniforms, material };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Created once and updated via ref
  }, []);

  const jellyResourcesRef = useRef(jellyResources);
  useEffect(() => () => jellyResourcesRef.current.material.dispose(), []);

  // Update vertex colors & shader tint cleanly when flavor changes
  useEffect(() => {
    applyFlavorVertexColors(jellyGeometry, flavor);
    const { material, uniforms } = jellyResourcesRef.current;
    material.attenuationColor.set(flavor.attenuationColor);
    material.attenuationDistance = flavor.attenuationDistance;
    uniforms.uSssColor.value.set(flavor.sssColor);
    uniforms.uRimColor.value.set(flavor.rimColor);
  }, [flavor, jellyGeometry]);

  // Global pointer move / up listeners while grabbing the jelly so dragging stays locked even off-mesh
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
        jellyAudio.playRelease(THREE.MathUtils.clamp(0.45 + speed * 0.08, 0.4, 1.5), softnessRef.current);
        onInteractionRef.current("fling", "拉扯回弹");
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

    // Immediate tactile poke dimple + sound
    pokeJelly(
      physics,
      [localPoint.x, localPoint.y, localPoint.z],
      [localNormal.x, localNormal.y, localNormal.z],
      0.92,
      softnessRef.current,
    );
    startGrabJelly(physics, [localPoint.x, localPoint.y, localPoint.z]);
    jellyAudio.playPoke(0.9, softnessRef.current);
    onInteractionRef.current("poke", "戳了一下");

    // Set up camera-facing drag plane passing through hit point
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
    // Clicking empty space nudges the jelly playfully toward the opposite side
    const side = event.point.x < physicsRef.current.x ? "right" : "left";
    applyJellyAction(physicsRef.current, side, 0.72, softnessRef.current);
    jellyAudio.playPoke(0.75, softnessRef.current);
    onInteractionRef.current("poke", side === "left" ? "轻推向左" : "轻推向右");
  };

  useFrame((state, delta) => {
    const physics = physicsRef.current;

    // Drain external commands (keyboard actions, auto-poke, reset)
    while (commandQueueRef.current.length > 0) {
      const cmd = commandQueueRef.current.shift();
      if (!cmd) break;
      if (cmd.type === "reset") {
        resetPhysicsState(physics);
      } else if (cmd.type === "action") {
        const strength = cmd.strength ?? 1;
        applyJellyAction(physics, cmd.action, strength, softnessRef.current);
        jellyAudio.playPoke(strength, softnessRef.current);
      }
    }

    // Compute dynamic viewport-aware stage bounds so the tumbler stays comfortably on screen
    const maxX = Math.max(1.8, viewport.width * 0.36);
    const maxY = Math.max(2.6, viewport.height * 0.34);
    stepJellyPhysics(
      physics,
      delta,
      softnessRef.current,
      { maxX, maxY, minZ: -1.8, maxZ: 1.4 },
      {
        onBounce: (intensity) => {
          jellyAudio.playBounce(intensity, softnessRef.current);
        },
      },
    );

    // Apply transform to tumbler root group
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

    // Sync GPU jelly shader uniforms
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
    uniforms.uEnergy.value = physics.energy;

    // Suspended internal pixel dog head floats with subtle secondary lag
    if (coreGroupRef.current) {
      const floatY = Math.sin(state.clock.elapsedTime * 2.1) * 0.035;
      coreGroupRef.current.position.set(
        physics.coreX,
        -0.12 + physics.coreY + floatY,
        0.06 + physics.coreZ,
      );
      const sy = THREE.MathUtils.clamp(1 - physics.squash * 0.42, 0.78, 1.22);
      const sx = 1 / Math.sqrt(sy);
      coreGroupRef.current.scale.set(sx, sy, 1);
      coreGroupRef.current.rotation.set(
        physics.wobbleZ * 0.25,
        physics.twist * 0.45,
        -physics.wobbleX * 0.28,
      );
    }

    // Subtle internal micro-bubbles drift gently inside the jelly
    if (bubblesGroupRef.current) {
      bubblesGroupRef.current.position.set(
        physics.coreX * 0.85,
        physics.coreY * 0.85,
        physics.coreZ * 0.85,
      );
    }

    // Dynamic colored translucent contact shadow on the studio floor
    if (shadowMeshRef.current) {
      const lift = Math.max(0, physics.y);
      const spread = 1 + lift * 0.16 + Math.max(0, physics.squash) * 0.35;
      const leanOffsetX = -Math.sin(physics.tiltZ) * 0.55;
      const leanOffsetZ = Math.sin(physics.tiltX) * 0.55;
      shadowMeshRef.current.position.set(
        physics.x + leanOffsetX,
        FLOOR_Y + 0.01,
        physics.z + leanOffsetZ,
      );
      shadowMeshRef.current.scale.set(3.2 * spread, 2.75 * spread, 1);
      const mat = shadowMeshRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = THREE.MathUtils.clamp(0.75 - lift * 0.14, 0.15, 0.8);
    }
  });

  return (
    <>
      <color attach="background" args={[flavor.backdropBottom]} />
      <primitive object={envTarget.texture} attach="environment" />

      {/* Soft studio lighting for crystal-clear refraction and juicy rim highlights */}
      <ambientLight intensity={0.75} color="#fff9fb" />
      <directionalLight position={[-4.5, 7.5, 6.5]} intensity={2.1} color="#ffffff" />
      <directionalLight position={[5.5, 4.0, -4.0]} intensity={1.35} color="#e8f3ff" />
      <pointLight position={[0, -1.5, 4.5]} intensity={1.1} distance={14} color={flavor.sssColor} />

      {/* Seamless luminous studio backdrop for clean transmission refraction */}
      <mesh position={[0, 0.5, -5.5]} onPointerDown={handleBackdropPointerDown}>
        <planeGeometry args={[28, 18]} />
        <meshBasicMaterial map={backdropTexture} toneMapped={false} />
      </mesh>

      {/* Subtle studio tabletop plane */}
      <mesh
        position={[0, FLOOR_Y, -0.4]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={handleBackdropPointerDown}
      >
        <planeGeometry args={[26, 16]} />
        <meshStandardMaterial color={flavor.floorColor} roughness={0.85} metalness={0} />
      </mesh>

      {/* Colored translucent jelly caustic shadow */}
      <mesh ref={shadowMeshRef} position={[0, FLOOR_Y + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={shadowTexture}
          color={flavor.shadowColor}
          transparent
          opacity={0.72}
          depthWrite={false}
        />
      </mesh>

      {/* Main Jelly Tumbler Assembly */}
      <group ref={tumblerGroupRef} position={[0, TUMBLER_REST_Y, 0]}>
        {/* Internal Suspended Pixel Dog Charm (opaque -> optically refracted through the jelly!) */}
        <group ref={coreGroupRef} position={[0, -0.12, 0.06]}>
          {/* Soft cream medallion backing so the dog looks 3D from every angle */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.78, 0.78, 0.14, 36]} />
            <meshStandardMaterial color="#fff7eb" roughness={0.35} metalness={0.05} />
          </mesh>
          {/* Front pixel-dog face */}
          <mesh position={[0, 0, 0.076]}>
            <planeGeometry args={[1.48, 1.48]} />
            <meshStandardMaterial
              map={dogTexture}
              transparent
              alphaTest={0.25}
              roughness={0.32}
              metalness={0}
            />
          </mesh>
          {/* Back pixel-dog face (mirrored) */}
          <mesh position={[0, 0, -0.076]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[1.48, 1.48]} />
            <meshStandardMaterial
              map={dogTexture}
              transparent
              alphaTest={0.25}
              roughness={0.32}
              metalness={0}
            />
          </mesh>
        </group>

        {/* Tiny suspended micro-bubbles inside the jelly volume */}
        <group ref={bubblesGroupRef}>
          {BUBBLE_SPECS.map((bubble, idx) => (
            <mesh key={idx} position={bubble.pos}>
              <sphereGeometry args={[bubble.radius, 16, 16]} />
              <meshStandardMaterial
                color="#ffffff"
                emissive="#ffffff"
                emissiveIntensity={0.45}
                roughness={0.05}
                metalness={0.1}
              />
            </mesh>
          ))}
        </group>

        {/* Outer Crystal-Clear Deformable Jelly Shell */}
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
