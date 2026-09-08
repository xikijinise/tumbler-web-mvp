"use client";

/* eslint-disable react/no-unknown-property -- React Three Fiber JSX props. */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import {
  BallCollider,
  CapsuleCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type PhysicsState = {
  angle: number;
  angularVelocity: number;
  impact: number;
  z: number;
  vz: number;
  x: number;
  vx: number;
  y: number;
  vy: number;
};

export type PhysicsAction = {
  force: number;
  angle: number;
  spin: number;
  depth: number;
  x: number;
  jump: number;
};

export type PhysicsCommand =
  | {
      id: number;
      type: "hit";
      action: PhysicsAction;
      strength: number;
      point?: { x: number; y: number };
    }
  | { id: number; type: "drag"; dx: number; dy: number }
  | { id: number; type: "release"; totalX: number; totalY: number }
  | { id: number; type: "return" }
  | { id: number; type: "reset" };

type TumblerSceneProps = {
  commandQueueRef: { current: PhysicsCommand[] };
  onState: (state: PhysicsState) => void;
};

const INITIAL_POSITION = { x: 0, y: 0, z: 0 };
const INITIAL_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const ACTION_FORCE_GAIN = 1.75;
const SCREEN_DEPTH_MIN = -2.05;
const SCREEN_DEPTH_MAX = 0.82;
const WALL_THICKNESS = 0.16;
const BODY_SCREEN_HALF_WIDTH = 1.68;
const BODY_SCREEN_TOP = 2.98;
const BODY_COLLIDER_HALF_WIDTH = 1.28;
const BODY_COLLIDER_TOP = 2.48;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createFusedDogTexture(sourceTexture: THREE.Texture) {
  const image = sourceTexture.image as HTMLImageElement;
  const canvas = document.createElement("canvas");
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  canvas.width = sourceWidth;
  canvas.height = Math.max(1, Math.round(sourceHeight * 0.68));
  const context = canvas.getContext("2d");
  if (!context || !canvas.width || !canvas.height) {
    throw new Error("Unable to prepare the dog head texture");
  }

  context.imageSmoothingEnabled = false;
  context.drawImage(
    image,
    Math.round(sourceWidth * 0.04),
    0,
    Math.round(sourceWidth * 0.92),
    Math.round(sourceHeight * 0.68),
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (y * canvas.width + x) * 4;
      const red = pixels.data[index];
      const green = pixels.data[index + 1];
      const blue = pixels.data[index + 2];
      const isYellowBackdrop =
        red > 160 && green > 130 && blue < 150 && red > blue * 1.45 && green > blue * 1.3;
      if (isYellowBackdrop) {
        pixels.data[index + 3] = 0;
        continue;
      }

      const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
      const shade = 0.5 + luminance * 0.62;
      const darkFeature = luminance < 0.2;
      const dogBlue = blue > red * 1.12 && blue > green * 1.05;
      pixels.data[index] = Math.round(
        darkFeature ? 92 + red * 0.1 : dogBlue ? 112 + 64 * shade : 236 * shade,
      );
      pixels.data[index + 1] = Math.round(
        darkFeature ? 48 + green * 0.1 : dogBlue ? 142 + 42 * shade : 108 * shade,
      );
      pixels.data[index + 2] = Math.round(
        darkFeature ? 70 + blue * 0.12 : dogBlue ? 184 + 38 * shade : 140 * shade,
      );
      const dx = (x / canvas.width - 0.5) / 0.53;
      const dy = (y / canvas.height - 0.42) / 0.66;
      const edge = Math.hypot(dx, dy);
      const edgeFade = Math.min(1, Math.max(0.32, 1 - Math.max(0, edge - 0.54) * 0.8));
      pixels.data[index + 3] = Math.round(pixels.data[index + 3] * 0.58 * edgeFade);
    }
  }
  context.putImageData(pixels, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function applyHit(
  body: RapierRigidBody,
  action: PhysicsAction,
  strength: number,
  point: { x: number; y: number } | undefined,
  impactRef: { current: number },
) {
  const intensity = action.force * strength * ACTION_FORCE_GAIN;
  const pointX = point ? (point.x - 50) / 50 : 0;
  const pointY = point ? (50 - point.y) / 50 : 0;
  const impulse = {
    x: clamp((action.x * 0.34 + pointX * 1.2) * intensity, -8.5, 8.5),
    y: clamp((action.jump * 0.32 + pointY * 1.2) * intensity, -9, 9),
    z: clamp((action.depth * 0.23 + pointY * 0.85) * intensity, -9, 9),
  };
  const torque = {
    x: clamp(action.jump * 0.1 * intensity, -3.2, 3.2),
    y: clamp(action.spin * 0.16 * intensity, -4.2, 4.2),
    z: clamp((action.angle * 0.64 + pointX * 1.2) * intensity, -7.8, 7.8),
  };

  body.wakeUp();
  body.applyImpulse(impulse, true);
  body.applyTorqueImpulse(torque, true);
  impactRef.current = clamp(
    impactRef.current + intensity * 0.7 + Math.abs(action.spin) * 0.015,
    0,
    2,
  );
}

function applyDrag(body: RapierRigidBody, dx: number, dy: number, impactRef: { current: number }) {
  body.wakeUp();
  body.applyImpulse(
    {
      x: clamp(dx * 0.045, -1.3, 1.3),
      y: clamp(-dy * 0.02, -0.75, 0.75),
      z: clamp(dy * 0.035, -1.1, 1.1),
    },
    true,
  );
  body.applyTorqueImpulse(
    {
      x: clamp(-dy * 0.02, -0.75, 0.75),
      y: clamp(dx * 0.018, -0.75, 0.75),
      z: clamp(dx * 0.022, -0.7, 0.7),
    },
    true,
  );
  impactRef.current = Math.max(
    impactRef.current,
    clamp((Math.abs(dx) + Math.abs(dy) * 0.7) / 17, 0, 1.2),
  );
}

function applyRelease(
  body: RapierRigidBody,
  totalX: number,
  totalY: number,
  impactRef: { current: number },
) {
  body.wakeUp();
  body.applyImpulse(
    {
      x: clamp(totalX * 0.22, -12, 12),
      y: clamp(-totalY * 0.08, -6, 6),
      z: clamp(totalY * 0.16, -10, 10),
    },
    true,
  );
  body.applyTorqueImpulse(
    {
      x: clamp(-totalY * 0.09, -4.5, 4.5),
      y: clamp(totalX * 0.07, -3.6, 3.6),
      z: clamp(totalX * 0.045, -3.6, 3.6),
    },
    true,
  );
  impactRef.current = clamp(
    impactRef.current + clamp((Math.abs(totalX) + Math.abs(totalY)) / 90, 0, 1.2),
    0,
    2,
  );
}

function resetBody(body: RapierRigidBody, impactRef: { current: number }) {
  body.setTranslation(INITIAL_POSITION, true);
  body.setRotation(INITIAL_ROTATION, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  body.wakeUp();
  impactRef.current = 0;
}

function TumblerBody({ commandQueueRef, onState }: TumblerSceneProps) {
  const bodyRef = useRef<RapierRigidBody | null>(null);
  const visualGroupRef = useRef<THREE.Group | null>(null);
  const impactRef = useRef(0);
  const returningRef = useRef(false);
  const reportClockRef = useRef(0);
  const lastReportRef = useRef<PhysicsState | null>(null);
  const uprightQuaternionRef = useRef(new THREE.Quaternion());
  const uprightEulerRef = useRef(new THREE.Euler());
  const identityQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const jellyTargetScaleRef = useRef(new THREE.Vector3(1.12, 1.12, 1.12));
  const jellyMotionRef = useRef(0);
  const jellyProfile = useMemo(
    () => [
      new THREE.Vector2(0.015, -2.22),
      new THREE.Vector2(0.34, -2.2),
      new THREE.Vector2(0.7, -2.12),
      new THREE.Vector2(0.98, -1.92),
      new THREE.Vector2(1.2, -1.66),
      new THREE.Vector2(1.34, -1.32),
      new THREE.Vector2(1.43, -0.86),
      new THREE.Vector2(1.44, -0.3),
      new THREE.Vector2(1.41, 0.26),
      new THREE.Vector2(1.34, 0.75),
      new THREE.Vector2(1.2, 1.18),
      new THREE.Vector2(1.07, 1.48),
      new THREE.Vector2(0.98, 1.63),
      new THREE.Vector2(1.12, 1.68),
      new THREE.Vector2(1.22, 1.78),
      new THREE.Vector2(1.22, 1.94),
      new THREE.Vector2(1.18, 2.18),
      new THREE.Vector2(1.05, 2.41),
      new THREE.Vector2(0.84, 2.6),
      new THREE.Vector2(0.54, 2.72),
      new THREE.Vector2(0.22, 2.78),
      new THREE.Vector2(0.015, 2.79),
    ],
    [],
  );
  const jellyGeometry = useMemo(
    () => new THREE.LatheGeometry(jellyProfile, 128),
    [jellyProfile],
  );
  const dogTexture = useLoader(THREE.TextureLoader, "./custom-character.png");
  const fusedDogTexture = useMemo(
    () => createFusedDogTexture(dogTexture),
    [dogTexture],
  );
  useEffect(() => () => fusedDogTexture.dispose(), [fusedDogTexture]);
  const combinedJellyGeometry = useMemo(() => {
    const projector = new THREE.Mesh(jellyGeometry);
    const dogDecalGeometry = new DecalGeometry(
      projector,
      new THREE.Vector3(0, -0.08, 1.34),
      new THREE.Euler(0, 0, 0),
      new THREE.Vector3(1.34, 1.06, 0.34),
    );
    const mergedGeometry = mergeGeometries(
      [jellyGeometry, dogDecalGeometry],
      true,
    );
    dogDecalGeometry.dispose();
    if (!mergedGeometry) {
      throw new Error("Unable to merge the jelly body and dog head geometry");
    }
    const positions = mergedGeometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    for (let index = 0; index < positions.count; index += 1) {
      const y = positions.getY(index);
      const baseBlend = clamp((-y - 1.12) / 0.62, 0, 1);
      const capBlend = clamp((y - 1.5) / 0.72, 0, 1);
      const bodyRed = 0.98;
      const bodyGreen = 0.9;
      const bodyBlue = 0.76;
      const capRed = 0.94;
      const capGreen = 0.08;
      const capBlue = 0.04;
      const baseRed = 0.1;
      const baseGreen = 0.1;
      const baseBlue = 0.12;
      const middle = 1 - Math.max(baseBlend, capBlend);
      const offset = index * 3;
      colors[offset] = bodyRed * middle + capRed * capBlend + baseRed * baseBlend;
      colors[offset + 1] = bodyGreen * middle + capGreen * capBlend + baseGreen * baseBlend;
      colors[offset + 2] = bodyBlue * middle + capBlue * capBlend + baseBlue * baseBlend;
    }
    mergedGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return mergedGeometry;
  }, [jellyGeometry]);
  const baseJellyPositions = useMemo(
    () => new Float32Array(combinedJellyGeometry.attributes.position.array),
    [combinedJellyGeometry],
  );
  const combinedJellyGeometryRef = useRef(combinedJellyGeometry);
  const geometryWasDeformedRef = useRef(false);

  useFrame((state, delta) => {
    const body = bodyRef.current;
    if (!body) return;

    while (commandQueueRef.current.length > 0) {
      const command = commandQueueRef.current.shift();
      if (!command) break;
      if (command.type === "hit") {
        returningRef.current = false;
        applyHit(body, command.action, command.strength, command.point, impactRef);
      } else if (command.type === "drag") {
        returningRef.current = false;
        applyDrag(body, command.dx, command.dy, impactRef);
      } else if (command.type === "release") {
        returningRef.current = false;
        applyRelease(body, command.totalX, command.totalY, impactRef);
      } else if (command.type === "return") {
        returningRef.current = true;
        body.wakeUp();
      } else {
        returningRef.current = false;
        resetBody(body, impactRef);
      }
    }

    const translation = body.translation();
    const rotation = body.rotation();
    const linearVelocity = body.linvel();
    const angularVelocity = body.angvel();

    const uprightQuaternion = uprightQuaternionRef.current.set(
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
    );
    const uprightEuler = uprightEulerRef.current.setFromQuaternion(
      uprightQuaternion,
      "XYZ",
    );
    const uprightAmount = clamp(Math.hypot(uprightEuler.x, uprightEuler.z), 0, 1);
    if (uprightAmount > 0.025) {
      const recoveryGain = uprightAmount > 0.7 ? 3.2 : 0.95;
      body.applyTorqueImpulse(
        {
          x: clamp(-uprightEuler.x * recoveryGain - angularVelocity.x * 0.25, -8, 8),
          y: 0,
          z: clamp(-uprightEuler.z * recoveryGain - angularVelocity.z * 0.25, -8, 8),
        },
        true,
      );
    }

    const boundedZ = clamp(translation.z, SCREEN_DEPTH_MIN, SCREEN_DEPTH_MAX);
    if (boundedZ !== translation.z) {
      body.setTranslation(
        { x: translation.x, y: translation.y, z: boundedZ },
        true,
      );
      body.setLinvel(
        {
          x: linearVelocity.x,
          y: linearVelocity.y,
          z: -linearVelocity.z * 0.25,
        },
        true,
      );
    }

    if (returningRef.current) {
      const positionBlend = 1 - Math.exp(-delta * 1.35);
      const rotationBlend = 1 - Math.exp(-delta * 1.8);
      const nextQuaternion = new THREE.Quaternion(
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w,
      ).slerp(identityQuaternion, rotationBlend);
      const nextTranslation = {
        x: THREE.MathUtils.lerp(translation.x, 0, positionBlend),
        y: THREE.MathUtils.lerp(translation.y, 0, positionBlend),
        z: THREE.MathUtils.lerp(translation.z, 0, positionBlend),
      };
      const speed = Math.hypot(linearVelocity.x, linearVelocity.y, linearVelocity.z);
      const angularSpeed = Math.hypot(angularVelocity.x, angularVelocity.y, angularVelocity.z);

      body.setTranslation(nextTranslation, true);
      body.setRotation(nextQuaternion, true);
      body.setLinvel(
        {
          x: linearVelocity.x * 0.68,
          y: linearVelocity.y * 0.68,
          z: linearVelocity.z * 0.68,
        },
        true,
      );
      body.setAngvel(
        {
          x: angularVelocity.x * 0.68,
          y: angularVelocity.y * 0.68,
          z: angularVelocity.z * 0.68,
        },
        true,
      );

      if (
        Math.hypot(nextTranslation.x, nextTranslation.y, nextTranslation.z) < 0.025 &&
        nextQuaternion.angleTo(identityQuaternion) < 0.025 &&
        speed + angularSpeed < 0.16
      ) {
        resetBody(body, impactRef);
        returningRef.current = false;
      }
    }

    const motionTarget = clamp(
      impactRef.current * 0.8 +
        Math.hypot(angularVelocity.x, angularVelocity.z) * 0.07 +
        Math.hypot(linearVelocity.x, linearVelocity.y) * 0.025,
      0,
      1,
    );
    jellyMotionRef.current = THREE.MathUtils.lerp(
      jellyMotionRef.current,
      motionTarget,
      1 - Math.exp(-delta * 9),
    );
    const jellyMotion = jellyMotionRef.current;
    if (jellyMotion > 0.001 || geometryWasDeformedRef.current) {
      const geometry = combinedJellyGeometryRef.current;
      const positions = geometry.attributes.position;
      const time = state.clock.elapsedTime;
      for (let index = 0; index < positions.count; index += 1) {
        const offset = index * 3;
        const baseX = baseJellyPositions[offset];
        const baseY = baseJellyPositions[offset + 1];
        const baseZ = baseJellyPositions[offset + 2];
        const height = clamp((baseY + 2.22) / 5.01, 0, 1);
        const envelope = Math.sin(Math.PI * height);
        const wave = jellyMotion * envelope;
        positions.setXYZ(
          index,
          baseX + Math.sin(time * 8 + baseY * 2.1 + baseX * 1.7) * wave * 0.07,
          baseY + Math.cos(time * 7 + baseX * 1.4) * wave * 0.035,
          baseZ + Math.sin(time * 9 + baseX * 1.2 + baseY) * wave * 0.09,
        );
      }
      positions.needsUpdate = true;
      geometry.computeVertexNormals();
      geometryWasDeformedRef.current = jellyMotion > 0.001;
    }
    if (visualGroupRef.current) {
      jellyTargetScaleRef.current.set(
        1.12 * (1 + jellyMotion * 0.1),
        1.12 * (1 - jellyMotion * 0.08),
        1.12 * (1 + jellyMotion * 0.045),
      );
      visualGroupRef.current.scale.lerp(
        jellyTargetScaleRef.current,
        1 - Math.exp(-delta * 12),
      );
    }

    const stateTranslation = body.translation();
    const stateRotation = body.rotation();
    const stateLinearVelocity = body.linvel();
    const stateAngularVelocity = body.angvel();

    impactRef.current = Math.max(0, impactRef.current - delta * 2.4);
    reportClockRef.current += delta;
    if (reportClockRef.current < 1 / 30 && lastReportRef.current) return;
    reportClockRef.current = 0;

    const euler = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion(
        stateRotation.x,
        stateRotation.y,
        stateRotation.z,
        stateRotation.w,
      ),
      "XYZ",
    );
    const signedTilt =
      Math.sign(euler.z || euler.x || 1) *
      THREE.MathUtils.radToDeg(Math.hypot(euler.x, euler.z));
    const nextPhysicsState: PhysicsState = {
      angle: clamp(signedTilt, -89, 89),
      angularVelocity: THREE.MathUtils.radToDeg(
        Math.sign(stateAngularVelocity.z || stateAngularVelocity.x || 1) *
          Math.hypot(stateAngularVelocity.x, stateAngularVelocity.z),
      ),
      impact: impactRef.current,
      z: stateTranslation.z * 76,
      vz: stateLinearVelocity.z * 76,
      x: stateTranslation.x * 20,
      vx: stateLinearVelocity.x * 20,
      y: stateTranslation.y * 16,
      vy: stateLinearVelocity.y * 16,
    };
    lastReportRef.current = nextPhysicsState;
    onState(nextPhysicsState);
  });

  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      position={[0, 0, 0]}
      linearDamping={0.3}
      angularDamping={0.82}
      canSleep={false}
      friction={0.9}
      restitution={0.12}
    >
      <group ref={visualGroupRef} scale={1.12}>
        <mesh geometry={combinedJellyGeometry} castShadow receiveShadow>
          <meshPhysicalMaterial
            attach="material-0"
            color="#f7ead4"
            vertexColors
            roughness={0.08}
            metalness={0}
            clearcoat={0.88}
            clearcoatRoughness={0.08}
            transmission={0.7}
            thickness={1.7}
            ior={1.38}
            attenuationColor="#fff0d7"
            attenuationDistance={2.1}
            transparent
            opacity={0.86}
          />
          <meshPhysicalMaterial
            attach="material-1"
            map={fusedDogTexture}
            color="#c77888"
            roughness={0.28}
            metalness={0}
            clearcoat={0.24}
            clearcoatRoughness={0.2}
            transmission={0.64}
            thickness={1.15}
            ior={1.38}
            transparent
            opacity={0.55}
            alphaTest={0.01}
            depthWrite={false}
          />
        </mesh>
      </group>

      <BallCollider
        args={[1.1]}
        position={[0, -1.42, 0]}
        density={1.45}
        friction={1.3}
        restitution={0.08}
      />
      <CapsuleCollider
        args={[1.1, 0.9]}
        position={[0, 0.22, 0]}
        density={0.18}
        friction={0.82}
        restitution={0.12}
      />
    </RigidBody>
  );
}

function BoundaryWalls() {
  const { viewport } = useThree();
  const halfWidth = viewport.width * 0.5;
  const halfHeight = viewport.height * 0.5;
  const verticalCenter = 0.15;
  const wallThickness = WALL_THICKNESS;
  const wallDepth = 20;
  const sideWallX = Math.max(
    halfWidth - BODY_SCREEN_HALF_WIDTH + BODY_COLLIDER_HALF_WIDTH + wallThickness / 2,
    wallThickness / 2,
  );
  const topWallY = Math.max(
    verticalCenter + halfHeight - BODY_SCREEN_TOP + BODY_COLLIDER_TOP + wallThickness / 2,
    -2.2,
  );
  const bottomWallY = Math.max(
    -2.47,
    verticalCenter - halfHeight + wallThickness / 2,
  );
  const horizontalHalfWidth = halfWidth + wallThickness;
  const depthWallHalfWidth = halfWidth + wallThickness;
  const depthWallHalfHeight = halfHeight + wallThickness;
  const frontWallZ = SCREEN_DEPTH_MAX + BODY_COLLIDER_HALF_WIDTH + wallThickness / 2;
  const backWallZ = SCREEN_DEPTH_MIN - BODY_COLLIDER_HALF_WIDTH - wallThickness / 2;

  return (
    <RigidBody type="fixed" colliders={false} position={[0, 0, 0]}>
      <CuboidCollider
        args={[wallThickness / 2, halfHeight + wallThickness, wallDepth]}
        position={[-sideWallX, verticalCenter, 0]}
        friction={0.95}
        restitution={0.18}
      />
      <CuboidCollider
        args={[wallThickness / 2, halfHeight + wallThickness, wallDepth]}
        position={[sideWallX, verticalCenter, 0]}
        friction={0.95}
        restitution={0.18}
      />
      <CuboidCollider
        args={[horizontalHalfWidth, wallThickness / 2, wallDepth]}
        position={[0, topWallY, 0]}
        friction={0.95}
        restitution={0.18}
      />
      <CuboidCollider
        args={[horizontalHalfWidth, wallThickness / 2, wallDepth]}
        position={[0, bottomWallY, 0]}
        friction={1.35}
        restitution={0.06}
      />
      <CuboidCollider
        args={[depthWallHalfWidth, depthWallHalfHeight, wallThickness / 2]}
        position={[0, verticalCenter, frontWallZ]}
        friction={0.85}
        restitution={0.12}
      />
      <CuboidCollider
        args={[depthWallHalfWidth, depthWallHalfHeight, wallThickness / 2]}
        position={[0, verticalCenter, backWallZ]}
        friction={0.85}
        restitution={0.12}
      />
    </RigidBody>
  );
}

function PhysicsStage({ commandQueueRef, onState }: TumblerSceneProps) {
  return (
    <Physics gravity={[0, -9.81, 0]} timeStep="vary" interpolate={false}>
      <ambientLight intensity={1.35} color="#fff4f7" />
      <hemisphereLight args={["#fff8fb", "#87445b", 1.7]} />
      <directionalLight
        castShadow
        intensity={4.2}
        color="#ffffff"
        position={[-4, 7, 8]}
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight intensity={1.65} color="#d7eaff" position={[5, 3, -5]} />
      <pointLight intensity={1.3} color="#ffb8c9" distance={12} position={[-3, 1, 5]} />

      <BoundaryWalls />

      <TumblerBody commandQueueRef={commandQueueRef} onState={onState} />
    </Physics>
  );
}

export function TumblerScene({ commandQueueRef, onState }: TumblerSceneProps) {
  return <PhysicsStage commandQueueRef={commandQueueRef} onState={onState} />;
}
