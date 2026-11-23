export type FlavorId = "strawberry" | "peach" | "muscat" | "mango" | "soda";
export type SoftnessId = "pudding" | "jelly" | "gummy";

export type JellyFlavor = {
  id: FlavorId;
  name: string;
  swatch: string;
  topColor: string;
  midColor: string;
  bottomColor: string;
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
    id: "strawberry",
    name: "草莓果冻",
    swatch: "#ff5478",
    topColor: "#ff3b6b",
    midColor: "#ff9ebb",
    bottomColor: "#ff668c",
    attenuationColor: "#ff7fa3",
    sssColor: "#ff5c8a",
    rimColor: "#fff2f6",
    backdropTop: "#fff6f8",
    backdropBottom: "#fde2ea",
    floorColor: "#fbe0e8",
    shadowColor: "#eb5982",
    accent: "#ef3e6b",
    attenuationDistance: 2.35,
  },
  {
    id: "peach",
    name: "白桃果冻",
    swatch: "#ff9380",
    topColor: "#ff7568",
    midColor: "#ffd8c7",
    bottomColor: "#ff9e8a",
    attenuationColor: "#ffb8a4",
    sssColor: "#ff9682",
    rimColor: "#fff8f4",
    backdropTop: "#fff8f5",
    backdropBottom: "#fbe7de",
    floorColor: "#f8e2d8",
    shadowColor: "#e07b6b",
    accent: "#e86b58",
    attenuationDistance: 2.6,
  },
  {
    id: "muscat",
    name: "青提果冻",
    swatch: "#4cd480",
    topColor: "#2cc46c",
    midColor: "#c8f7c0",
    bottomColor: "#58d483",
    attenuationColor: "#92f0a3",
    sssColor: "#6be88f",
    rimColor: "#f2fff5",
    backdropTop: "#f3fcf5",
    backdropBottom: "#dff4e5",
    floorColor: "#daf0e0",
    shadowColor: "#46ad6e",
    accent: "#28a85c",
    attenuationDistance: 2.55,
  },
  {
    id: "mango",
    name: "芒果布丁",
    swatch: "#ffb829",
    topColor: "#ff9412",
    midColor: "#ffe275",
    bottomColor: "#ffad29",
    attenuationColor: "#ffcc4d",
    sssColor: "#ffd452",
    rimColor: "#fffbe6",
    backdropTop: "#fffbf0",
    backdropBottom: "#faebd0",
    floorColor: "#f6e5c8",
    shadowColor: "#d98c24",
    accent: "#e38614",
    attenuationDistance: 2.3,
  },
  {
    id: "soda",
    name: "苏打果冻",
    swatch: "#4db8ff",
    topColor: "#2ea3ff",
    midColor: "#bde8ff",
    bottomColor: "#54beff",
    attenuationColor: "#8ad4ff",
    sssColor: "#66c7ff",
    rimColor: "#f2fbff",
    backdropTop: "#f3faff",
    backdropBottom: "#dff0fc",
    floorColor: "#daecf8",
    shadowColor: "#4799db",
    accent: "#258ee6",
    attenuationDistance: 2.65,
  },
];

export const SOFTNESS_PRESETS: SoftnessPreset[] = [
  {
    id: "pudding",
    label: "软糯布丁",
    wobbleStiffness: 56,
    wobbleDamping: 2.4,
    squashStiffness: 72,
    squashDamping: 2.9,
    grabStiffness: 82,
    grabDamping: 3.4,
    wobbleGain: 1.52,
    pokeDepth: 1.42,
    audioPitchScale: 0.82,
  },
  {
    id: "jelly",
    label: "Q弹果冻",
    wobbleStiffness: 102,
    wobbleDamping: 3.2,
    squashStiffness: 126,
    squashDamping: 3.9,
    grabStiffness: 140,
    grabDamping: 4.5,
    wobbleGain: 1.15,
    pokeDepth: 1.12,
    audioPitchScale: 1.0,
  },
  {
    id: "gummy",
    label: "紧实软糖",
    wobbleStiffness: 185,
    wobbleDamping: 5.4,
    squashStiffness: 210,
    squashDamping: 6.4,
    grabStiffness: 225,
    grabDamping: 7.2,
    wobbleGain: 0.78,
    pokeDepth: 0.78,
    audioPitchScale: 1.24,
  },
];

export function getFlavor(id: FlavorId): JellyFlavor {
  return JELLY_FLAVORS.find((item) => item.id === id) ?? JELLY_FLAVORS[0];
}

export function getSoftness(id: SoftnessId): SoftnessPreset {
  return SOFTNESS_PRESETS.find((item) => item.id === id) ?? SOFTNESS_PRESETS[1];
}
