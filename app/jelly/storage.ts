import type { FlavorId, SoftnessId } from "./flavors";

export type TumblerSettings = {
  sayings: string[];
  flavor: FlavorId;
  softness: SoftnessId;
  soundEnabled: boolean;
};

export const SETTINGS_STORAGE_KEY = "tumbler-web-mvp-settings-v4";
export const HISTORY_COUNT_STORAGE_KEY = "tumbler-web-mvp-history-count-v1";
export const DEFAULT_SAYINGS = [
  "duang~",
  "别戳了，要化了",
  "Q弹！",
  "等等就好了",
  "明天就好了",
  "好痒啊",
];

const SUPABASE_PROJECT_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://uipntxlrfctydhgxmxjd.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpcG50eGxyZmN0eWRoZ3hteGpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0OTE3MzYsImV4cCI6MjEwMzA2NzczNn0.6c9b4kc37umD7ejz7m01reJLcNm0FBKMH18sitkCboY";

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
    flavor: "strawberry",
    softness: "jelly",
    soundEnabled: true,
  };
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<TumblerSettings>;
    return {
      sayings: normalizeSayings(parsed.sayings),
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
  if (value && typeof value === "object" && "get_input_count" in value) {
    return parseCountValue((value as { get_input_count: unknown }).get_input_count);
  }
  return parseCountValue(value);
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

export function fetchGlobalInputCount() {
  return callCountRpc("get_input_count");
}

export function incrementGlobalInputCount() {
  return callCountRpc("increment_input_count");
}
