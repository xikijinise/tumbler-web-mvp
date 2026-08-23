"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import {
  TumblerScene,
  type PhysicsAction,
  type PhysicsCommand,
  type PhysicsState,
  type TumblerAppearance,
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

type AppearancePart = keyof TumblerAppearance;

type TumblerSettings = {
  sayings: string[];
  appearance: TumblerAppearance;
};

const SETTINGS_STORAGE_KEY = "tumbler-web-mvp-settings-v2";
const HISTORY_COUNT_STORAGE_KEY = "tumbler-web-mvp-history-count-v1";
const DEFAULT_SAYINGS = ["等等就好了", "明天就好了", "再等等", "已经让人处理了"];
const DEFAULT_APPEARANCE: TumblerAppearance = {
  headImage: "custom-character.png",
  middleImage: "custom-character.png",
  baseImage: null,
};
const IMAGE_PARTS: Array<{ id: AppearancePart; label: string; hint: string }> = [
  { id: "headImage", label: "头部", hint: "帽子 / 头部贴图" },
  { id: "middleImage", label: "中段", hint: "身体中段贴图" },
  { id: "baseImage", label: "底部", hint: "底座贴图" },
];
const MAX_CUSTOM_IMAGE_BYTES = 4 * 1024 * 1024;

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

const INPUT_REPEAT_INTERVAL_MS = 140;
const AUTO_RETURN_DELAY_MS = 3600;

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

function normalizeSayings(value: unknown) {
  if (!Array.isArray(value)) return [...DEFAULT_SAYINGS];
  const sayings = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  return sayings.length > 0 ? sayings : [...DEFAULT_SAYINGS];
}

function normalizeImage(value: unknown) {
  return typeof value === "string" && (value.startsWith("data:image/") || value.startsWith("custom-character.png"))
    ? value
    : null;
}

