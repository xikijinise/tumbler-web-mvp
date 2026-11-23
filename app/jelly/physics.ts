import type { SoftnessPreset } from "./flavors";

export type Vec3Tuple = [number, number, number];

export type JellyActionId =
  | "left"
  | "right"
  | "uppercut"
  | "stomp"
  | "spin"
  | "backhand"
  | "forward"
  | "super";

export type JellyPhysicsState = {
  // Base roly-poly transform (world space, y=0 rests on dessert plate)
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;

  // Low-center-of-gravity tumbler rotation (radians)
  tiltX: number;
  tiltZ: number;
  vTiltX: number;
  vTiltZ: number;
  yaw: number;
  vYaw: number;

  // Secondary jelly deformation springs (fed to GPU vertex shader)
  wobbleX: number;
  wobbleZ: number;
  vWobbleX: number;
  vWobbleZ: number;
  squash: number;
  vSquash: number;
  twist: number;
  vTwist: number;

  // Local surface poke / grab deformer (object space)
  grabActive: boolean;
  grabPoint: Vec3Tuple;
  grabTarget: Vec3Tuple;
  grabDisp: Vec3Tuple;
  grabVel: Vec3Tuple;

  // Surface impact ripple
  rippleOrigin: Vec3Tuple;
  rippleAmp: number;
  ripplePhase: number;

  // Suspended internal dog head lag
  coreX: number;
  coreY: number;
  coreZ: number;
  coreVX: number;
  coreVY: number;
  coreVZ: number;

  // Impact intensity for luminous glow
  energy: number;
};

export type StageBounds = {
  maxX: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

export type StepCallbacks = {
  onBounce?: (intensity: number) => void;
};

const MAX_TILT = 1.15;
const GRAVITY = 19.5;
const SUBSTEP = 1 / 120;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function createInitialPhysicsState(): JellyPhysicsState {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    tiltX: 0,
    tiltZ: 0,
    vTiltX: 0,
    vTiltZ: 0,
    yaw: 0,
    vYaw: 0,
    wobbleX: 0,
    wobbleZ: 0,
    vWobbleX: 0,
    vWobbleZ: 0,
    squash: 0,
    vSquash: 0,
    twist: 0,
    vTwist: 0,
    grabActive: false,
    grabPoint: [0, 0.1, 1.4],
    grabTarget: [0, 0, 0],
    grabDisp: [0, 0, 0],
    grabVel: [0, 0, 0],
    rippleOrigin: [0, 0.1, 1.4],
    rippleAmp: 0,
    ripplePhase: 0,
    coreX: 0,
    coreY: 0,
    coreZ: 0,
    coreVX: 0,
    coreVY: 0,
    coreVZ: 0,
    energy: 0,
  };
}

export function resetPhysicsState(state: JellyPhysicsState) {
  Object.assign(state, createInitialPhysicsState());
}

export function pokeJelly(
  state: JellyPhysicsState,
  localPoint: Vec3Tuple,
  localNormal: Vec3Tuple,
  strength: number,
  softness: SoftnessPreset,
) {
  const depth = 0.68 * strength * softness.pokeDepth;
  state.grabPoint = [localPoint[0], localPoint[1], localPoint[2]];
  state.grabVel[0] -= localNormal[0] * depth * 21;
  state.grabVel[1] -= localNormal[1] * depth * 21;
  state.grabVel[2] -= localNormal[2] * depth * 21;

  // Trigger concentric jelly ripple
  state.rippleOrigin = [localPoint[0], localPoint[1], localPoint[2]];
  state.rippleAmp = clamp(state.rippleAmp + 0.44 * strength * softness.wobbleGain, 0, 1.0);
  state.ripplePhase = 0;

  // Translate local poke into tumbler tilt, juicy wobble, and squash
  const heightFactor = clamp((localPoint[1] + 1.8) / 3.8, 0.2, 1.25);
  state.vTiltZ += localNormal[0] * 3.8 * strength * heightFactor;
  state.vTiltX -= localNormal[2] * 3.4 * strength * heightFactor;
  state.vx -= localNormal[0] * 1.5 * strength;
  state.vz -= localNormal[2] * 1.2 * strength;

  if (localNormal[1] > 0.35) {
    state.vSquash += 6.8 * strength * softness.wobbleGain;
  } else {
    state.vSquash += 2.3 * strength * softness.wobbleGain;
  }

  state.vWobbleX -= localNormal[0] * 4.8 * strength * softness.wobbleGain;
  state.vWobbleZ -= localNormal[2] * 4.8 * strength * softness.wobbleGain;
  state.vTwist += (localPoint[0] * localNormal[2] - localPoint[2] * localNormal[0]) * 3.2 * strength;
  state.energy = clamp(state.energy + 0.65 * strength, 0, 2.0);
}

