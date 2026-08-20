"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import {
  TumblerScene,
  type PhysicsAction,
  type PhysicsCommand,
  type PhysicsState,
} from "./tumbler-scene";

type ActionId =
  | "left"
  | "right"
  | "uppercut"
  | "stomp"
  | "spin"
  | "backhand"
  | "forward"
  | "super";

type ActionDefinition = PhysicsAction & {
  id: ActionId;
  label: string;
  key: string;
  hint: string;
  symbol: string;
  tone: string;
};

type ActionLog = {
  id: number;
  label: string;
  key: string;
  detail: string;
  tone: string;
};

type FloatingEffect = {
  id: number;
  label: string;
  x: number;
  y: number;
  tone: string;
};

const ACTIONS: ActionDefinition[] = [
  {
    id: "left",
    label: "左拳",
    key: "A",
    hint: "向左压倒",
    symbol: "←",
    tone: "coral",
    force: 1,
    angle: -5.4,
    spin: -1.5,
    depth: 16,
    x: -8,
    jump: 0,
  },
  {
    id: "right",
    label: "右拳",
    key: "D",
    hint: "向右压倒",
    symbol: "→",
    tone: "lime",
    force: 1,
    angle: 5.4,
    spin: 1.5,
    depth: 16,
    x: 8,
    jump: 0,
  },
  {
    id: "uppercut",
    label: "上勾拳",
    key: "W",
    hint: "抬起重心",
    symbol: "↟",
    tone: "sun",
    force: 1.1,
    angle: 1.2,
    spin: 3.4,
    depth: 10,
    x: 1,
    jump: 18,
  },
  {
    id: "stomp",
    label: "下砸",
    key: "S",
    hint: "制造震动",
    symbol: "↡",
    tone: "violet",
    force: 1.15,
    angle: -2.5,
    spin: -6,
    depth: -18,
    x: 0,
    jump: -10,
  },
  {
    id: "spin",
    label: "回旋击",
    key: "Q",
    hint: "加速旋转",
    symbol: "◌",
    tone: "cyan",
    force: 1.25,
    angle: 0,
    spin: 10,
    depth: 6,
    x: 2,
    jump: 0,
  },
  {
    id: "backhand",
    label: "反手扫",
    key: "E",
    hint: "横向甩开",
    symbol: "↝",
    tone: "orange",
    force: 1.1,
    angle: 6.8,
    spin: 4.2,
    depth: 22,
    x: 12,
    jump: 3,
  },
  {
    id: "forward",
    label: "前推",
    key: "F",
    hint: "朝我这边",
    symbol: "⊙",
    tone: "cyan",
    force: 1.2,
    angle: 0,
    spin: 0.8,
    depth: 92,
    x: 0,
    jump: 2,
  },
  {
    id: "super",
    label: "超载冲击",
    key: "SPACE",
    hint: "一次性爆发",
    symbol: "✦",
    tone: "charcoal",
    force: 1.45,
    angle: -4,
    spin: 13,
    depth: 72,
    x: -6,
    jump: 14,
  },
];

