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

test("server-renders the tumbler experiment", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>不倒翁互动实验 · MVP<\/title>/i);
  assert.match(html, /互动实验/);
  assert.doesNotMatch(html, /ROLY-POLY \/ TEST 02/);
  assert.match(html, /操作说明/);
  assert.match(html, /动作回放/);
  assert.match(html, /等等就好了/);
  assert.match(html, /自动/);
  assert.match(html, /历史输入/);
  assert.match(html, /LIVE \/ RAPIER 3D/);
  assert.match(html, /three-stage/);
  assert.doesNotMatch(html, /board-crosshair|impact-rings|ground-marker/);
  assert.match(html, /role="application"/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/i);
});

test("keeps the interaction model in the MVP source", async () => {
  const [page, scene, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/tumbler-scene.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /onPointerDown/);
  assert.match(page, /onPointerMove/);
  assert.match(page, /onPointerUp/);
  assert.match(page, /button, input, textarea, label/);
  assert.match(page, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(page, /event\.code === "Space"/);
  assert.match(page, /setHelpOpen/);
  assert.match(page, /settingsOpen/);
  assert.match(page, /settings-panel/);
  assert.match(page, /handleImageChange/);
  assert.match(page, /SETTINGS_STORAGE_KEY/);
  assert.match(page, /HISTORY_COUNT_STORAGE_KEY/);
  assert.match(page, /custom-character\.png/);
  assert.match(page, /autoEnabled/);
  assert.match(page, /setAutoEnabled/);
  assert.match(page, /模拟随机输入/);
  assert.match(page, /totalInputCount/);
  assert.match(page, /recordInput/);
  assert.match(page, /corner-footer/);
  assert.match(page, /speechText/);
  assert.match(page, /history\.slice\(0, 3\)/);
  assert.match(page, /impact: 0/);
  assert.match(page, /z: 0/);
  assert.match(page, /physicsCommandQueueRef/);
  assert.match(page, /type: "hit"/);
  assert.match(page, /type: "release"/);
  assert.match(page, /id: "forward"/);
  assert.match(page, /key === "f"/);
  assert.match(page, /INPUT_REPEAT_INTERVAL_MS/);
  assert.match(page, /AUTO_RETURN_DELAY_MS/);
  assert.match(page, /autoReturnArmedRef/);
  assert.match(page, /自动归位/);
  assert.match(page, /type: "return"/);
  assert.match(page, /setInterval/);
  assert.match(page, /addEventListener\("keyup"/);
  assert.match(page, /pointerRepeatTimerRef/);
  assert.match(page, /stopPointerRepeat/);
  assert.doesNotMatch(page, /if \(event\.repeat\) return/);
  assert.doesNotMatch(page, /impactFlash|flashTimeout|triggerFlash|is-flashing/);
  assert.match(scene, /<Physics gravity=/);
  assert.match(scene, /<RigidBody/);
  assert.match(scene, /<BallCollider/);
  assert.match(scene, /<CapsuleCollider/);
  assert.match(scene, /function BoundaryWalls/);
  assert.match(scene, /verticalCenter/);
  assert.match(scene, /wallThickness/);
  assert.match(scene, /SCREEN_DEPTH_MAX/);
  assert.match(scene, /sideWallX/);
  assert.match(scene, /frontWallZ/);
  assert.match(scene, /ACTION_FORCE_GAIN/);
  assert.match(scene, /TumblerAppearance/);
  assert.match(scene, /useImageTexture/);
  assert.match(scene, /returningRef/);
  assert.match(scene, /function FrontImage/);
  assert.match(scene, /planeGeometry/);
  assert.match(scene, /meshBasicMaterial/);
  assert.match(scene, /applyTorqueImpulse/);
  assert.match(scene, /useFrame/);
  assert.match(scene, /latheGeometry/);
  assert.match(scene, /uprightEuler/);
  assert.doesNotMatch(page, /board-crosshair|impact-rings|ground-marker|impact-wave|ROLY-POLY \/ TEST 02|brand-rule|board-texture|momentum-line/);
  assert.match(css, /--paper:\s*#ffffff/);
  assert.match(css, /\.experiment-board[\s\S]*background:\s*#fff/);
  assert.doesNotMatch(css, /background:\s*#e9e8e0/);
  assert.match(css, /\.subject-zone/);
  assert.match(css, /\.subject-zone[\s\S]*inset:\s*0/);
  assert.match(css, /perspective:\s*1100px/);
  assert.match(css, /\.three-stage/);
  assert.match(css, /\.three-stage canvas/);
  assert.doesNotMatch(css, /board-crosshair|impact-rings|ground-marker|impact-wave/);
  assert.doesNotMatch(css, /is-flashing|filter:\s*brightness/);
  assert.doesNotMatch(page, /tumbler-real\.png/);
  assert.doesNotMatch(css, /\.telemetry-panel|\.action-grid|\.side-column/);
  for (const key of ["left", "right", "uppercut", "stomp", "spin", "backhand", "forward", "super"]) {
    assert.match(page, new RegExp(`id: "${key}"`));
  }

  assert.match(layout, /lang="zh-CN"/);
  assert.match(layout, /不倒翁互动实验 · MVP/);
  assert.doesNotMatch(page, /SkeletonPreview|react-loading-skeleton|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await access(new URL("../public/tumbler-real.png", import.meta.url));
  await access(new URL("../public/custom-character.png", import.meta.url));
  await assert.rejects(
    access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
  );
});
