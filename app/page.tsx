"use client";

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import type { PhysicsAction, PhysicsCommand, PhysicsState } from "./tumbler-scene";

const ThreeCanvas = lazy(async () => {
  const fiberModule = await import("@react-three/fiber");
  return { default: fiberModule.Canvas };
});

const ThreeTumblerScene = lazy(async () => {
  const sceneModule = await import("./tumbler-scene");
  return { default: sceneModule.TumblerScene };
});

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

type SpeechPosition = {
  id: number;
  x: number;
  y: number;
  side: "left" | "right";
};

type TumblerSettings = {
  sayings: string[];
};

type WebGLStatus = "checking" | "available" | "unavailable";

type JellyFallbackMotion = {
  angle: number;
  x: number;
  y: number;
  impact: number;
};

const SETTINGS_STORAGE_KEY = "tumbler-web-mvp-settings-v2";
const HISTORY_COUNT_STORAGE_KEY = "tumbler-web-mvp-history-count-v1";
const SUPABASE_PROJECT_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://uipntxlrfctydhgxmxjd.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpcG50eGxyZmN0eWRoZ3hteGpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0OTE3MzYsImV4cCI6MjEwMzA2NzczNn0.6c9b4kc37umD7ejz7m01reJLcNm0FBKMH18sitkCboY";
const DEFAULT_SAYINGS = ["等等就好了", "明天就好了", "再等等", "已经让人处理了"];
const INITIAL_SPEECH_POSITION: SpeechPosition = { id: 0, x: 74, y: 44, side: "right" };

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
const INITIAL_FALLBACK_MOTION: JellyFallbackMotion = {
  angle: 0,
  x: 0,
  y: 0,
  impact: 0,
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

function makeSpeechPosition(id: number): SpeechPosition {
  const side = Math.random() < 0.5 ? "left" : "right";
  return {
    id,
    side,
    x: side === "left" ? 20 + Math.random() * 10 : 80 - Math.random() * 10,
    y: 28 + Math.random() * 38,
  };
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

function parseCountValue(value: unknown): number | null {
  const count = typeof value === "number" ? value : Number.parseInt(typeof value === "string" ? value : "", 10);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function normalizeHistoryCount(value: string | null) {
  return parseCountValue(value) ?? 0;
}

function normalizeRemoteCount(value: unknown) {
  if (Array.isArray(value)) return parseCountValue(value[0]);
  if (value && typeof value === "object" && "get_input_count" in value) {
    return parseCountValue(value.get_input_count);
  }
  return parseCountValue(value);
}

function canUseWebGL() {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
}

function isMobileRenderingEnvironment() {
  if (typeof window === "undefined") return true;
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const narrowViewport = Math.min(window.innerWidth, window.innerHeight) <= 820;
  return mobileUserAgent || coarsePointer || narrowViewport;
}

function drawJellyPath(context: CanvasRenderingContext2D) {
  context.beginPath();
  context.moveTo(180, 22);
  context.bezierCurveTo(105, 18, 50, 65, 48, 150);
  context.bezierCurveTo(46, 222, 52, 328, 86, 414);
  context.bezierCurveTo(106, 464, 143, 478, 180, 478);
  context.bezierCurveTo(231, 478, 269, 459, 286, 411);
  context.bezierCurveTo(316, 325, 314, 221, 312, 145);
  context.bezierCurveTo(310, 65, 254, 18, 180, 22);
  context.closePath();
}

function makeFusedDogCanvas(image: HTMLImageElement) {
  const source = document.createElement("canvas");
  source.width = image.naturalWidth || image.width;
  source.height = image.naturalHeight || image.height;
  const sourceContext = source.getContext("2d");
  if (!sourceContext || !source.width || !source.height) return source;

  sourceContext.drawImage(image, 0, 0, source.width, source.height);
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const red = pixels.data[index];
    const green = pixels.data[index + 1];
    const blue = pixels.data[index + 2];
    const isYellowBackdrop =
      red > 160 && green > 130 && blue < 150 && red > blue * 1.45 && green > blue * 1.3;
    if (isYellowBackdrop) {
      pixels.data[index + 3] = 0;
      continue;
    }

    const jellyTint = 0.28;
    pixels.data[index] = Math.round(red * (1 - jellyTint) + 255 * jellyTint);
    pixels.data[index + 1] = Math.round(green * (1 - jellyTint) + 170 * jellyTint);
    pixels.data[index + 2] = Math.round(blue * (1 - jellyTint) + 196 * jellyTint);
    pixels.data[index + 3] = Math.round(pixels.data[index + 3] * 0.7);
  }
  sourceContext.putImageData(pixels, 0, 0);
  return source;
}

function drawFusedFallback(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  motion: JellyFallbackMotion,
  time: number,
) {
  const width = 360;
  const height = 500;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  canvas.style.aspectRatio = `${width} / ${height}`;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const impact = clamp(motion.impact, 0, 1.3);
  const idleWobble = Math.sin(time * 0.0024) * 0.012;
  const tilt = (motion.angle * Math.PI) / 180 * 0.55 + idleWobble;
  const squash = 1 + impact * 0.055;
  const stretch = 1 - impact * 0.045;
  const driftX = clamp(motion.x * 1.1, -24, 24);
  const driftY = clamp(motion.y * 0.7, -18, 18);

  context.save();
  context.translate(width / 2 + driftX, height / 2 + driftY);
  context.rotate(tilt);
  context.scale(squash, stretch);
  context.translate(-width / 2, -height / 2);

  drawJellyPath(context);
  context.save();
  context.shadowColor = "rgba(155, 33, 86, 0.32)";
  context.shadowBlur = 38;
  context.shadowOffsetY = 34;
  context.fillStyle = "rgba(224, 92, 139, 0.82)";
  context.fill();
  context.restore();

  drawJellyPath(context);
  context.save();
  context.clip();
  const bodyGradient = context.createLinearGradient(48, 20, 310, 478);
  bodyGradient.addColorStop(0, "rgba(255, 221, 232, 0.82)");
  bodyGradient.addColorStop(0.24, "rgba(246, 146, 177, 0.84)");
  bodyGradient.addColorStop(0.66, "rgba(226, 101, 145, 0.84)");
  bodyGradient.addColorStop(1, "rgba(184, 54, 106, 0.82)");
  context.fillStyle = bodyGradient;
  context.fillRect(0, 0, width, height);

  const volumeShade = context.createRadialGradient(172, 230, 30, 180, 250, 238);
  volumeShade.addColorStop(0, "rgba(255, 255, 255, 0)");
  volumeShade.addColorStop(0.58, "rgba(121, 20, 72, 0.04)");
  volumeShade.addColorStop(1, "rgba(66, 6, 43, 0.32)");
  context.globalCompositeOperation = "multiply";
  context.fillStyle = volumeShade;
  context.fillRect(0, 0, width, height);

  const innerScatter = context.createRadialGradient(168, 258, 8, 176, 260, 250);
  innerScatter.addColorStop(0, "rgba(255, 239, 244, 0.2)");
  innerScatter.addColorStop(0.58, "rgba(255, 155, 190, 0.08)");
  innerScatter.addColorStop(1, "rgba(122, 24, 72, 0.18)");
  context.globalCompositeOperation = "screen";
  context.fillStyle = innerScatter;
  context.fillRect(0, 0, width, height);

  const dogCanvas = makeFusedDogCanvas(image);
  context.globalCompositeOperation = "source-over";
  context.save();
  context.filter = "blur(8px)";
  context.globalAlpha = 0.2;
  context.drawImage(dogCanvas, 77, 126, 206, 206);
  context.restore();
  context.globalAlpha = 0.68;
  context.drawImage(dogCanvas, 77, 126, 206, 206);
  context.globalAlpha = 1;

  const jellyVeil = context.createLinearGradient(64, 90, 292, 420);
  jellyVeil.addColorStop(0, "rgba(255, 232, 239, 0.2)");
  jellyVeil.addColorStop(0.5, "rgba(255, 171, 198, 0.14)");
  jellyVeil.addColorStop(1, "rgba(206, 78, 126, 0.16)");
  context.fillStyle = jellyVeil;
  context.fillRect(0, 0, width, height);

  const sheen = context.createRadialGradient(104, 104, 4, 128, 120, 174);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.68)");
  sheen.addColorStop(0.42, "rgba(255, 239, 245, 0.25)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.globalCompositeOperation = "screen";
  context.fillStyle = sheen;
  context.fillRect(0, 0, width, height);

  const edgeGlow = context.createLinearGradient(58, 80, 302, 420);
  edgeGlow.addColorStop(0, "rgba(255, 255, 255, 0.32)");
  edgeGlow.addColorStop(0.24, "rgba(255, 255, 255, 0)");
  edgeGlow.addColorStop(0.76, "rgba(255, 255, 255, 0)");
  edgeGlow.addColorStop(1, "rgba(255, 236, 245, 0.2)");
  context.globalAlpha = 0.92;
  context.fillStyle = edgeGlow;
  context.fillRect(0, 0, width, height);

  context.globalAlpha = 0.38;
  context.beginPath();
  context.ellipse(112, 182, 24, 92, -0.34, 0, Math.PI * 2);
  context.fillStyle = "rgba(255, 255, 255, 0.72)";
  context.fill();

  context.globalAlpha = 0.55;
  context.beginPath();
  context.ellipse(184, 454, 72, 13, 0, 0, Math.PI * 2);
  context.fillStyle = "rgba(255, 206, 224, 0.42)";
  context.fill();
  context.restore();

  drawJellyPath(context);
  context.strokeStyle = "rgba(255, 224, 235, 0.5)";
  context.lineWidth = 1.5;
  context.stroke();
  context.restore();
}

function JellyFallback({ motion }: { motion: JellyFallbackMotion }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionRef = useRef({ ...motion });

  useEffect(() => {
    motionRef.current = { ...motion };
  }, [motion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const image = new Image();
    let animationFrame = 0;
    let active = true;
    const render = (time: number) => {
      if (!active) return;
      drawFusedFallback(canvas, image, motionRef.current, time);
      motionRef.current.angle *= 0.93;
      motionRef.current.x *= 0.93;
      motionRef.current.y *= 0.93;
      motionRef.current.impact *= 0.91;
      animationFrame = window.requestAnimationFrame(render);
    };
    image.onload = () => {
      animationFrame = window.requestAnimationFrame(render);
    };
    image.src = "./custom-character.png";
    return () => {
      active = false;
      window.cancelAnimationFrame(animationFrame);
      image.onload = null;
    };
  }, []);

  return (
    <div className="three-fallback" role="img" aria-label="果冻不倒翁预览">
      <canvas ref={canvasRef} className="three-fallback-body" aria-hidden="true" />
    </div>
  );
}

async function callCountRpc(name: "get_input_count" | "increment_input_count") {
  if (!SUPABASE_PROJECT_URL || !SUPABASE_ANON_KEY) return null;

  try {
    const response = await fetch(`${SUPABASE_PROJECT_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
      cache: "no-store",
    });
    if (!response.ok) return null;
    return normalizeRemoteCount(await response.json());
  } catch {
    return null;
  }
}

function fetchGlobalInputCount() {
  return callCountRpc("get_input_count");
}

function incrementGlobalInputCount() {
  return callCountRpc("increment_input_count");
}

function parseStoredSettings(raw: string | null): TumblerSettings {
  if (!raw) {
    return { sayings: [...DEFAULT_SAYINGS] };
  }

  try {
    const parsed = JSON.parse(raw) as {
      sayings?: unknown;
    };
    return {
      sayings: normalizeSayings(parsed.sayings),
    };
  } catch {
    return { sayings: [...DEFAULT_SAYINGS] };
  }
}

export default function Home() {
  const stageRef = useRef<HTMLDivElement>(null);
  const physicsCommandQueueRef = useRef<PhysicsCommand[]>([]);
  const actionIdRef = useRef(1);
  const speechPositionIdRef = useRef(1);
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
  });
  const [sayingsDraft, setSayingsDraft] = useState(DEFAULT_SAYINGS.join("\n"));
  const [speechText, setSpeechText] = useState(DEFAULT_SAYINGS[0]);
  const [speechPosition, setSpeechPosition] = useState(INITIAL_SPEECH_POSITION);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [webglStatus, setWebglStatus] = useState<WebGLStatus>("checking");
  const [fallbackMotion, setFallbackMotion] = useState<JellyFallbackMotion>({
    ...INITIAL_FALLBACK_MOTION,
  });

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
    let active = true;
    const loadTimer = window.setTimeout(() => {
      const storedSettings = parseStoredSettings(window.localStorage.getItem(SETTINGS_STORAGE_KEY));
      setSettings(storedSettings);
      setSayingsDraft(storedSettings.sayings.join("\n"));
      const storedCount = normalizeHistoryCount(window.localStorage.getItem(HISTORY_COUNT_STORAGE_KEY));
      totalInputCountRef.current = storedCount;
      setTotalInputCount(storedCount);
      settingsLoadedRef.current = true;

      void fetchGlobalInputCount().then((remoteCount) => {
        if (!active || remoteCount === null) return;
        totalInputCountRef.current = remoteCount;
        setTotalInputCount(remoteCount);
        try {
          window.localStorage.setItem(HISTORY_COUNT_STORAGE_KEY, String(remoteCount));
        } catch {
          // The live count still works when persistence is unavailable.
        }
      });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(loadTimer);
    };
  }, []);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    let noticeTimer: number | undefined;
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      noticeTimer = window.setTimeout(() => {
        setSettingsNotice("设置已应用，但无法持久保存");
      }, 0);
    }

    return () => {
      if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
    };
  }, [settings]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const useThree = !isMobileRenderingEnvironment() && canUseWebGL();
      setWebglStatus(useThree ? "available" : "unavailable");
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const pickSaying = useCallback(() => {
    const sayings = settings.sayings.length > 0 ? settings.sayings : DEFAULT_SAYINGS;
    return sayings[Math.floor(Math.random() * sayings.length)];
  }, [settings.sayings]);

  const showSaying = useCallback((text: string) => {
    setSpeechText(text);
    setSpeechPosition(makeSpeechPosition(speechPositionIdRef.current++));
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

    void incrementGlobalInputCount().then((remoteCount) => {
      if (remoteCount === null) return;
      const mergedCount = Math.max(totalInputCountRef.current, remoteCount);
      totalInputCountRef.current = mergedCount;
      setTotalInputCount((current) => Math.max(current, remoteCount));
      try {
        window.localStorage.setItem(HISTORY_COUNT_STORAGE_KEY, String(mergedCount));
      } catch {
        // The live count still works when persistence is unavailable.
      }
    });
  }, []);

  const resetLab = useCallback(() => {
    lastInputAtRef.current = window.performance.now();
    autoReturnArmedRef.current = false;
    stopPointerRepeat();
    physicsCommandQueueRef.current.push({ id: actionIdRef.current++, type: "reset" });
    setDisplay({ ...INITIAL_PHYSICS });
    setFallbackMotion({ ...INITIAL_FALLBACK_MOTION });
    comboRef.current = 0;
    setCombo(0);
    setLastImpact("归位完成");
    showSaying("回到平衡点");
    setEffects([]);
    pushLog({
      label: "归零",
      key: "R",
      detail: "Rapier 刚体恢复到平衡点",
      tone: "muted",
    });
  }, [pushLog, showSaying, stopPointerRepeat]);

  const autoReturn = useCallback(() => {
    lastInputAtRef.current = window.performance.now();
    autoReturnArmedRef.current = false;
    stopPointerRepeat();
    physicsCommandQueueRef.current.push({ id: actionIdRef.current++, type: "return" });
    setFallbackMotion({ ...INITIAL_FALLBACK_MOTION });
    comboRef.current = 0;
    setCombo(0);
    setLastImpact("自动归位");
    showSaying(pickSaying());
    setEffects([]);
    pushLog({
      label: "自动归位",
      key: "AUTO",
      detail: "无输入一段时间，慢慢返回初始位置",
      tone: "muted",
    });
  }, [pickSaying, pushLog, showSaying, stopPointerRepeat]);

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
      setFallbackMotion({
        angle: action.angle * strength,
        x: action.x * strength,
        y: action.jump * 0.6 * strength,
        impact: strength,
      });
      setLastImpact(action.label);
      showSaying(pickSaying());
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
    [display.x, noteInput, pickSaying, pushLog, recordInput, showSaying, spawnEffect],
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
      setFallbackMotion((current) => ({
        angle: clamp(current.angle + dx * 0.22, -18, 18),
        x: clamp(current.x + dx * 0.08, -22, 22),
        y: clamp(current.y - dy * 0.06, -16, 16),
        impact: clamp(current.impact + (Math.abs(dx) + Math.abs(dy)) / 80, 0, 1.3),
      }));
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
    showSaying(sayings[0]);
    setSettingsNotice("设置已应用");
  }, [sayingsDraft, showSaying]);

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
        aria-label="果冻不倒翁互动实验台，点击或拖拽来施加真实三维力量"
      >
        <header className="corner corner-brand">
          <h1>果冻不倒翁<br /><em>互动实验</em></h1>
        </header>

        <aside className="corner corner-status" aria-label="实时状态">
          <div className="corner-live"><span className="live-dot" /> LIVE / JELLY PHYSICS</div>
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
            {webglStatus === "available" ? (
              <Suspense fallback={<JellyFallback motion={fallbackMotion} />}>
                <ThreeCanvas
                  dpr={[1, 2]}
                  camera={{ position: [0, 0.35, 10.5], fov: 34, near: 0.1, far: 100 }}
                  shadows
                  gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
                  fallback={<JellyFallback motion={fallbackMotion} />}
                  onCreated={({ gl }) => {
                    gl.setClearColor(0x000000, 0);
                    gl.outputColorSpace = THREE.SRGBColorSpace;
                    gl.toneMapping = THREE.ACESFilmicToneMapping;
                    gl.toneMappingExposure = 1.12;
                  }}
                  style={{ pointerEvents: "none" }}
                >
                  <ThreeTumblerScene
                    commandQueueRef={physicsCommandQueueRef}
                    onState={setDisplay}
                  />
                </ThreeCanvas>
              </Suspense>
            ) : (
              <JellyFallback motion={fallbackMotion} />
            )}
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
          <div
            className={`speech-bubble speech-${speechPosition.side}`}
            key={speechPosition.id}
            style={{ left: `${speechPosition.x}%`, top: `${speechPosition.y}%` }}
            aria-live="polite"
          >
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
              <p className="settings-intro">只调整互动时的提示语，果冻主体和狗头保持为一个完整的连续模型。</p>
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
          <div className="history-count" aria-live="polite" title="Supabase 全站累计输入次数">
            <span>全站历史</span>
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