const INITIAL_PHYSICS: PhysicsState = {
  angle: 0,
  angularVelocity: 0,
  impact: 0,
  z: 0,
  vz: 0,
  x: 0,
  vx: 0,
  y: 0,
  vy: 0,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function makeInitialLog(): ActionLog[] {
  return [
    {
      id: 0,
      label: "待命",
      key: "READY",
      detail: "等待第一次受力",
      tone: "muted",
    },
  ];
}

export default function Home() {
  const stageRef = useRef<HTMLDivElement>(null);
  const physicsCommandQueueRef = useRef<PhysicsCommand[]>([]);
  const actionIdRef = useRef(1);
  const comboRef = useRef(0);
  const lastHitRef = useRef(0);
  const flashTimeoutRef = useRef<number | null>(null);
  const dragRef = useRef({
    active: false,
    moved: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  });

  const [display, setDisplay] = useState<PhysicsState>({ ...INITIAL_PHYSICS });
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [lastImpact, setLastImpact] = useState("待命");
  const [history, setHistory] = useState<ActionLog[]>(makeInitialLog);
  const [effects, setEffects] = useState<FloatingEffect[]>([]);
  const [impactFlash, setImpactFlash] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const stability = useMemo(
    () =>
      Math.round(
        clamp(
          100 -
            Math.abs(display.angle) * 0.72 -
            Math.abs(display.angularVelocity) * 0.045 -
            Math.abs(display.z) * 0.018,
          0,
          100,
        ),
      ),
    [display],
  );

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current !== null) window.clearTimeout(flashTimeoutRef.current);
    };
  }, []);

  const pushLog = useCallback((entry: Omit<ActionLog, "id">) => {
    const id = actionIdRef.current++;
    setHistory((current) => [{ ...entry, id }, ...current].slice(0, 5));
  }, []);

  const spawnEffect = useCallback((label: string, tone: string, x: number) => {
    const id = actionIdRef.current++;
    const effect = {
      id,
      label,
      x: clamp(50 + x * 0.18, 27, 73),
      y: 38 + Math.random() * 8,
      tone,
    };
    setEffects((current) => [...current, effect]);
    window.setTimeout(() => {
      setEffects((current) => current.filter((item) => item.id !== id));
    }, 680);
  }, []);

  const triggerFlash = useCallback(() => {
    setImpactFlash(true);
    if (flashTimeoutRef.current !== null) window.clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = window.setTimeout(() => setImpactFlash(false), 130);
  }, []);

  const resetLab = useCallback(() => {
    physicsCommandQueueRef.current.push({ id: actionIdRef.current++, type: "reset" });
    setDisplay({ ...INITIAL_PHYSICS });
    comboRef.current = 0;
    setCombo(0);
    setLastImpact("归位完成");
    setEffects([]);
    pushLog({
      label: "归零",
      key: "R",
      detail: "Rapier 刚体恢复到平衡点",
      tone: "muted",
    });
  }, [pushLog]);

  const registerAction = useCallback(
    (
      actionId: ActionId,
      strength = 1,
      point?: { x: number; y: number },
    ) => {
      const action = ACTIONS.find((item) => item.id === actionId);
      if (!action) return;

      const now = window.performance.now();
      const isChain = now - lastHitRef.current < 900;
      const nextCombo = isChain ? comboRef.current + 1 : 1;
      comboRef.current = nextCombo;
      lastHitRef.current = now;
      setCombo(nextCombo);
      setBestCombo((current) => Math.max(current, nextCombo));

      physicsCommandQueueRef.current.push({
        id: actionIdRef.current++,
        type: "hit",
        action,
        strength,
        point,
      });
      setLastImpact(action.label);
      pushLog({
        label: action.label,
        key: action.key,
        detail: `${nextCombo > 1 ? `连击 ×${nextCombo} · ` : ""}${action.hint}`,
        tone: action.tone,
      });
      spawnEffect(
        nextCombo > 1 ? `COMBO ×${nextCombo}` : action.label,
        action.tone,
        display.x + action.x,
      );
      triggerFlash();
    },
    [display.x, pushLog, spawnEffect, triggerFlash],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      const match: ActionId | null =
        key === "a"
          ? "left"
          : key === "d"
            ? "right"
            : key === "w"
              ? "uppercut"
              : key === "s"
                ? "stomp"
                : key === "q"
                  ? "spin"
                  : key === "e"
                    ? "backhand"
                    : key === "f"
                      ? "forward"
                      : event.code === "Space"
                        ? "super"
                        : null;

      if (match) {
        event.preventDefault();
        registerAction(match);
      } else if (key === "r") {
        event.preventDefault();
        resetLab();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [registerAction, resetLab]);

  const handleStagePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("button")) return;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;

      const side = event.clientX < rect.left + rect.width / 2 ? "left" : "right";
      const point = {
        x: ((event.clientX - rect.left) / rect.width) * 100,
        y: ((event.clientY - rect.top) / rect.height) * 100,
      };
      registerAction(side, 0.72, point);
      dragRef.current = {
        active: true,
        moved: false,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      setIsDragging(false);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [registerAction],
  );

  const handleStagePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    const totalX = event.clientX - drag.startX;
    const totalY = event.clientY - drag.startY;
    if (Math.abs(totalX) + Math.abs(totalY) > 8) {
      drag.moved = true;
      setIsDragging(true);
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (drag.moved) {
      physicsCommandQueueRef.current.push({
        id: actionIdRef.current++,
        type: "drag",
        dx,
        dy,
      });
    }
  }, []);

  const handleStagePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag.active || drag.pointerId !== event.pointerId) return;

      if (drag.moved) {
        const totalX = event.clientX - drag.startX;
        const totalY = event.clientY - drag.startY;
        physicsCommandQueueRef.current.push({
          id: actionIdRef.current++,
          type: "release",
          totalX,
          totalY,
        });
        setLastImpact("拖拽甩动");
        pushLog({
          label: "拖拽甩动",
          key: "MOUSE",
          detail: "松开，把真实冲量甩出去",
          tone: "cyan",
        });
        spawnEffect("FLING", "cyan", display.x + totalX * 0.2);
        triggerFlash();
      }

      dragRef.current.active = false;
      dragRef.current.moved = false;
      setIsDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [display.x, pushLog, spawnEffect, triggerFlash],
  );

  return (
    <main className="experiment-shell">
      <section
        className={`experiment-board ${impactFlash ? "is-flashing" : ""} ${
          isDragging ? "is-dragging" : ""
        }`}
        ref={stageRef}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerUp}
        role="application"
        aria-label="不倒翁打击实验台，点击或拖拽来施加真实三维力量"
      >
        <div className="board-texture" aria-hidden="true" />
        <header className="corner corner-brand">
          <p className="corner-overline">ROLY-POLY / TEST 02</p>
          <h1>不倒翁<br /><em>打击实验</em></h1>
          <span className="brand-rule" />
        </header>

        <aside className="corner corner-status" aria-label="实时状态">
          <div className="corner-live"><span className="live-dot" /> LIVE / RAPIER 3D</div>
          <div className="mini-metrics">
            <div><span>稳定</span><strong>{stability}%</strong></div>
            <div><span>角度</span><strong>{display.angle >= 0 ? "+" : ""}{display.angle.toFixed(1)}°</strong></div>
            <div><span>连击</span><strong className={combo > 1 ? "is-accent" : ""}>×{combo}</strong></div>
          </div>
          <div className="momentum-line"><span style={{ width: `${clamp(Math.abs(display.angularVelocity) * 1.4, 4, 100)}%` }} /></div>
          <div className="depth-readout"><span>Z DEPTH</span><strong>{display.z >= 0 ? "+" : ""}{display.z.toFixed(0)} px · {display.z > 10 ? "靠近" : display.z < -10 ? "远离" : "中性"}</strong></div>
          <div className="status-foot"><span>LAST IMPACT</span><strong>{lastImpact}</strong></div>
          <button className="reset-corner" onClick={resetLab} type="button" aria-label="重新归零">
            ↺ <kbd>R</kbd>
          </button>
        </aside>

        <div className="subject-zone" aria-hidden="true">
          <div className="three-stage" data-physics="react-three-rapier" data-x-position={display.x.toFixed(2)}>
            <Canvas
              dpr={[1, 2]}
              camera={{ position: [0, 0.35, 10.5], fov: 34, near: 0.1, far: 100 }}
              shadows
              gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
              onCreated={({ gl }) => {
                gl.setClearColor(0x000000, 0);
                gl.outputColorSpace = THREE.SRGBColorSpace;
                gl.toneMapping = THREE.ACESFilmicToneMapping;
                gl.toneMappingExposure = 1.12;
              }}
              style={{ pointerEvents: "none" }}
            >
              <TumblerScene commandQueueRef={physicsCommandQueueRef} onState={setDisplay} />
            </Canvas>
          </div>
          {effects.map((effect) => (
            <span
              className={`floating-effect effect-${effect.tone}`}
              key={effect.id}
              style={{ left: `${effect.x}%`, top: `${effect.y}%` }}
            >
              {effect.label}
            </span>
          ))}
          <span className="drag-caption">{isDragging ? "RELEASE TO FLING" : "CLICK / DRAG"}</span>
        </div>

        <div className="corner corner-help">
          <button
            className={`help-trigger ${helpOpen ? "is-open" : ""}`}
            onClick={() => setHelpOpen((open) => !open)}
            type="button"
            aria-expanded={helpOpen}
            aria-controls="help-panel"
          >
            <span>?</span> 操作说明
          </button>
          {helpOpen && (
            <div className="help-panel" id="help-panel" role="dialog" aria-label="操作说明">
              <div className="help-heading"><strong>INPUT / ACTIONS</strong><button onClick={() => setHelpOpen(false)} type="button" aria-label="关闭说明">×</button></div>
              <p>页面四边都是 Rapier 碰撞墙；动作会施加真实冲量和扭矩，拖拽松开后会把惯性甩出去，F 键会把它推向你。</p>
              <div className="help-action-list">
                {ACTIONS.map((action) => (
                  <button className={`help-action help-${action.tone}`} key={action.id} onClick={() => registerAction(action.id)} type="button">
                    <kbd>{action.key}</kbd><span>{action.label}</span><small>{action.hint}</small>
                  </button>
                ))}
              </div>
              <div className="help-reset"><kbd>R</kbd><span>回到平衡点</span></div>
            </div>
          )}
        </div>

        <aside className="corner corner-replay" aria-label="动作回放">
          <div className="replay-heading"><span>动作回放</span><small>{history.length.toString().padStart(2, "0")} EVENTS</small></div>
          <div className="replay-list">
            {history.slice(0, 3).map((entry) => (
              <div className={`replay-row replay-${entry.tone}`} key={entry.id}>
                <span className="replay-dot" />
                <strong>{entry.label}</strong>
                <span>{entry.key}</span>
              </div>
            ))}
          </div>
          <div className="replay-best">BEST COMBO <strong>×{bestCombo}</strong></div>
        </aside>

        <div className="corner corner-hint" aria-hidden="true">
          <span className="hint-dot" />
          <span>失衡是反馈，不是失败</span>
        </div>
      </section>
    </main>
  );
}
