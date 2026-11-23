export type FlavorId = "classic" | "strawberry" | "pudding" | "muscat" | "peach";
export type SoftnessId = "pudding" | "jelly" | "gummy";

export type JellyFlavor = {
  id: FlavorId;
  name: string;
  swatch: string;
  capColor: string;
  bodyColor: string;
  baseColor: string;
  attenuationColor: string;
  sssColor: string;
  rimColor: string;
  backdropTop: string;
  backdropBottom: string;
  floorColor: string;
  shadowColor: string;
  accent: string;
  attenuationDistance: number;
};

export type SoftnessPreset = {
  id: SoftnessId;
  label: string;
  wobbleStiffness: number;
  wobbleDamping: number;
  squashStiffness: number;
  squashDamping: number;
  grabStiffness: number;
  grabDamping: number;
  wobbleGain: number;
  pokeDepth: number;
  audioPitchScale: number;
};

export const JELLY_FLAVORS: JellyFlavor[] = [
  {
    id: "classic",
    name: "经典红莓",
    swatch: "#f23d52",
    capColor: "#ef2f42",
    bodyColor: "#fff1e8",
    baseColor: "#631e33",
    attenuationColor: "#ffd4c8",
    sssColor: "#ff7e8f",
    rimColor: "#fff6f2",
    backdropTop: "#fff7f8",
    backdropBottom: "#f7e8ec",
    floorColor: "#f5e6ea",
    shadowColor: "#c4566e",
    accent: "#e54861",
    attenuationDistance: 2.4,
  },
  {
    id: "strawberry",
    name: "草莓果冻",
    swatch: "#ff5c84",
    capColor: "#ff3366",
    bodyColor: "#ffc2d1",
    baseColor: "#a81943",
    attenuationColor: "#ff8fab",
    sssColor: "#ff5c8a",
    rimColor: "#fff0f4",
    backdropTop: "#fff5f8",
    backdropBottom: "#fce3ea",
    floorColor: "#f8dfe6",
    shadowColor: "#d94e76",
    accent: "#e84572",
    attenuationDistance: 2.1,
  },
  {
    id: "pudding",
    name: "焦糖布丁",
    swatch: "#f2b830",
    capColor: "#9c400d",
    bodyColor: "#ffe380",
    baseColor: "#6b2907",
    attenuationColor: "#ffcf56",
    sssColor: "#ffdf6b",
    rimColor: "#fffbe6",
    backdropTop: "#fffbf0",
    backdropBottom: "#f7ecd4",
    floorColor: "#f3e7ce",
    shadowColor: "#b87928",
    accent: "#d4851c",
    attenuationDistance: 2.2,
  },
  {
    id: "muscat",
    name: "青提苏打",
    swatch: "#4ec97b",
    capColor: "#28b566",
    bodyColor: "#d2f7c8",
    baseColor: "#176942",
    attenuationColor: "#9ef0a8",
    sssColor: "#75eb95",
    rimColor: "#f2fff5",
    backdropTop: "#f4fcf6",
    backdropBottom: "#e1f4e7",
    floorColor: "#ddf0e3",
    shadowColor: "#429e68",
    accent: "#2ca35e",
    attenuationDistance: 2.5,
  },
  {
    id: "peach",
    name: "白桃蜜冻",
    swatch: "#ff9b85",
    capColor: "#ff7466",
    bodyColor: "#ffe4d6",
    baseColor: "#b04850",
    attenuationColor: "#ffbda8",
    sssColor: "#ffa38f",
    rimColor: "#fff7f2",
    backdropTop: "#fff8f5",
    backdropBottom: "#fae8e0",
    floorColor: "#f6e3db",
    shadowColor: "#d47366",
    accent: "#e36c5b",
    attenuationDistance: 2.6,
  },
];

export const SOFTNESS_PRESETS: SoftnessPreset[] = [
  {
    id: "pudding",
    label: "软糯布丁",
    wobbleStiffness: 68,
    wobbleDamping: 3.1,
    squashStiffness: 85,
    squashDamping: 3.8,
    grabStiffness: 90,
    grabDamping: 4.2,
    wobbleGain: 1.38,
    pokeDepth: 1.32,
    audioPitchScale: 0.84,
  },
  {
    id: "jelly",
    label: "Q弹果冻",
    wobbleStiffness: 118,
    wobbleDamping: 4.1,
    squashStiffness: 145,
    squashDamping: 4.9,
    grabStiffness: 155,
    grabDamping: 5.5,
    wobbleGain: 1.0,
    pokeDepth: 1.0,
    audioPitchScale: 1.0,
  },
  {
    id: "gummy",
    label: "紧实软糖",
    wobbleStiffness: 205,
    wobbleDamping: 6.2,
    squashStiffness: 230,
    squashDamping: 7.4,
    grabStiffness: 240,
    grabDamping: 8.0,
    wobbleGain: 0.68,
    pokeDepth: 0.72,
    audioPitchScale: 1.24,
  },
];

export function getFlavor(id: FlavorId): JellyFlavor {
  return JELLY_FLAVORS.find((item) => item.id === id) ?? JELLY_FLAVORS[0];
}

export function getSoftness(id: SoftnessId): SoftnessPreset {
  return SOFTNESS_PRESETS.find((item) => item.id === id) ?? SOFTNESS_PRESETS[1];
}
