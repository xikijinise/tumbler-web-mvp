import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the overhauled 3D jelly tumbler", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>果冻不倒翁 · 3D 软体互动<\/title>/i);
  assert.match(html, /果冻不倒翁/);
  assert.match(html, /全站已戳/);
  assert.match(html, /软糯布丁/);
  assert.match(html, /Q弹果冻/);
  assert.match(html, /紧实软糖/);
  assert.match(html, /自动/);
  assert.match(html, /设置/);
  assert.match(html, /role="application"/);
});

test("uses custom soft-body spring physics, GLSL shader, and suspended pixel dog core", async () => {
  const [page, scene, physics, flavors, audio, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/jelly/JellyScene.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/jelly/physics.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/jelly/flavors.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/jelly/audio.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  // No Rapier dependency left
  assert.doesNotMatch(packageJson, /@react-three\/rapier/);
  assert.doesNotMatch(scene, /@react-three\/rapier|DecalGeometry/);

  // GPU Shader + transmission + internal dog core
  assert.match(scene, /onBeforeCompile/);
  assert.match(scene, /deformJellyPos/);
  assert.match(scene, /transmission:\s*0\.84/);
  assert.match(scene, /transparent:\s*false/);
  assert.match(scene, /custom-character\.png/);
  assert.match(scene, /createStudioEnvironment/);
  assert.match(scene, /handleJellyPointerDown/);

  // Soft-body physics modes
  assert.match(physics, /pokeJelly/);
  assert.match(physics, /startGrabJelly/);
  assert.match(physics, /moveGrabJelly/);
  assert.match(physics, /endGrabJelly/);
  assert.match(physics, /stepJellyPhysics/);

  // Flavors, softness, audio, and UI wiring
  assert.match(flavors, /JELLY_FLAVORS/);
  assert.match(flavors, /SOFTNESS_PRESETS/);
  assert.match(audio, /playPoke/);
  assert.match(audio, /playRelease/);
  assert.match(page, /ThreeJellyScene/);
  assert.match(page, /JELLY_FLAVORS/);
  assert.match(page, /SOFTNESS_PRESETS/);
  assert.match(layout, /lang="zh-CN"/);

  await access(new URL("../public/custom-character.png", import.meta.url));
});