export function startGrabJelly(state: JellyPhysicsState, localPoint: Vec3Tuple) {
  state.grabActive = true;
  state.grabPoint = [localPoint[0], localPoint[1], localPoint[2]];
  state.grabTarget = [0, 0, 0];
}

export function moveGrabJelly(
  state: JellyPhysicsState,
  worldDeltaX: number,
  worldDeltaY: number,
  softness: SoftnessPreset,
) {
  if (!state.grabActive) return;
  const maxStretch = 1.25 * softness.pokeDepth;
  const targetX = clamp(worldDeltaX * 0.62, -maxStretch, maxStretch);
  const targetY = clamp(worldDeltaY * 0.62, -maxStretch * 0.78, maxStretch);
  const targetZ = clamp(Math.hypot(targetX, targetY) * 0.2, 0, 0.4);

  state.grabTarget = [targetX, targetY, targetZ];

  // Pulling the jelly skin gently tugs and tilts the whole roly-poly
  state.vx += (worldDeltaX * 0.42 - state.x) * 0.08;
  state.vTiltZ -= worldDeltaX * 0.06;
  state.vTiltX += worldDeltaY * 0.035;
  if (worldDeltaY > 0.3) {
    state.vSquash -= worldDeltaY * 0.12;
  } else if (worldDeltaY < -0.18) {
    state.vSquash += Math.abs(worldDeltaY) * 0.18;
  }
  state.energy = clamp(state.energy + 0.035, 0, 1.5);
}

export function endGrabJelly(
  state: JellyPhysicsState,
  releaseVelX: number,
  releaseVelY: number,
  softness: SoftnessPreset,
) {
  if (!state.grabActive) return;
  state.grabActive = false;

  const stretchMag = Math.hypot(state.grabDisp[0], state.grabDisp[1], state.grabDisp[2]);
  // Juicy elastic snap-back impulse
  state.grabVel[0] -= state.grabDisp[0] * 17;
  state.grabVel[1] -= state.grabDisp[1] * 17;
  state.grabVel[2] -= state.grabDisp[2] * 17;
  state.grabTarget = [0, 0, 0];

  const flingX = clamp(releaseVelX * 0.75, -11, 11);
  const flingY = clamp(releaseVelY * 0.58, -5, 10.5);
  state.vx += flingX;
  if (flingY > 1.2) {
    state.vy += flingY;
  } else if (flingY < -1.0) {
    state.vSquash += Math.abs(flingY) * 1.5 * softness.wobbleGain;
  }
  state.vTiltZ -= flingX * 0.46;
  state.vYaw += clamp(flingX * 0.32, -5.5, 5.5);
  state.vWobbleX += (flingX * 0.42 + state.grabDisp[0] * 5.6) * softness.wobbleGain;
  state.vSquash += stretchMag * 4.2 * softness.wobbleGain;

  state.rippleOrigin = [...state.grabPoint];
  state.rippleAmp = clamp(0.36 + stretchMag * 0.62, 0, 1.0);
  state.ripplePhase = 0;
  state.energy = clamp(state.energy + 0.6 + stretchMag * 0.7, 0, 2.0);
}

