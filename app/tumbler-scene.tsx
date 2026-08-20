"use client";

/* eslint-disable react/no-unknown-property -- React Three Fiber JSX props. */

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BallCollider,
  CapsuleCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import * as THREE from "three";

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
  | { id: number; type: "reset" };

type TumblerSceneProps = {
  commandQueueRef: { current: PhysicsCommand[] };
  onState: (state: PhysicsState) => void;
};

const INITIAL_POSITION = { x: 0, y: 0, z: 0 };
const INITIAL_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function applyHit(
  body: RapierRigidBody,
  action: PhysicsAction,
  strength: number,
  point: { x: number; y: number } | undefined,
  impactRef: { current: number },
) {
  const intensity = action.force * strength;
  const pointX = point ? (point.x - 50) / 50 : 0;
  const pointY = point ? (50 - point.y) / 50 : 0;
  const impulse = {
    x: clamp((action.x * 0.08 + pointX * 0.9) * intensity, -4, 4),
    y: clamp((action.jump * 0.18 + pointY * 0.8) * intensity, -4.5, 4.5),
    z: clamp((action.depth * 0.14 + pointY * 0.6) * intensity, -6, 6),
  };
  const torque = {
    x: clamp(action.jump * 0.06 * intensity, -1.8, 1.8),
    y: clamp(action.spin * 0.1 * intensity, -2.5, 2.5),
    z: clamp((action.angle * 0.45 + pointX * 0.9) * intensity, -5.2, 5.2),
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
      x: clamp(dx * 0.018, -0.6, 0.6),
      y: clamp(-dy * 0.008, -0.35, 0.35),
      z: clamp(dy * 0.014, -0.5, 0.5),
    },
    true,
  );
  body.applyTorqueImpulse(
    {
      x: clamp(-dy * 0.008, -0.36, 0.36),
      y: clamp(dx * 0.008, -0.36, 0.36),
      z: clamp(dx * 0.01, -0.35, 0.35),
    },
    true,
  );
  impactRef.current = Math.max(
    impactRef.current,
    clamp((Math.abs(dx) + Math.abs(dy) * 0.7) / 17, 0, 1.2),
  );
}

function applyRelease(body: RapierRigidBody, totalX: number, totalY: number, impactRef: { current: number }) {
  body.wakeUp();
  body.applyImpulse(
    {
      x: clamp(totalX * 0.1, -8, 8),
      y: clamp(-totalY * 0.04, -3.2, 3.2),
      z: clamp(totalY * 0.08, -6, 6),
    },
    true,
  );
  body.applyTorqueImpulse(
    {
      x: clamp(-totalY * 0.05, -2.5, 2.5),
      y: clamp(totalX * 0.04, -2, 2),
      z: clamp(totalX * 0.025, -2, 2),
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
  const impactRef = useRef(0);
  const reportClockRef = useRef(0);
  const lastReportRef = useRef<PhysicsState | null>(null);
  const uprightQuaternionRef = useRef(new THREE.Quaternion());
  const uprightEulerRef = useRef(new THREE.Euler());
  const bodyProfile = useMemo(
    () => [
      new THREE.Vector2(0.02, -1.9),
      new THREE.Vector2(0.58, -1.88),
      new THREE.Vector2(0.96, -1.64),
      new THREE.Vector2(1.12, -1.15),
      new THREE.Vector2(1.17, -0.45),
      new THREE.Vector2(1.1, 0.22),
      new THREE.Vector2(0.93, 0.82),
      new THREE.Vector2(0.79, 1.2),
      new THREE.Vector2(0.76, 1.46),
    ],
    [],
  );

  const capProfile = useMemo(
    () => [
      new THREE.Vector2(0.02, 1.43),
      new THREE.Vector2(0.5, 1.47),
      new THREE.Vector2(0.78, 1.62),
      new THREE.Vector2(0.83, 1.86),
      new THREE.Vector2(0.66, 2.16),
      new THREE.Vector2(0.36, 2.35),
      new THREE.Vector2(0.02, 2.42),
    ],
    [],
  );

  useFrame((_, delta) => {
    const body = bodyRef.current;
    if (!body) return;

    while (commandQueueRef.current.length > 0) {
      const command = commandQueueRef.current.shift();
      if (!command) break;
      if (command.type === "hit") {
        applyHit(body, command.action, command.strength, command.point, impactRef);
      } else if (command.type === "drag") {
        applyDrag(body, command.dx, command.dy, impactRef);
      } else if (command.type === "release") {
        applyRelease(body, command.totalX, command.totalY, impactRef);
      } else {
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

    const boundedZ = clamp(translation.z, -4.2, 3.1);
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

    impactRef.current = Math.max(0, impactRef.current - delta * 2.4);
    reportClockRef.current += delta;
    if (reportClockRef.current < 1 / 30 && lastReportRef.current) return;
    reportClockRef.current = 0;

    const euler = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
      "XYZ",
    );
    const signedTilt = Math.sign(euler.z || euler.x || 1) *
      THREE.MathUtils.radToDeg(Math.hypot(euler.x, euler.z));
    const state: PhysicsState = {
      angle: clamp(signedTilt, -89, 89),
      angularVelocity: THREE.MathUtils.radToDeg(
        Math.sign(angularVelocity.z || angularVelocity.x || 1) *
          Math.hypot(angularVelocity.x, angularVelocity.z),
      ),
      impact: impactRef.current,
      z: translation.z * 76,
      vz: linearVelocity.z * 76,
      x: translation.x * 20,
      vx: linearVelocity.x * 20,
      y: translation.y * 16,
      vy: linearVelocity.y * 16,
    };
    lastReportRef.current = state;
    onState(state);
  });

  return (
    <RigidBody
      ref={bodyRef}
      colliders={false}
      position={[0, 0, 0]}
      linearDamping={0.42}
      angularDamping={1.25}
      canSleep={false}
      friction={0.9}
      restitution={0.08}
    >
      <group scale={1.12}>
        <mesh castShadow receiveShadow>
          <latheGeometry args={[bodyProfile, 96]} />
          <meshStandardMaterial color="#e9e2cd" roughness={0.25} metalness={0.02} />
        </mesh>

        <mesh castShadow receiveShadow position={[0, -1.42, 0]} scale={[1, 0.62, 1]}>
          <sphereGeometry args={[1.15, 96, 48]} />
          <meshStandardMaterial color="#303631" roughness={0.38} metalness={0.12} />
        </mesh>

        <mesh castShadow receiveShadow>
          <latheGeometry args={[capProfile, 96]} />
          <meshStandardMaterial color="#c94f44" roughness={0.23} metalness={0.04} />
        </mesh>

        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 1.46, 0]}>
          <torusGeometry args={[0.8, 0.065, 20, 96]} />
          <meshStandardMaterial color="#a63832" roughness={0.28} metalness={0.08} />
        </mesh>

        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 1.34, 0]}>
          <torusGeometry args={[0.78, 0.018, 12, 96]} />
          <meshStandardMaterial color="#b8b09f" roughness={0.5} metalness={0.04} />
        </mesh>
      </group>

      <BallCollider
        args={[1.08]}
        position={[0, -1.32, 0]}
        density={1.4}
        friction={1.3}
        restitution={0.05}
      />
      <CapsuleCollider
        args={[1.1, 0.88]}
        position={[0, 0.25, 0]}
        density={0.18}
        friction={0.82}
        restitution={0.08}
      />
    </RigidBody>
  );
}

