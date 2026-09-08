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

function drawJellyPath(context: CanvasRenderingContext2D, wobble = 0, bulge = 0) {
  const sway = wobble * 5;
  const lowerBulge = bulge * 8;
  context.beginPath();
  context.moveTo(200 + sway, 32);
  context.bezierCurveTo(145 + sway, 18, 94, 35, 68, 79);
  context.bezierCurveTo(51, 108, 51, 140, 52, 163);
  context.bezierCurveTo(52, 176, 63, 181, 78, 185);
  context.bezierCurveTo(84, 187, 88, 194, 85, 207);
  context.bezierCurveTo(73 + lowerBulge, 236, 60 + lowerBulge, 271, 51 + lowerBulge, 321);
  context.bezierCurveTo(40 + lowerBulge, 378, 43 + lowerBulge, 430, 62 + lowerBulge, 464);
  context.bezierCurveTo(86 + lowerBulge, 502, 138, 514, 200, 516);
  context.bezierCurveTo(262 - lowerBulge, 514, 314 - lowerBulge, 502, 338 - lowerBulge, 464);
  context.bezierCurveTo(357 - lowerBulge, 430, 360 - lowerBulge, 378, 349 - lowerBulge, 321);
  context.bezierCurveTo(340 - lowerBulge, 271, 327 - lowerBulge, 236, 315, 207);
  context.bezierCurveTo(312, 194, 316, 187, 322, 185);
  context.bezierCurveTo(337, 181, 348, 176, 348, 163);
  context.bezierCurveTo(349, 140, 349, 108, 332, 79);
  context.bezierCurveTo(306, 35, 255 - sway, 18, 200 + sway, 32);
  context.closePath();
}

function drawJellyCapPath(context: CanvasRenderingContext2D, wobble = 0) {
  const sway = wobble * 4;
  context.beginPath();
  context.moveTo(52 + sway, 164);
  context.bezierCurveTo(51, 112, 55, 83, 78, 56);
  context.bezierCurveTo(105, 25, 148 + sway, 18, 200 + sway, 32);
  context.bezierCurveTo(252 + sway, 18, 295, 25, 322, 56);
  context.bezierCurveTo(345, 83, 349, 112, 348 - sway, 164);
  context.bezierCurveTo(348, 176, 337, 181, 322, 185);
  context.bezierCurveTo(281, 190, 119, 190, 78, 185);
  context.bezierCurveTo(63, 181, 52, 176, 52 + sway, 164);
  context.closePath();
}

function makeFusedDogCanvas(image: HTMLImageElement) {
  const source = document.createElement("canvas");
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  source.width = sourceWidth;
  source.height = Math.max(1, Math.round(sourceHeight * 0.68));
  const sourceContext = source.getContext("2d");
  if (!sourceContext || !source.width || !source.height) return source;

  // Keep the face and trim the lower character body; the transparent crop is
  // then drawn behind the jelly film so it reads as a submerged face.
  sourceContext.imageSmoothingEnabled = false;
  sourceContext.drawImage(
    image,
    Math.round(sourceWidth * 0.04),
    0,
    Math.round(sourceWidth * 0.92),
    Math.round(sourceHeight * 0.68),
    0,
    0,
    source.width,
    source.height,
  );
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const index = (y * source.width + x) * 4;
      const red = pixels.data[index];
      const green = pixels.data[index + 1];
      const blue = pixels.data[index + 2];
      const isYellowBackdrop =
        red > 160 && green > 130 && blue < 150 && red > blue * 1.45 && green > blue * 1.3;
      if (isYellowBackdrop) {
        pixels.data[index + 3] = 0;
        continue;
      }

      const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
      const shade = 0.5 + luminance * 0.62;
      const darkFeature = luminance < 0.2;
      const dogBlue = blue > red * 1.12 && blue > green * 1.05;
      pixels.data[index] = Math.round(
        darkFeature ? 92 + red * 0.1 : dogBlue ? 112 + 64 * shade : 236 * shade,
      );
      pixels.data[index + 1] = Math.round(
        darkFeature ? 48 + green * 0.1 : dogBlue ? 142 + 42 * shade : 108 * shade,
      );
      pixels.data[index + 2] = Math.round(
        darkFeature ? 70 + blue * 0.12 : dogBlue ? 184 + 38 * shade : 140 * shade,
      );

      // Fade the original circular edge into the surrounding volume. This is
      // what prevents the dog from looking like a separate sticker.
      const dx = (x / source.width - 0.5) / 0.53;
      const dy = (y / source.height - 0.42) / 0.66;
      const edge = Math.hypot(dx, dy);
      const edgeFade = clamp(1 - Math.max(0, edge - 0.54) * 0.8, 0.32, 1);
      pixels.data[index + 3] = Math.round(pixels.data[index + 3] * 0.58 * edgeFade);
    }
  }
  sourceContext.putImageData(pixels, 0, 0);
  return source;
}