export function applyJellyAction(
  state: JellyPhysicsState,
  action: JellyActionId,
  strength: number,
  softness: SoftnessPreset,
) {
  const s = strength;
  const g = softness.wobbleGain;
  switch (action) {
    case "left":
      state.vx -= 4.2 * s;
      state.vTiltZ += 4.8 * s;
      state.vWobbleX -= 5.4 * s * g;
      state.vYaw -= 1.2 * s;
      pokeJelly(state, [1.45, 0.15, 0.45], [0.9, 0.1, 0.3], 0.9 * s, softness);
      break;
    case "right":
      state.vx += 4.2 * s;
      state.vTiltZ -= 4.8 * s;
      state.vWobbleX += 5.4 * s * g;
      state.vYaw += 1.2 * s;
      pokeJelly(state, [-1.45, 0.15, 0.45], [-0.9, 0.1, 0.3], 0.9 * s, softness);
      break;
    case "uppercut":
      state.vy += 8.8 * s;
      state.vTiltX -= 2.4 * s;
      state.vSquash -= 5.2 * s * g;
      state.vWobbleZ += 3.2 * s * g;
      state.vYaw += 2.4 * s;
      break;
    case "stomp":
      state.vy -= 4.5 * s;
      state.vSquash += 9.4 * s * g;
      state.vTiltX += 1.6 * s;
      pokeJelly(state, [0, 1.85, 0.15], [0, 1, 0.08], 1.25 * s, softness);
      break;
    case "spin":
      state.vYaw += 11.0 * s;
      state.vTwist += 7.8 * s * g;
      state.vWobbleX += 2.6 * s * g;
      state.vSquash += 2.2 * s * g;
      break;
    case "backhand":
      state.vx += 6.2 * s;
      state.vy += 2.4 * s;
      state.vTiltZ -= 6.0 * s;
      state.vYaw += 4.8 * s;
      state.vWobbleX += 6.4 * s * g;
      break;
    case "forward":
      state.vz += 5.4 * s;
      state.vTiltX += 4.6 * s;
      state.vWobbleZ += 5.6 * s * g;
      pokeJelly(state, [0, 0.1, -1.35], [0, 0.1, -1], 1.05 * s, softness);
      break;
    case "super":
      state.vy += 9.8 * s;
      state.vx += (Math.random() - 0.5) * 6.5 * s;
      state.vYaw += 12.5 * s;
      state.vTiltZ += (Math.random() < 0.5 ? -1 : 1) * 6.4 * s;
      state.vSquash += 9.8 * s * g;
      state.vTwist += 8.5 * s * g;
      state.rippleOrigin = [0, 0.15, 1.35];
      state.rippleAmp = 1.0;
      state.ripplePhase = 0;
      break;
  }
  state.energy = clamp(state.energy + 0.75 * s, 0, 2.0);
}