function BoundaryWalls() {
  const { viewport } = useThree();
  const halfWidth = Math.max(viewport.width * 0.5, 2.8);
  const halfHeight = Math.max(viewport.height * 0.5, 3.2);
  const verticalCenter = 0.15;
  const wallThickness = 0.16;
  const wallDepth = 20;
  const horizontalHalfWidth = halfWidth + wallThickness;

  return (
    <RigidBody type="fixed" colliders={false} position={[0, 0, 0]}>
      <CuboidCollider
        args={[wallThickness / 2, halfHeight + wallThickness, wallDepth]}
        position={[-halfWidth - wallThickness / 2, verticalCenter, 0]}
        friction={0.95}
        restitution={0.18}
      />
      <CuboidCollider
        args={[wallThickness / 2, halfHeight + wallThickness, wallDepth]}
        position={[halfWidth + wallThickness / 2, verticalCenter, 0]}
        friction={0.95}
        restitution={0.18}
      />
      <CuboidCollider
        args={[horizontalHalfWidth, wallThickness / 2, wallDepth]}
        position={[0, verticalCenter + halfHeight + wallThickness / 2, 0]}
        friction={0.95}
        restitution={0.18}
      />
      <CuboidCollider
        args={[horizontalHalfWidth, wallThickness / 2, wallDepth]}
        position={[0, -2.47, 0]}
        friction={1.35}
        restitution={0.06}
      />
    </RigidBody>
  );
}

function PhysicsStage({ commandQueueRef, onState }: TumblerSceneProps) {
  return (
    <Physics gravity={[0, -9.81, 0]} timeStep="vary" interpolate={false}>
      <ambientLight intensity={1.7} color="#fff8e9" />
      <hemisphereLight args={["#fff8e9", "#59645b", 1.9]} />
      <directionalLight
        castShadow
        intensity={4.1}
        color="#ffffff"
        position={[-4, 7, 8]}
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight intensity={2.1} color="#cfe9ff" position={[5, 3, -5]} />
      <pointLight intensity={1.45} color="#ffb16c" distance={12} position={[-3, 1, 5]} />

      <BoundaryWalls />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.38, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#f3f2eb" roughness={0.92} transparent opacity={0.68} />
      </mesh>

      <TumblerBody commandQueueRef={commandQueueRef} onState={onState} />
    </Physics>
  );
}

export function TumblerScene({ commandQueueRef, onState }: TumblerSceneProps) {
  return <PhysicsStage commandQueueRef={commandQueueRef} onState={onState} />;
}