function normalizeHistoryCount(value: string | null) {
  const count = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function parseStoredSettings(raw: string | null): TumblerSettings {
  if (!raw) {
    return { sayings: [...DEFAULT_SAYINGS], appearance: { ...DEFAULT_APPEARANCE } };
  }

  try {
    const parsed = JSON.parse(raw) as {
      sayings?: unknown;
      appearance?: Partial<Record<AppearancePart, unknown>>;
    };
    return {
      sayings: normalizeSayings(parsed.sayings),
      appearance: {
        headImage: normalizeImage(parsed.appearance?.headImage),
        middleImage: normalizeImage(parsed.appearance?.middleImage),
        baseImage: normalizeImage(parsed.appearance?.baseImage),
      },
    };
  } catch {
    return { sayings: [...DEFAULT_SAYINGS], appearance: { ...DEFAULT_APPEARANCE } };
  }
}

export default function Home() {
  const stageRef = useRef<HTMLDivElement>(null);
  const physicsCommandQueueRef = useRef<PhysicsCommand[]>([]);
  const actionIdRef = useRef(1);
  const comboRef = useRef(0);
  const lastHitRef = useRef(0);
  const lastInputAtRef = useRef(0);
  const autoReturnArmedRef = useRef(false);
  const settingsLoadedRef = useRef(false);
  const pointerRepeatTimerRef = useRef<number | null>(null);
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
  const [totalInputCount, setTotalInputCount] = useState(0);
  const totalInputCountRef = useRef(0);
  const [effects, setEffects] = useState<FloatingEffect[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<TumblerSettings>({
    sayings: [...DEFAULT_SAYINGS],
    appearance: { ...DEFAULT_APPEARANCE },
  });
  const [sayingsDraft, setSayingsDraft] = useState(DEFAULT_SAYINGS.join("\n"));
  const [speechText, setSpeechText] = useState(DEFAULT_SAYINGS[0]);
  const [settingsNotice, setSettingsNotice] = useState("");

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
    const loadTimer = window.setTimeout(() => {
      const storedSettings = parseStoredSettings(window.localStorage.getItem(SETTINGS_STORAGE_KEY));
      setSettings(storedSettings);
      setSayingsDraft(storedSettings.sayings.join("\n"));
      const storedCount = normalizeHistoryCount(window.localStorage.getItem(HISTORY_COUNT_STORAGE_KEY));
      totalInputCountRef.current = storedCount;
      setTotalInputCount(storedCount);
      settingsLoadedRef.current = true;
    }, 0);

    return () => window.clearTimeout(loadTimer);
  }, []);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    let noticeTimer: number | undefined;
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      noticeTimer = window.setTimeout(() => {
        setSettingsNotice("设置已应用，但图片太大，无法持久保存");
      }, 0);
    }

    return () => {
      if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
    };
  }, [settings]);

  const pickSaying = useCallback(() => {
    const sayings = settings.sayings.length > 0 ? settings.sayings : DEFAULT_SAYINGS;
    return sayings[Math.floor(Math.random() * sayings.length)];
  }, [settings.sayings]);

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

  const stopPointerRepeat = useCallback(() => {
    if (pointerRepeatTimerRef.current !== null) {
      window.clearInterval(pointerRepeatTimerRef.current);
      pointerRepeatTimerRef.current = null;
    }
  }, []);

  const noteInput = useCallback(() => {
    lastInputAtRef.current = window.performance.now();
    autoReturnArmedRef.current = true;
  }, []);

  const recordInput = useCallback(() => {
    const nextCount = Math.min(totalInputCountRef.current + 1, Number.MAX_SAFE_INTEGER);
    totalInputCountRef.current = nextCount;
    setTotalInputCount(nextCount);
    try {
      window.localStorage.setItem(HISTORY_COUNT_STORAGE_KEY, String(nextCount));
    } catch {
      // The counter still works for this session when persistence is unavailable.
    }
  }, []);

  const resetLab = useCallback(() => {
    lastInputAtRef.current = window.performance.now();
    autoReturnArmedRef.current = false;
    stopPointerRepeat();
    physicsCommandQueueRef.current.push({ id: actionIdRef.current++, type: "reset" });
    setDisplay({ ...INITIAL_PHYSICS });
    comboRef.current = 0;
    setCombo(0);
    setLastImpact("归位完成");
    setSpeechText("回到平衡点");
    setEffects([]);
    pushLog({
      label: "归零",
      key: "R",
      detail: "Rapier 刚体恢复到平衡点",
      tone: "muted",
    });
  }, [pushLog, stopPointerRepeat]);

  const autoReturn = useCallback(() => {
    lastInputAtRef.current = window.performance.now();
    autoReturnArmedRef.current = false;
    stopPointerRepeat();
    physicsCommandQueueRef.current.push({ id: actionIdRef.current++, type: "return" });
    comboRef.current = 0;
    setCombo(0);
    setLastImpact("自动归位");
    setSpeechText(pickSaying());
    setEffects([]);
    pushLog({
      label: "自动归位",
      key: "AUTO",
      detail: "无输入一段时间，慢慢返回初始位置",
      tone: "muted",
    });
  }, [pickSaying, pushLog, stopPointerRepeat]);

  const registerAction = useCallback(
    (
      actionId: ActionId,
      strength = 1,
      point?: { x: number; y: number },
    ) => {
      const action = ACTIONS.find((item) => item.id === actionId);
      if (!action) return;
      noteInput();
      recordInput();

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
      setSpeechText(pickSaying());
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
    },
    [display.x, noteInput, pickSaying, pushLog, recordInput, spawnEffect],
  );

  const registerActionRef = useRef(registerAction);

  useEffect(() => {
    registerActionRef.current = registerAction;
  }, [registerAction]);

  useEffect(() => {
    if (!autoEnabled) return;
    let timer: number | null = null;

    const simulateInput = () => {
      const action = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
      registerActionRef.current(action.id, 0.78 + Math.random() * 0.45);
      timer = window.setTimeout(simulateInput, 720 + Math.random() * 860);
    };

    timer = window.setTimeout(simulateInput, 360);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [autoEnabled]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (
        autoReturnArmedRef.current &&
        window.performance.now() - lastInputAtRef.current >= AUTO_RETURN_DELAY_MS
      ) {
        autoReturn();
      }
    }, 180);

    return () => window.clearInterval(timer);
  }, [autoReturn]);

  useEffect(() => {
    const keyRepeatTimers = new Map<string, number>();

    const clearKeyRepeats = () => {
      for (const timer of keyRepeatTimers.values()) {
        window.clearInterval(timer);
      }
      keyRepeatTimers.clear();
    };

    const inputIdFor = (event: KeyboardEvent) => event.code || event.key.toLowerCase();

    const handleKeyDown = (event: KeyboardEvent) => {
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
        const inputId = inputIdFor(event);
        if (keyRepeatTimers.has(inputId)) return;

        registerActionRef.current(match);
        const timer = window.setInterval(() => {
          registerActionRef.current(match);
        }, INPUT_REPEAT_INTERVAL_MS);
        keyRepeatTimers.set(inputId, timer);
      } else if (key === "r" && !event.repeat) {
        event.preventDefault();
        resetLab();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const inputId = inputIdFor(event);
      const timer = keyRepeatTimers.get(inputId);
      if (timer === undefined) return;
      window.clearInterval(timer);
      keyRepeatTimers.delete(inputId);
    };

    const clearHeldInputs = () => {
      clearKeyRepeats();
      stopPointerRepeat();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearHeldInputs);
    document.addEventListener("visibilitychange", clearHeldInputs);
    return () => {
      clearHeldInputs();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearHeldInputs);
      document.removeEventListener("visibilitychange", clearHeldInputs);
    };
  }, [resetLab, stopPointerRepeat]);

  const handleStagePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("button, input, textarea, label, [role=\"dialog\"], .corner-controls, .corner-footer")) return;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;

      const side = event.clientX < rect.left + rect.width / 2 ? "left" : "right";
      const point = {
        x: ((event.clientX - rect.left) / rect.width) * 100,
        y: ((event.clientY - rect.top) / rect.height) * 100,
      };
      registerActionRef.current(side, 0.72, point);
      stopPointerRepeat();
      pointerRepeatTimerRef.current = window.setInterval(() => {
        registerActionRef.current(side, 0.72, point);
      }, INPUT_REPEAT_INTERVAL_MS);
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
    [stopPointerRepeat],
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
      stopPointerRepeat();
      setIsDragging(true);
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (drag.moved) {
      noteInput();
      physicsCommandQueueRef.current.push({
        id: actionIdRef.current++,
        type: "drag",
        dx,
        dy,
      });
    }
  }, [noteInput, stopPointerRepeat]);

  const handleStagePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag.active || drag.pointerId !== event.pointerId) return;
      stopPointerRepeat();

      if (drag.moved) {
        const totalX = event.clientX - drag.startX;
        const totalY = event.clientY - drag.startY;
        physicsCommandQueueRef.current.push({
          id: actionIdRef.current++,
          type: "release",
          totalX,
          totalY,
        });
        noteInput();
        recordInput();
        setLastImpact("拖拽甩动");
        pushLog({
          label: "拖拽甩动",
          key: "MOUSE",
          detail: "松开，把真实冲量甩出去",
          tone: "cyan",
        });
        spawnEffect("FLING", "cyan", display.x + totalX * 0.2);
      }

      dragRef.current.active = false;
      dragRef.current.moved = false;
      setIsDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [display.x, noteInput, pushLog, recordInput, spawnEffect, stopPointerRepeat],
  );

  const applySettings = useCallback(() => {
    const sayings = normalizeSayings(sayingsDraft.split(/\r?\n/));
    setSettings((current) => ({ ...current, sayings }));
    setSayingsDraft(sayings.join("\n"));
    setSpeechText(sayings[0]);
    setSettingsNotice("设置已应用");
  }, [sayingsDraft]);

  const handleImageChange = useCallback(
    (part: AppearancePart, event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setSettingsNotice("请选择图片文件");
        return;
      }
      if (file.size > MAX_CUSTOM_IMAGE_BYTES) {
        setSettingsNotice("图片不能超过 4MB");
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string") return;
        setSettings((current) => ({
          ...current,
          appearance: { ...current.appearance, [part]: reader.result as string },
        }));
        setSettingsNotice(`${IMAGE_PARTS.find((item) => item.id === part)?.label ?? "部位"}图片已载入`);
      };
      reader.onerror = () => setSettingsNotice("图片读取失败，请换一张试试");
      reader.readAsDataURL(file);
    },
    [],
  );

  const clearImage = useCallback((part: AppearancePart) => {
    setSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, [part]: null },
    }));
    setSettingsNotice("图片已清除");
  }, []);

  return (
    <main className="experiment-shell">
      <section
        className={`experiment-board ${isDragging ? "is-dragging" : ""}`}
        ref={stageRef}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerUp}
        role="application"
        aria-label="不倒翁互动实验台，点击或拖拽来施加真实三维力量"
      >
        <header className="corner corner-brand">
          <h1>不倒翁<br /><em>互动实验</em></h1>
        </header>

        <aside className="corner corner-status" aria-label="实时状态">
          <div className="corner-live"><span className="live-dot" /> LIVE / RAPIER 3D</div>
          <div className="mini-metrics">
            <div><span>稳定</span><strong>{stability}%</strong></div>
            <div><span>角度</span><strong>{display.angle >= 0 ? "+" : ""}{display.angle.toFixed(1)}°</strong></div>
            <div><span>连击</span><strong className={combo > 1 ? "is-accent" : ""}>×{combo}</strong></div>
          </div>
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
              <TumblerScene
                commandQueueRef={physicsCommandQueueRef}
                onState={setDisplay}
                appearance={settings.appearance}
              />
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
          <div className="speech-bubble" aria-live="polite">
            “{speechText}”
          </div>
          <span className="drag-caption">{isDragging ? "RELEASE TO FLING" : "CLICK / DRAG"}</span>
        </div>

        <div className="corner corner-help">
          <div className="corner-controls">
            <button
              className={`help-trigger ${helpOpen ? "is-open" : ""}`}
              onClick={() => {
                setHelpOpen((open) => !open);
                setSettingsOpen(false);
              }}
              type="button"
              aria-expanded={helpOpen}
              aria-controls="help-panel"
            >
              <span>?</span> 操作说明
            </button>
            <button
              className={`settings-trigger ${settingsOpen ? "is-open" : ""}`}
              onClick={() => {
                setSettingsOpen((open) => !open);
                setHelpOpen(false);
              }}
              type="button"
              aria-expanded={settingsOpen}
              aria-controls="settings-panel"
            >
              <span>⚙</span> 设置
            </button>
          </div>
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
          {settingsOpen && (
            <div
              className="settings-panel"
              id="settings-panel"
              role="dialog"
              aria-label="不倒翁设置"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="settings-heading">
                <strong>SETTINGS / CUSTOMIZE</strong>
                <button onClick={() => setSettingsOpen(false)} type="button" aria-label="关闭设置">×</button>
              </div>
              <p className="settings-intro">自定义它会说的话，也可以给头部、中段和底部换上自己的图片。</p>
              <label className="settings-field">
                <span>不倒翁台词</span>
                <textarea
                  value={sayingsDraft}
                  onChange={(event) => setSayingsDraft(event.target.value)}
                  placeholder="每行写一句，动作时随机说一句"
                  rows={4}
                />
                <small>每行一句，最多保存 8 句</small>
              </label>
              <div className="settings-section-title">3D 外观 / IMAGE PARTS</div>
              <div className="image-settings">
                {IMAGE_PARTS.map((part) => {
                  const image = settings.appearance[part.id];
                  return (
                    <div className="image-setting" key={part.id}>
                      <div className="image-setting-meta">
                        <strong>{part.label}</strong>
                        <small>{part.hint}</small>
                      </div>
                      <label className="image-picker">
                        {image ? <img src={image} alt={`${part.label}预览`} /> : <span>＋</span>}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={(event) => handleImageChange(part.id, event)}
                        />
                      </label>
                      {image && (
                        <button className="image-clear" type="button" onClick={() => clearImage(part.id)}>
                          清除
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {settingsNotice && <div className="settings-notice">{settingsNotice}</div>}
              <button
                className="settings-apply"
                type="button"
                onClick={() => {
                  applySettings();
                  setSettingsOpen(false);
                }}
              >
                应用设置
              </button>
            </div>
          )}
        </div>

        <div className="corner corner-footer" aria-label="自动输入与历史计数">
          <button
            className={`auto-toggle ${autoEnabled ? "is-on" : ""}`}
            type="button"
            aria-pressed={autoEnabled}
            onClick={() => setAutoEnabled((enabled) => !enabled)}
          >
            <span className="auto-toggle-dot" />
            <span className="auto-toggle-copy">
              <strong>自动</strong>
              <small>{autoEnabled ? "随机输入中" : "模拟随机输入"}</small>
            </span>
          </button>
          <div className="history-count" aria-live="polite" title="保存在当前浏览器中的历史输入次数">
            <span>历史输入</span>
            <strong>{totalInputCount.toLocaleString("zh-CN")}</strong>
          </div>
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