function drawFusedFallback(
  canvas: HTMLCanvasElement,
  dogCanvas: HTMLCanvasElement | null,
  motion: JellyFallbackMotion,
  time: number,
) {
  const width = 400;
  const height = 540;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  canvas.style.aspectRatio = `${width} / ${height}`;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const impact = clamp(motion.impact, 0, 1.35);
  const idleWobble = Math.sin(time * 0.0024) * 0.014;
  const tilt = (motion.angle * Math.PI) / 180 * 0.65 + idleWobble;
  const squash = 1 + impact * 0.26;
  const stretch = 1 - impact * 0.17;
  const shapeWobble = Math.sin(time * 0.005) * 0.72 + motion.x * 0.008;
  const shapeBulge =
    Math.sin(time * 0.006 + 1.2) * 0.8 + motion.y * 0.032 + Math.sin(time * 0.032) * impact * 1.8;

  canvas.style.transform = `translate3d(${clamp(motion.x, -116, 116)}px, ${clamp(motion.y, -74, 74)}px, 0) rotate(-2deg)`;
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate(tilt);
  context.scale(squash, stretch);
  context.translate(-width / 2, -height / 2);

  // Grounded soft shadow: the cap, body, and weighted base are one volume.
  drawJellyPath(context, shapeWobble, shapeBulge);
  context.save();
  context.translate(0, 12);
  context.shadowColor = "rgba(143, 27, 76, 0.27)";
  context.shadowBlur = 34;
  context.shadowOffsetY = 24;
  context.fillStyle = "rgba(181, 52, 104, 0.46)";
  context.fill();
  context.restore();

  drawJellyPath(context, shapeWobble, shapeBulge);
  context.save();
  context.clip();

  // Preserve the recognizable tumbler silhouette with continuous translucent
  // color changes: red jelly crown, soft body, and a darker weighted bottom.
  const bodyGradient = context.createLinearGradient(0, 28, 0, 520);
  bodyGradient.addColorStop(0, "rgba(223, 34, 26, 0.98)");
  bodyGradient.addColorStop(0.2, "rgba(239, 52, 37, 0.98)");
  bodyGradient.addColorStop(0.32, "rgba(247, 117, 103, 0.9)");
  bodyGradient.addColorStop(0.36, "rgba(255, 240, 209, 0.94)");
  bodyGradient.addColorStop(0.62, "rgba(250, 241, 218, 0.96)");
  bodyGradient.addColorStop(0.76, "rgba(241, 230, 204, 0.98)");
  bodyGradient.addColorStop(0.81, "rgba(218, 208, 184, 0.98)");
  bodyGradient.addColorStop(0.84, "rgba(82, 80, 83, 0.98)");
  bodyGradient.addColorStop(1, "rgba(28, 28, 34, 1)");
  context.fillStyle = bodyGradient;
  context.fillRect(0, 0, width, height);

  const capGradient = context.createLinearGradient(80, 26, 318, 193);
  capGradient.addColorStop(0, "rgba(255, 198, 178, 0.34)");
  capGradient.addColorStop(0.3, "rgba(255, 85, 68, 0.22)");
  capGradient.addColorStop(0.72, "rgba(183, 18, 28, 0.2)");
  capGradient.addColorStop(1, "rgba(255, 216, 202, 0.08)");
  context.save();
  context.globalCompositeOperation = "screen";
  context.clip();
  drawJellyCapPath(context, shapeWobble);
  context.fillStyle = capGradient;
  context.fill();
  context.restore();

  const volumeShade = context.createRadialGradient(200, 248, 34, 200, 282, 286);
  volumeShade.addColorStop(0, "rgba(255, 255, 255, 0)");
  volumeShade.addColorStop(0.55, "rgba(119, 65, 52, 0.035)");
  volumeShade.addColorStop(1, "rgba(46, 35, 42, 0.24)");
  context.globalCompositeOperation = "multiply";
  context.fillStyle = volumeShade;
  context.fillRect(0, 0, width, height);

  const innerScatter = context.createRadialGradient(192, 272, 10, 192, 282, 274);
  innerScatter.addColorStop(0, "rgba(255, 245, 249, 0.36)");
  innerScatter.addColorStop(0.5, "rgba(255, 203, 160, 0.12)");
  innerScatter.addColorStop(1, "rgba(118, 75, 55, 0.08)");
  context.globalCompositeOperation = "screen";
  context.fillStyle = innerScatter;
  context.fillRect(0, 0, width, height);

  const weightedBase = context.createLinearGradient(0, 376, 0, 520);
  weightedBase.addColorStop(0, "rgba(72, 13, 59, 0)");
  weightedBase.addColorStop(0.3, "rgba(71, 13, 59, 0.1)");
  weightedBase.addColorStop(0.76, "rgba(47, 9, 48, 0.36)");
  weightedBase.addColorStop(1, "rgba(27, 6, 33, 0.58)");
  context.globalCompositeOperation = "multiply";
  context.fillStyle = weightedBase;
  context.fillRect(0, 0, width, height);

  const dogX = 91 + Math.sin(time * 0.004) * impact * 3;
  const dogY = 226 + motion.y * 0.15;
  const dogWidth = 204 * (1 + impact * 0.08);
  const dogHeight = 150 * (1 - impact * 0.06);
  if (dogCanvas) {
    const dogHaze = context.createRadialGradient(200, 298, 20, 200, 298, 152);
    dogHaze.addColorStop(0, "rgba(255, 219, 231, 0.2)");
    dogHaze.addColorStop(0.68, "rgba(255, 151, 188, 0.06)");
    dogHaze.addColorStop(1, "rgba(255, 151, 188, 0)");
    context.globalCompositeOperation = "screen";
    context.fillStyle = dogHaze;
    context.fillRect(48, 176, 304, 274);

    context.globalCompositeOperation = "multiply";
    context.save();
    context.filter = "blur(6px) saturate(0.5)";
    context.globalAlpha = 0.16;
    context.drawImage(dogCanvas, dogX + 3, dogY + 8, dogWidth, dogHeight);
    context.restore();

    context.globalCompositeOperation = "source-over";
    context.save();
    context.filter = "blur(2px) saturate(0.52) contrast(0.82)";
    context.globalAlpha = 0.56;
    context.drawImage(dogCanvas, dogX, dogY, dogWidth, dogHeight);
    context.restore();

    const dogPocket = context.createRadialGradient(200, 300, 22, 200, 300, 150);
    dogPocket.addColorStop(0, "rgba(120, 73, 70, 0.14)");
    dogPocket.addColorStop(0.58, "rgba(120, 73, 70, 0.06)");
    dogPocket.addColorStop(1, "rgba(120, 73, 70, 0)");
    context.globalCompositeOperation = "multiply";
    context.fillStyle = dogPocket;
    context.fillRect(48, 176, 304, 274);
  }

  // A front refraction film crosses the dog and ties it into the same volume.
  const jellyVeil = context.createLinearGradient(58, 70, 342, 486);
  jellyVeil.addColorStop(0, "rgba(255, 255, 255, 0.18)");
  jellyVeil.addColorStop(0.38, "rgba(255, 242, 214, 0.08)");
  jellyVeil.addColorStop(0.76, "rgba(224, 177, 148, 0.1)");
  jellyVeil.addColorStop(1, "rgba(72, 53, 54, 0.2)");
  context.globalCompositeOperation = "source-over";
  context.fillStyle = jellyVeil;
  context.fillRect(0, 0, width, height);

  const sheen = context.createRadialGradient(118, 73, 4, 139, 106, 190);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.78)");
  sheen.addColorStop(0.36, "rgba(255, 242, 247, 0.3)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.globalCompositeOperation = "screen";
  context.fillStyle = sheen;
  context.fillRect(0, 0, width, height);

  const lowerCaustic = context.createRadialGradient(200, 478, 4, 200, 478, 136);
  lowerCaustic.addColorStop(0, "rgba(255, 224, 235, 0.42)");
  lowerCaustic.addColorStop(0.5, "rgba(255, 189, 216, 0.13)");
  lowerCaustic.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = lowerCaustic;
  context.fillRect(0, 0, width, height);

  // Tint the artwork again after the face is drawn. The color pass follows the
  // body curvature and removes the last flat, printed-surface impression.
  const submergedColor = context.createLinearGradient(54, 176, 350, 450);
  submergedColor.addColorStop(0, "rgba(255, 238, 222, 0.12)");
  submergedColor.addColorStop(0.52, "rgba(210, 155, 113, 0.16)");
  submergedColor.addColorStop(1, "rgba(58, 38, 43, 0.24)");
  context.globalCompositeOperation = "soft-light";
  context.fillStyle = submergedColor;
  context.fillRect(0, 0, width, height);

  context.globalAlpha = 0.62;
  context.strokeStyle = "rgba(255, 255, 255, 0.56)";
  context.lineCap = "round";
  context.lineWidth = 16;
  context.beginPath();
  context.moveTo(104, 72);
  context.bezierCurveTo(74, 124, 78, 184, 92, 205);
  context.bezierCurveTo(70, 264, 76, 356, 104, 407);
  context.stroke();

  context.globalAlpha = 0.22;
  context.lineWidth = 9;
  context.beginPath();
  context.moveTo(139, 234);
  context.bezierCurveTo(178, 258, 236, 267, 278, 246);
  context.stroke();

  context.globalAlpha = 0.28;
  context.lineWidth = 7;
  context.beginPath();
  context.moveTo(306, 88);
  context.bezierCurveTo(332, 142, 328, 190, 310, 214);
  context.bezierCurveTo(332, 280, 328, 354, 306, 410);
  context.stroke();

  // Soft cap lip and weighted-base reflection keep the old tumbler readable
  // without splitting the object into separate render layers.
  context.globalAlpha = 0.32;
  context.globalCompositeOperation = "screen";
  context.strokeStyle = "rgba(255, 239, 214, 0.54)";
  context.lineWidth = 11;
  context.beginPath();
  context.moveTo(58, 419);
  context.bezierCurveTo(126, 443, 274, 443, 342, 419);
  context.stroke();

  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 0.34;
  context.strokeStyle = "rgba(176, 21, 29, 0.5)";
  context.lineWidth = 10;
  context.beginPath();
  context.moveTo(62, 176);
  context.bezierCurveTo(124, 191, 276, 191, 338, 176);
  context.stroke();

  context.globalAlpha = 0.32;
  context.strokeStyle = "rgba(255, 255, 255, 0.56)";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(62, 174);
  context.bezierCurveTo(124, 188, 276, 188, 338, 174);
  context.stroke();

  context.globalAlpha = 0.2;
  context.strokeStyle = "rgba(255, 245, 224, 0.5)";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(58, 422);
  context.bezierCurveTo(126, 445, 274, 445, 342, 422);
  context.stroke();

  context.globalAlpha = 0.32;
  context.lineWidth = 8;
  context.strokeStyle = "rgba(255, 255, 255, 0.22)";
  context.beginPath();
  context.moveTo(58, 421);
  context.bezierCurveTo(126, 448, 274, 448, 342, 421);
  context.stroke();
  context.restore();

  drawJellyPath(context, shapeWobble, shapeBulge);
  context.strokeStyle = "rgba(255, 226, 237, 0.72)";
  context.lineWidth = 2.2;
  context.shadowColor = "rgba(255, 188, 214, 0.24)";
  context.shadowBlur = 10;
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
    let dogCanvas: HTMLCanvasElement | null = null;
    let animationFrame = 0;
    let active = true;
    const render = (time: number) => {
      if (!active) return;
      drawFusedFallback(canvas, dogCanvas, motionRef.current, time);
      motionRef.current.angle *= 0.965;
      motionRef.current.x *= 0.982;
      motionRef.current.y *= 0.982;
      motionRef.current.impact *= 0.955;
      animationFrame = window.requestAnimationFrame(render);
    };
    image.onload = () => {
      dogCanvas = makeFusedDogCanvas(image);
    };
    image.src = "./custom-character.png";
    // Paint the translucent body immediately. The dog artwork is an interior
    // layer and may arrive later over a slow mobile connection; the page must
    // never be blank while that asset is loading.
    animationFrame = window.requestAnimationFrame(render);
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
        x: clamp(current.x + dx * 0.9, -116, 116),
        y: clamp(current.y - dy * 0.72, -74, 74),
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
