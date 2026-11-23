import type { FlavorId, SoftnessId } from "./flavors";

export type TumblerSettings = {
  sayings: string[];
  hasCustomSayings: boolean;
  flavor: FlavorId;
  softness: SoftnessId;
  soundEnabled: boolean;
};

export const SETTINGS_STORAGE_KEY = "tumbler-web-mvp-settings-v5";
export const HISTORY_COUNT_STORAGE_KEY = "tumbler-web-mvp-history-count-v1";

export const GENTLE_SAYINGS = [
  "等等就好了",
  "明天就好了",
  "再等等",
  "在看了在看了",
  "马上好",
  "duang~",
];

export const INTENSE_SAYINGS = [
  "已经让人处理了！！",
  "别晃了要化了！",
  "明天一定！！",
  "duang 晕了！",
  "手下留情啊！",
  "这周内搞定！",
];

export const IDLE_SAYINGS = [
  "这就没力气了？",
  "不戳了？",
  "那我先眯会儿",
  "明天见咯~",
];

export const DEFAULT_SAYINGS = [...GENTLE_SAYINGS];

const COUNTER_API_URL = (
  process.env.NEXT_PUBLIC_COUNTER_API_URL ??
  "https://tumbler-counter.stinergrunlien175.workers.dev"
).replace(/\/+$/, "");

const VALID_FLAVORS = new Set<FlavorId>(["strawberry", "peach", "muscat", "mango", "soda"]);
const VALID_SOFTNESS = new Set<SoftnessId>(["pudding", "jelly", "gummy"]);

export function normalizeSayings(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_SAYINGS];
  const list = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
  return list.length > 0 ? list : [...DEFAULT_SAYINGS];
}

export function loadStoredSettings(): TumblerSettings {
  const fallback: TumblerSettings = {
    sayings: [...DEFAULT_SAYINGS],
    hasCustomSayings: false,
    flavor: "strawberry",
    softness: "jelly",
    soundEnabled: true,
  };
  if (typeof window === "undefined") return fallback;

  try {
    const raw =
      window.localStorage.getItem(SETTINGS_STORAGE_KEY) ??
      window.localStorage.getItem("tumbler-web-mvp-settings-v4");
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<TumblerSettings>;
    return {
      sayings: normalizeSayings(parsed.sayings),
      hasCustomSayings: Boolean(parsed.hasCustomSayings),
      flavor:
        parsed.flavor && VALID_FLAVORS.has(parsed.flavor) ? parsed.flavor : fallback.flavor,
      softness:
        parsed.softness && VALID_SOFTNESS.has(parsed.softness)
          ? parsed.softness
          : fallback.softness,
      soundEnabled:
        typeof parsed.soundEnabled === "boolean" ? parsed.soundEnabled : fallback.soundEnabled,
    };
  } catch {
    return fallback;
  }
}

export function saveStoredSettings(settings: TumblerSettings): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

function parseCountValue(value: unknown): number | null {
  const count =
    typeof value === "number"
      ? value
      : Number.parseInt(typeof value === "string" ? value : "", 10);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function loadLocalCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    return parseCountValue(window.localStorage.getItem(HISTORY_COUNT_STORAGE_KEY)) ?? 0;
  } catch {
    return 0;
  }
}

export function saveLocalCount(count: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_COUNT_STORAGE_KEY, String(count));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

function normalizeRemoteCount(value: unknown): number | null {
  if (Array.isArray(value)) return parseCountValue(value[0]);
  if (value && typeof value === "object") {
    if ("count" in value) {
      return parseCountValue((value as { count: unknown }).count);
    }
    if ("get_input_count" in value) {
      return parseCountValue((value as { get_input_count: unknown }).get_input_count);
    }
  }
  return parseCountValue(value);
}

async function callCounterApi(method: "GET" | "POST", path: string) {
  if (!COUNTER_API_URL) return null;
  try {
    const response = await fetch(`${COUNTER_API_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: "{}" } : {}),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return normalizeRemoteCount(await response.json());
  } catch {
    return null;
  }
}

export function fetchGlobalInputCount() {
  return callCounterApi("GET", "/count");
}

export function incrementGlobalInputCount() {
  return callCounterApi("POST", "/increment");
}
