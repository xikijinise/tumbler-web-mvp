"use client";

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { jellyAudio } from "./jelly/audio";
import {
  JELLY_FLAVORS,
  SOFTNESS_PRESETS,
  getFlavor,
  getSoftness,
  type FlavorId,
  type SoftnessId,
} from "./jelly/flavors";
import type { JellyCommand, JellyInteractionEvent } from "./jelly/JellyScene";
import type { JellyActionId } from "./jelly/physics";
import {
  DEFAULT_SAYINGS,
  GENTLE_SAYINGS,
  IDLE_SAYINGS,
  INTENSE_SAYINGS,
  fetchGlobalInputCount,
  incrementGlobalInputCount,
  loadLocalCount,
  loadStoredSettings,
  normalizeSayings,
  saveLocalCount,
  saveStoredSettings,
  type TumblerSettings,
} from "./jelly/storage";

const ThreeCanvas = lazy(async () => {
  const fiberModule = await import("@react-three/fiber");
  return { default: fiberModule.Canvas };
});

const ThreeJellyScene = lazy(async () => {
  const sceneModule = await import("./jelly/JellyScene");
  return { default: sceneModule.JellyScene };
});

type SpeechBubbleState = {
  id: number;
  text: string;
  x: number;
  y: number;
  side: "left" | "right";
  tilt: number;
  intense: boolean;
};

type OnomatopoeiaPop = {
  id: number;
  text: string;
  x: number;
  y: number;
  intense: boolean;
};

type ShortcutAction = {
  id: JellyActionId;
  key: string;
  label: string;
};

const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "left", key: "A", label: "向左推" },
  { id: "right", key: "D", label: "向右推" },
  { id: "uppercut", key: "W", label: "弹飞" },
  { id: "stomp", key: "S", label: "按扁" },
  { id: "spin", key: "Q", label: "旋转" },
  { id: "backhand", key: "E", label: "猛甩" },
  { id: "forward", key: "F", label: "贴脸" },
  { id: "super", key: "Space", label: "超载抖动" },
];

const GENTLE_SOUNDS = ["啵叽", "duang~", "噗啾", "Q弹"];
const INTENSE_SOUNDS = ["DUANG!!", "啵叽!!", "弹飞!", "Q弹爆表!"];

const INITIAL_SPEECH: SpeechBubbleState = {
  id: 0,
  text: GENTLE_SAYINGS[0],
  x: 72,
  y: 34,
  side: "right",
  tilt: 2,
  intense: false,
};

function canUseWebGL() {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
}

function pickRandom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function makeSpeechBubble(id: number, text: string, intense: boolean): SpeechBubbleState {
  const side = Math.random() < 0.5 ? "left" : "right";
  return {
    id,
    text,
    side,
    x: side === "left" ? 18 + Math.random() * 10 : 82 - Math.random() * 10,
    y: 23 + Math.random() * 24,
    tilt: side === "left" ? -2.2 : 2.2,
    intense,
  };
}

function StageLoader({ label }: { label: string }) {
  return (
    <div className="stage-loader" role="status" aria-label={label}>
      <div className="stage-loader-ring" />
      <span>{label}</span>
    </div>
  );
}