export function stepJellyPhysics(
  state: JellyPhysicsState,
  rawDelta: number,
  softness: SoftnessPreset,
  bounds: StageBounds,
  callbacks?: StepCallbacks,
) {
  const clampedDelta = Math.min(rawDelta, 0.05);
  let remaining = clampedDelta;
  let steps = 0;

  while (remaining > 0.0001 && steps < 6) {
    const dt = Math.min(remaining, SUBSTEP);
    remaining -= dt;
    steps += 1;

    const prevVx = state.vx;
    const prevVz = state.vz;
    const prevVTiltX = state.vTiltX;
    const prevVTiltZ = state.vTiltZ;

    // 1. Tumbler base translation + gravity + gentle homing to center of plate
    const homingK = state.grabActive ? 1.2 : 3.8;
    const linearDamp = state.y > 0.01 ? 0.5 : 2.1;
    const ax = -state.x * homingK - state.vx * linearDamp;
    const az = -state.z * (homingK * 1.35) - state.vz * (linearDamp * 1.15);
    const ay = state.y > 0 || state.vy > 0 ? -GRAVITY : 0;

    state.vx += ax * dt;
    state.vy += ay * dt;
    state.vz += az * dt;

    state.x += state.vx * dt;
    state.y += state.vy * dt;
    state.z += state.vz * dt;

    // Plate contact -> elastic bounce + juicy gelatin squash!
    if (state.y < 0) {
      const impactSpeed = -state.vy;
      state.y = 0;
      if (impactSpeed > 0.75) {
        state.vy = impactSpeed * 0.36;
        const squashHit = clamp(impactSpeed * 1.05, 0, 10.0) * softness.wobbleGain;
        state.vSquash += squashHit;
        state.rippleOrigin = [0, -1.65, 0.3];
        state.rippleAmp = clamp(state.rippleAmp + impactSpeed * 0.075, 0, 1.0);
        state.ripplePhase = 0;
        if (impactSpeed > 1.6) {
          callbacks?.onBounce?.(clamp(impactSpeed / 8.5, 0.2, 1.25));
        }
      } else {
        state.vy = 0;
      }
    }

    // Ceiling & walls -> elastic jelly squish bounce
    if (state.y > bounds.maxY) {
      state.y = bounds.maxY;
      if (state.vy > 0) {
        state.vSquash += clamp(state.vy * 0.7, 0, 6) * softness.wobbleGain;
        state.vy = -state.vy * 0.35;
      }
    }
    if (Math.abs(state.x) > bounds.maxX) {
      const sign = Math.sign(state.x);
      const hitSpeed = Math.abs(state.vx);
      state.x = sign * bounds.maxX;
      state.vx = -state.vx * 0.5;
      state.vTiltZ += sign * clamp(hitSpeed * 0.58, 0.5, 4.8);
      state.vWobbleX -= sign * clamp(hitSpeed * 0.9, 0.5, 6.0) * softness.wobbleGain;
      state.vSquash += clamp(hitSpeed * 0.38, 0, 4.2) * softness.wobbleGain;
      if (hitSpeed > 1.5) {
        callbacks?.onBounce?.(clamp(hitSpeed / 9.5, 0.2, 1.15));
      }
    }
    if (state.z > bounds.maxZ || state.z < bounds.minZ) {
      const hitSpeed = Math.abs(state.vz);
      state.z = clamp(state.z, bounds.minZ, bounds.maxZ);
      state.vz = -state.vz * 0.45;
      state.vWobbleZ -= Math.sign(state.z) * clamp(hitSpeed * 0.7, 0, 4.8) * softness.wobbleGain;
    }

    // 2. Weighted-bottom roly-poly restoring torque
    const tiltK = 20.0;
    const tiltDamp = 2.35;
    const aTiltX = -Math.sin(state.tiltX) * tiltK - state.vTiltX * tiltDamp + az * 0.15;
    const aTiltZ = -Math.sin(state.tiltZ) * tiltK - state.vTiltZ * tiltDamp - ax * 0.15;

    state.vTiltX += aTiltX * dt;
    state.vTiltZ += aTiltZ * dt;
    state.tiltX = clamp(state.tiltX + state.vTiltX * dt, -MAX_TILT, MAX_TILT);
    state.tiltZ = clamp(state.tiltZ + state.vTiltZ * dt, -MAX_TILT, MAX_TILT);

    if (state.y < 0.02) {
      state.x = clamp(state.x - state.vTiltZ * 0.22 * dt, -bounds.maxX, bounds.maxX);
    }

    const yawError = Math.atan2(Math.sin(state.yaw), Math.cos(state.yaw));
    const aYaw = -yawError * 3.6 - state.vYaw * 2.3;
    state.vYaw += aYaw * dt;
    state.yaw += state.vYaw * dt;

    // 3. Secondary Jelly Wobble (juicy gelatin inertia lag)
    const accelX = (state.vx - prevVx) / dt;
    const accelZ = (state.vz - prevVz) / dt;
    const angAccX = (state.vTiltX - prevVTiltX) / dt;
    const angAccZ = (state.vTiltZ - prevVTiltZ) / dt;

    const wobbleDriveX = clamp((-accelX * 0.058 + angAccZ * 0.095) * softness.wobbleGain, -22, 22);
    const wobbleDriveZ = clamp((-accelZ * 0.058 - angAccX * 0.095) * softness.wobbleGain, -22, 22);

    const aWobbleX =
      -state.wobbleX * softness.wobbleStiffness -
      state.vWobbleX * softness.wobbleDamping +
      wobbleDriveX;
    const aWobbleZ =
      -state.wobbleZ * softness.wobbleStiffness -
      state.vWobbleZ * softness.wobbleDamping +
      wobbleDriveZ;

    state.vWobbleX += aWobbleX * dt;
    state.vWobbleZ += aWobbleZ * dt;
    state.wobbleX = clamp(state.wobbleX + state.vWobbleX * dt, -1.05, 1.05);
    state.wobbleZ = clamp(state.wobbleZ + state.vWobbleZ * dt, -1.05, 1.05);

    // 4. Volume-preserving Squash & Stretch harmonic oscillator
    const aSquash =
      -state.squash * softness.squashStiffness - state.vSquash * softness.squashDamping;
    state.vSquash += aSquash * dt;
    state.squash = clamp(state.squash + state.vSquash * dt, -0.42, 0.46);

    // 5. Torsional jelly twist jiggle
    const aTwist =
      -state.twist * (softness.wobbleStiffness * 1.05) -
      state.vTwist * (softness.wobbleDamping * 1.05);
    state.vTwist += aTwist * dt;
    state.twist = clamp(state.twist + state.vTwist * dt, -0.85, 0.85);

    // 6. Local poke / grab surface spring
    const grabK = state.grabActive ? softness.grabStiffness * 1.6 : softness.grabStiffness;
    const grabD = state.grabActive ? softness.grabDamping * 1.85 : softness.grabDamping * 0.68;
    for (let i = 0; i < 3; i += 1) {
      const a = (state.grabTarget[i] - state.grabDisp[i]) * grabK - state.grabVel[i] * grabD;
      state.grabVel[i] += a * dt;
      state.grabDisp[i] = clamp(state.grabDisp[i] + state.grabVel[i] * dt, -1.35, 1.35);
    }

    // 7. Surface impact ripple decay
    if (state.rippleAmp > 0.001) {
      state.ripplePhase += dt * 18.5;
      state.rippleAmp *= Math.exp(-dt * 3.8);
    } else {
      state.rippleAmp = 0;
    }

    // 8. Suspended internal pixel dog core (floats gently inside the jelly!)
    const targetCoreX = state.wobbleX * 0.48 + state.grabDisp[0] * 0.24;
    const targetCoreY = -state.squash * 0.38 + state.grabDisp[1] * 0.24;
    const targetCoreZ = state.wobbleZ * 0.48 + state.grabDisp[2] * 0.2;
    const coreK = softness.wobbleStiffness * 0.62;
    const coreD = softness.wobbleDamping * 1.05;

    state.coreVX += ((targetCoreX - state.coreX) * coreK - state.coreVX * coreD) * dt;
    state.coreVY += ((targetCoreY - state.coreY) * coreK - state.coreVY * coreD) * dt;
    state.coreVZ += ((targetCoreZ - state.coreZ) * coreK - state.coreVZ * coreD) * dt;
    state.coreX = clamp(state.coreX + state.coreVX * dt, -0.5, 0.5);
    state.coreY = clamp(state.coreY + state.coreVY * dt, -0.5, 0.5);
    state.coreZ = clamp(state.coreZ + state.coreVZ * dt, -0.5, 0.5);

    state.energy = Math.max(0, state.energy - dt * 1.5);
  }
}
