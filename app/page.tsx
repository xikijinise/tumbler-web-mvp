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
import type { JellyCommand } from "./jelly/JellyScene";
import type { JellyActionId } from "./jelly/physics";
import {
  DEFAULT_SAYINGS,
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

const INITIAL_SPEECH: SpeechBubbleState = {
  id: 0,
  text: DEFAULT_SAYINGS[0],
  x: 72,
  y: 36,
  side: "right",
};

function canUseWebGL() {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
}

function makeSpeechBubble(id: number, text: string): SpeechBubbleState {
  const side = Math.random() < 0.5 ? "left" : "right";
  return {
    id,
    text,
    side,
    x: side === "left" ? 20 + Math.random() * 10 : 80 - Math.random() * 10,
    y: 24 + Math.random() * 28,
  };
}

function StageFallback({ flavorName }: { flavorName: string }) {
  return (
    <div className="stage-fallback" role="img" aria-label={`${flavorName}果冻不倒翁加载中`}>
      <div className="stage-fallback-blob">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="./custom-character.png" alt="狗头夹心" className="stage-fallback-dog" />
      </div>
    </div>
  );
}

export default function Home() {
  const commandQueueRef = useRef<JellyCommand[]>([]);
  const cmdIdRef = useRef(1);
  const speechIdRef = useRef(1);
  const totalCountRef = useRef(0);
  const settingsReadyRef = useRef(false);

  const [webglStatus, setWebglStatus] = useState<"checking" | "available" | "unavailable">(
    "checking",
  );
  const [settings, setSettings] = useState<TumblerSettings>({
    sayings: [...DEFAULT_SAYINGS],
    flavor: "strawberry",
    softness: "jelly",
    soundEnabled: true,
  });
  const [totalCount, setTotalCount] = useState(0);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sayingsDraft, setSayingsDraft] = useState(DEFAULT_SAYINGS.join("\n"));
  const [speech, setSpeech] = useState<SpeechBubbleState>(INITIAL_SPEECH);
  const [speechVisible, setSpeechVisible] = useState(false);

  const activeFlavor = useMemo(() => getFlavor(settings.flavor), [settings.flavor]);
  const activeSoftness = useMemo(() => getSoftness(settings.softness), [settings.softness]);

  // Hydrate persisted settings, WebGL support, and Supabase global counter
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
        const merged = Math.max(totalCountRef.current, remoteCount);
        totalCountRef.current = merged;
        setTotalCount(merged);
        saveLocalCount(merged);
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

  const recordInput = useCallback(() => {
    const next = Math.min(totalCountRef.current + 1, Number.MAX_SAFE_INTEGER);
    totalCountRef.current = next;
    setTotalCount(next);
    saveLocalCount(next);

    void incrementGlobalInputCount().then((remoteCount) => {
      if (remoteCount === null) return;
      const merged = Math.max(totalCountRef.current, remoteCount);
      totalCountRef.current = merged;
      setTotalCount((curr) => Math.max(curr, remoteCount));
      saveLocalCount(merged);
    });
  }, []);

  const popSaying = useCallback(
    (customText?: string) => {
      const pool = settings.sayings.length > 0 ? settings.sayings : DEFAULT_SAYINGS;
      const text = customText ?? pool[Math.floor(Math.random() * pool.length)];
      setSpeech(makeSpeechBubble(speechIdRef.current++, text));
      setSpeechVisible(true);
    },
    [settings.sayings],
  );

  // Auto-hide speech bubble gently after idle
  useEffect(() => {
    if (!speechVisible) return;
    const timer = window.setTimeout(() => setSpeechVisible(false), 3400);
    return () => window.clearTimeout(timer);
  }, [speech.id, speechVisible]);

  const handleInteraction = useCallback(() => {
    recordInput();
    popSaying();
  }, [popSaying, recordInput]);

  const triggerAction = useCallback(
    (action: JellyActionId, strength = 1) => {
      commandQueueRef.current.push({
        id: cmdIdRef.current++,
        type: "action",
        action,
        strength,
      });
      recordInput();
      popSaying();
    },
    [popSaying, recordInput],
  );

  const handleReset = useCallback(() => {
    commandQueueRef.current.push({
      id: cmdIdRef.current++,
      type: "reset",
    });
    popSaying("回到平衡点");
  }, [popSaying]);

  // Keyboard shortcuts
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

  // Auto-poke mode
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
    setSettings((curr) => ({ ...curr, sayings }));
    setSayingsDraft(sayings.join("\n"));
    popSaying(sayings[0]);
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
          <Suspense fallback={<StageFallback flavorName={activeFlavor.name} />}>
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
                commandQueueRef={commandQueueRef}
                onInteraction={handleInteraction}
              />
            </ThreeCanvas>
          </Suspense>
        ) : (
          <StageFallback flavorName={activeFlavor.name} />
        )}

        {/* Top Bar: Minimal brand & global counter */}
        <header className="top-bar">
          <div className="brand-block">
            <h1>果冻不倒翁</h1>
            <p>戳它、揪住拉扯、松手 duang 回去</p>
          </div>

          <div className="top-actions">
            <div className="counter-pill" aria-live="polite" title="全站累计互动次数">
              <span className="counter-dot" />
              <span>全站已戳</span>
              <strong>{totalCount.toLocaleString("zh-CN")}</strong>
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
              aria-label="重新归位"
              title="归位 (R)"
            >
              ↺
            </button>
          </div>
        </header>

        {/* Playful Speech Bubble */}
        {speechVisible && (
          <div
            key={speech.id}
            className={`speech-bubble speech-${speech.side}`}
            style={{ left: `${speech.x}%`, top: `${speech.y}%` }}
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
              自动
            </button>
            <button
              type="button"
              className={`dock-btn ${settingsOpen ? "is-on" : ""}`}
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              aria-controls="jelly-settings-popover"
            >
              设置
            </button>
          </div>
        </nav>

        {/* Settings & Shortcuts Popover */}
        {settingsOpen && (
          <div
            id="jelly-settings-popover"
            className="settings-popover"
            role="dialog"
            aria-label="台词与快捷键设置"
          >
            <div className="popover-head">
              <strong>台词与快捷键</strong>
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
              <span>自定义互动台词（每行一句，最多 10 句）</span>
              <textarea
                rows={4}
                value={sayingsDraft}
                onChange={(e) => setSayingsDraft(e.target.value)}
                placeholder="每行写一句，戳它时随机冒出来"
              />
            </label>

            <button type="button" className="popover-save" onClick={applySayings}>
              保存台词
            </button>

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