export default function Home() {
  const commandQueueRef = useRef<JellyCommand[]>([]);
  const cmdIdRef = useRef(1);
  const speechIdRef = useRef(1);
  const popIdRef = useRef(1);
  const totalCountRef = useRef(0);
  const remoteSyncedRef = useRef(false);
  const highestRemoteRef = useRef(0);
  const comboRef = useRef(0);
  const lastHitAtRef = useRef(0);
  const hasInteractedRef = useRef(false);
  const settingsReadyRef = useRef(false);

  const [webglStatus, setWebglStatus] = useState<"checking" | "available" | "unavailable">(
    "checking",
  );
  const [settings, setSettings] = useState<TumblerSettings>({
    sayings: [...DEFAULT_SAYINGS],
    hasCustomSayings: false,
    flavor: "strawberry",
    softness: "jelly",
    soundEnabled: true,
  });
  const [totalCount, setTotalCount] = useState(0);
  const [counterSynced, setCounterSynced] = useState(false);
  const [combo, setCombo] = useState(0);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sayingsDraft, setSayingsDraft] = useState(DEFAULT_SAYINGS.join("\n"));
  const [speech, setSpeech] = useState<SpeechBubbleState>(INITIAL_SPEECH);
  const [speechVisible, setSpeechVisible] = useState(false);
  const [pops, setPops] = useState<OnomatopoeiaPop[]>([]);

  const activeFlavor = useMemo(() => getFlavor(settings.flavor), [settings.flavor]);
  const activeSoftness = useMemo(() => getSoftness(settings.softness), [settings.softness]);
  const comboHeat = useMemo(() => Math.min(1, Math.max(0, (combo - 2) / 14)), [combo]);

  useEffect(() => {
    let active = true;
    const initTimer = window.setTimeout(() => {
      const stored = loadStoredSettings();
      setSettings(stored);
      setSayingsDraft(stored.sayings.join("\n"));
      jellyAudio.setEnabled(stored.soundEnabled);
      settingsReadyRef.current = true;

      const localCount = loadLocalCount();
      totalCountRef.current = localCount;
      setTotalCount(localCount);

      setWebglStatus(canUseWebGL() ? "available" : "unavailable");

      void fetchGlobalInputCount().then((remoteCount) => {
        if (!active || remoteCount === null) return;
        remoteSyncedRef.current = true;
        highestRemoteRef.current = Math.max(highestRemoteRef.current, remoteCount);
        totalCountRef.current = highestRemoteRef.current;
        setCounterSynced(true);
        setTotalCount(highestRemoteRef.current);
        saveLocalCount(highestRemoteRef.current);
      });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(initTimer);
    };
  }, []);

  useEffect(() => {
    jellyAudio.setEnabled(settings.soundEnabled);
    if (!settingsReadyRef.current) return;
    saveStoredSettings(settings);
  }, [settings]);

  // Cool down combo when user pauses
  useEffect(() => {
    if (combo === 0) return;
    const timer = window.setTimeout(() => {
      comboRef.current = 0;
      setCombo(0);
    }, 1700);
    return () => window.clearTimeout(timer);
  }, [combo]);

  const recordInput = useCallback(() => {
    const optimistic = Math.min(totalCountRef.current + 1, Number.MAX_SAFE_INTEGER);
    totalCountRef.current = optimistic;
    setTotalCount(optimistic);
    saveLocalCount(optimistic);

    void incrementGlobalInputCount().then((remoteCount) => {
      if (remoteCount === null) return;
      remoteSyncedRef.current = true;
      highestRemoteRef.current = Math.max(highestRemoteRef.current, remoteCount);
      totalCountRef.current = highestRemoteRef.current;
      setCounterSynced(true);
      setTotalCount(highestRemoteRef.current);
      saveLocalCount(highestRemoteRef.current);
    });
  }, []);

  const popSaying = useCallback(
    (mode: "gentle" | "intense" | "idle" | "custom", customText?: string) => {
      let text = customText;
      if (!text) {
        if (mode === "idle") {
          text = pickRandom(IDLE_SAYINGS);
        } else if (settings.hasCustomSayings && settings.sayings.length > 0) {
          text = pickRandom(settings.sayings);
        } else {
          text = pickRandom(mode === "intense" ? INTENSE_SAYINGS : GENTLE_SAYINGS);
        }
      }
      setSpeech(makeSpeechBubble(speechIdRef.current++, text, mode === "intense"));
      setSpeechVisible(true);
    },
    [settings.hasCustomSayings, settings.sayings],
  );

  const spawnPop = useCallback((text: string, x: number, y: number, intense: boolean) => {
    const id = popIdRef.current++;
    const clampedX = Math.min(82, Math.max(18, x));
    const clampedY = Math.min(72, Math.max(22, y));
    setPops((curr) => [...curr.slice(-4), { id, text, x: clampedX, y: clampedY, intense }]);
    window.setTimeout(() => {
      setPops((curr) => curr.filter((item) => item.id !== id));
    }, 680);
  }, []);

  // Auto-hide speech bubble gently
  useEffect(() => {
    if (!speechVisible) return;
    const timer = window.setTimeout(() => setSpeechVisible(false), 3200);
    return () => window.clearTimeout(timer);
  }, [speech.id, speechVisible]);

  // Cheeky idle taunt if user leaves the jelly alone after playing
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!hasInteractedRef.current || autoEnabled || settingsOpen) return;
      const idleMs = performance.now() - lastHitAtRef.current;
      if (idleMs > 9500 && idleMs < 11000) {
        popSaying("idle");
      }
    }, 1400);
    return () => window.clearInterval(timer);
  }, [autoEnabled, popSaying, settingsOpen]);

  const registerFeedback = useCallback(
    (event: JellyInteractionEvent) => {
      hasInteractedRef.current = true;
      const now = performance.now();
      const isChain = now - lastHitAtRef.current < 1400;
      const nextCombo = isChain ? comboRef.current + 1 : 1;
      comboRef.current = nextCombo;
      lastHitAtRef.current = now;
      setCombo(nextCombo);

      // Fling is the release of a drag whose initial pointerdown already counted once
      if (event.kind !== "fling") {
        recordInput();
      }

      const isIntense = event.intensity === "intense" || nextCombo >= 6;
      popSaying(isIntense ? "intense" : "gentle");

      const popX = event.screenX ?? 44 + Math.random() * 12;
      const popY = event.screenY ?? 36 + Math.random() * 10;
      const popLabel =
        nextCombo >= 5 && nextCombo % 5 === 0
          ? `×${nextCombo} DUANG!`
          : pickRandom(isIntense ? INTENSE_SOUNDS : GENTLE_SOUNDS);
      spawnPop(popLabel, popX, popY, isIntense);
    },
    [popSaying, recordInput, spawnPop],
  );

  const triggerAction = useCallback(
    (action: JellyActionId, strength = 1) => {
      commandQueueRef.current.push({
        id: cmdIdRef.current++,
        type: "action",
        action,
        strength,
      });
      registerFeedback({
        kind: "action",
        intensity: action === "super" || action === "stomp" || action === "backhand" ? "intense" : "gentle",
      });
    },
    [registerFeedback],
  );

  const handleReset = useCallback(() => {
    commandQueueRef.current.push({
      id: cmdIdRef.current++,
      type: "reset",
    });
    comboRef.current = 0;
    setCombo(0);
    popSaying("custom", "重新摆好啦~");
  }, [popSaying]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && target.closest("input, textarea, [contenteditable]")) return;

      const key = event.key.toLowerCase();
      const map: Record<string, JellyActionId> = {
        a: "left",
        d: "right",
        w: "uppercut",
        s: "stomp",
        q: "spin",
        e: "backhand",
        f: "forward",
      };
      if (event.code === "Space") {
        event.preventDefault();
        triggerAction("super", 1.15);
      } else if (key in map) {
        event.preventDefault();
        triggerAction(map[key], 1);
      } else if (key === "r" && !event.repeat) {
        event.preventDefault();
        handleReset();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleReset, triggerAction]);

  useEffect(() => {
    if (!autoEnabled) return;
    let timer = 0;
    const actions: JellyActionId[] = [
      "left",
      "right",
      "uppercut",
      "stomp",
      "spin",
      "backhand",
      "forward",
      "super",
    ];
    const loop = () => {
      const pick = actions[Math.floor(Math.random() * actions.length)];
      triggerAction(pick, 0.72 + Math.random() * 0.48);
      timer = window.setTimeout(loop, 820 + Math.random() * 920);
    };
    timer = window.setTimeout(loop, 360);
    return () => window.clearTimeout(timer);
  }, [autoEnabled, triggerAction]);

  const setFlavor = (flavor: FlavorId) => {
    setSettings((curr) => ({ ...curr, flavor }));
  };

  const setSoftness = (softness: SoftnessId) => {
    setSettings((curr) => ({ ...curr, softness }));
  };

  const toggleSound = () => {
    setSettings((curr) => ({ ...curr, soundEnabled: !curr.soundEnabled }));
  };

  const applySayings = () => {
    const sayings = normalizeSayings(sayingsDraft.split(/\r?\n/));
    setSettings((curr) => ({ ...curr, sayings, hasCustomSayings: true }));
    setSayingsDraft(sayings.join("\n"));
    popSaying("custom", sayings[0]);
    setSettingsOpen(false);
  };

  const resetDefaultSayings = () => {
    setSettings((curr) => ({
      ...curr,
      sayings: [...DEFAULT_SAYINGS],
      hasCustomSayings: false,
    }));
    setSayingsDraft(DEFAULT_SAYINGS.join("\n"));
    popSaying("gentle");
    setSettingsOpen(false);
  };

  return (
    <main
      className="jelly-app"
      style={
        {
          "--accent": activeFlavor.accent,
          "--stage-bg": activeFlavor.backdropBottom,
        } as React.CSSProperties
      }
    >
      <div
        className="jelly-stage"
        role="application"
        aria-label="果冻不倒翁互动舞台：点击戳它，按住拉扯果冻并松手弹回"
      >
        {webglStatus === "available" ? (
          <Suspense fallback={<StageLoader label="果冻正在凝固..." />}>
            <ThreeCanvas
              dpr={[1, 2]}
              camera={{ position: [0, 0.45, 9.6], fov: 35, near: 0.1, far: 100 }}
              gl={{ antialias: true, powerPreference: "high-performance" }}
              onCreated={({ gl }) => {
                gl.outputColorSpace = THREE.SRGBColorSpace;
                gl.toneMapping = THREE.ACESFilmicToneMapping;
                gl.toneMappingExposure = 1.08;
              }}
            >
              <ThreeJellyScene
                flavor={activeFlavor}
                softness={activeSoftness}
                comboHeat={comboHeat}
                commandQueueRef={commandQueueRef}
                onInteraction={registerFeedback}
              />
            </ThreeCanvas>
          </Suspense>
        ) : (
          <StageLoader
            label={webglStatus === "checking" ? "果冻正在凝固..." : "当前浏览器不支持 3D WebGL"}
          />
        )}

        {/* Top Bar: Minimal brand & global counter */}
        <header className="top-bar">
          <div className="brand-block">
            <h1>果冻不倒翁</h1>
            <p>戳它、揪住拉扯、松手 duang 回去</p>
          </div>

          <div className="top-actions">
            {combo >= 2 && (
              <div className="combo-pill" aria-live="polite">
                连击 ×{combo}
              </div>
            )}
            <div
              className="counter-pill"
              aria-live="polite"
              title={counterSynced ? "已实时同步到 Cloudflare D1" : "正在连接云端计数（当前显示本地缓存）"}
            >
              <span className="counter-dot" />
              <span>全网已催促</span>
              <strong>{totalCount.toLocaleString("zh-CN")}</strong>
              <span className="counter-unit">次</span>
            </div>
            <button
              type="button"
              className={`icon-pill ${settings.soundEnabled ? "is-active" : ""}`}
              onClick={toggleSound}
              aria-label={settings.soundEnabled ? "关闭果冻音效" : "开启果冻音效"}
              title={settings.soundEnabled ? "音效已开" : "音效已关"}
            >
              {settings.soundEnabled ? "♪" : "×"}
            </button>
            <button
              type="button"
              className="icon-pill"
              onClick={handleReset}
              aria-label="重新摆好"
              title="摆好 (R)"
            >
              ↺
            </button>
            <a
              className="icon-pill"
              href="https://github.com/xikijinise/tumbler-web-mvp"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="查看 GitHub 开源仓库"
              title="GitHub 开源仓库"
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
            </a>
          </div>
        </header>

        {/* Comic Jelly Onomatopoeia Popups */}
        {pops.map((pop) => (
          <span
            key={pop.id}
            className={`jelly-pop ${pop.intense ? "is-intense" : ""}`}
            style={{ left: `${pop.x}%`, top: `${pop.y}%` }}
            aria-hidden="true"
          >
            {pop.text}
          </span>
        ))}

        {/* Frosted-Sugar Jelly Speech Bubble */}
        {speechVisible && (
          <div
            key={speech.id}
            className={`speech-bubble speech-${speech.side} ${speech.intense ? "is-intense" : ""}`}
            style={
              {
                left: `${speech.x}%`,
                top: `${speech.y}%`,
                "--bubble-tilt": `${speech.tilt}deg`,
              } as React.CSSProperties
            }
            aria-live="polite"
          >
            “{speech.text}”
          </div>
        )}

        {/* Bottom Floating Tactile Dock */}
        <nav className="dock" aria-label="果冻外观与手感控制">
          <div className="dock-group" role="group" aria-label="果冻口味">
            {JELLY_FLAVORS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`flavor-dot ${settings.flavor === item.id ? "is-selected" : ""}`}
                style={{ "--swatch": item.swatch } as React.CSSProperties}
                onClick={() => setFlavor(item.id)}
                aria-label={item.name}
                aria-pressed={settings.flavor === item.id}
                title={item.name}
              />
            ))}
          </div>

          <span className="dock-divider" aria-hidden="true" />

          <div className="dock-group softness-group" role="group" aria-label="软硬度">
            {SOFTNESS_PRESETS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`softness-chip ${settings.softness === item.id ? "is-selected" : ""}`}
                onClick={() => setSoftness(item.id)}
                aria-pressed={settings.softness === item.id}
              >
                {item.label}
              </button>
            ))}
          </div>

          <span className="dock-divider" aria-hidden="true" />

          <div className="dock-group">
            <button
              type="button"
              className={`dock-btn ${autoEnabled ? "is-on" : ""}`}
              onClick={() => setAutoEnabled((v) => !v)}
              aria-pressed={autoEnabled}
            >
              <span className="auto-dot" />
              自动代戳
            </button>
            <button
              type="button"
              className={`dock-btn ${settingsOpen ? "is-on" : ""}`}
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              aria-controls="jelly-settings-popover"
            >
              口头禅
            </button>
          </div>
        </nav>

        {/* Settings & Shortcuts Popover */}
        {settingsOpen && (
          <div
            id="jelly-settings-popover"
            className="settings-popover"
            role="dialog"
            aria-label="口头禅与快捷键设置"
          >
            <div className="popover-head">
              <strong>自定义口头禅 &amp; 招式</strong>
              <button
                type="button"
                className="popover-close"
                onClick={() => setSettingsOpen(false)}
                aria-label="关闭设置"
              >
                ×
              </button>
            </div>

            <label className="popover-field">
              <span>每行一句（最多 10 句），保存后戳它会随机冒出来</span>
              <textarea
                rows={4}
                value={sayingsDraft}
                onChange={(e) => setSayingsDraft(e.target.value)}
                placeholder="每行写一句，戳它时随机冒出来"
              />
            </label>

            <div className="popover-actions">
              <button type="button" className="popover-save" onClick={applySayings}>
                保存口头禅
              </button>
              <button type="button" className="popover-reset" onClick={resetDefaultSayings}>
                恢复默认分档台词
              </button>
            </div>

            <div className="shortcut-section">
              <span>键盘快捷招式</span>
              <div className="shortcut-grid">
                {SHORTCUT_ACTIONS.map((act) => (
                  <button
                    key={act.id}
                    type="button"
                    className="shortcut-btn"
                    onClick={() => triggerAction(act.id)}
                  >
                    <kbd>{act.key}</kbd>
                    <span>{act.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
