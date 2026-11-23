# 果冻不倒翁 · 3D 软体互动

这是一个基于 Three.js + GLSL 顶点着色器 + 自研软体弹簧引擎打造的 3D 果冻不倒翁网页互动玩具。果冻外壳具有实时折射、菲涅尔透光与局部按压形变，内部悬浮嵌入像素狗头夹心，支持直接戳压、拉扯回弹、多口味与软硬度切换，以及 Web Audio 程序化果冻音效。

## 在线体验

- GitHub 仓库：[xikijinise/tumbler-web-mvp](https://github.com/xikijinise/tumbler-web-mvp)
- GitHub Pages：[打开在线 Demo](https://xikijinise.github.io/tumbler-web-mvp/)

## 核心特性

- **自研软体弹簧引擎**（`app/jelly/physics.ts`）：低重心钟摆回正、顶部惯性滞后甩动（Secondary Wobble）、体积守恒挤压拉伸（Squash & Stretch）、扭转回弹与悬浮夹心延迟跟随。
- **GPU GLSL 果冻形变与光学折射**（`app/jelly/JellyScene.tsx`）：在 GPU 顶点着色器中实时计算局部高斯按压凹陷、表面涟漪与法线扰动，配合程序化棚拍环境反射与 `MeshPhysicalMaterial` 折射，透过晶莹果冻直接折射内部的像素狗头夹心。
- **直觉触控与拖拽**：
  - 点击果冻：在精确命中点产生凹陷涟漪与 Q 弹回晃
  - 按住拖拽：揪住果冻表面拉长并带动不倒翁倾斜，松手“duang”地弹回并甩出惯性
  - 键盘招式：`A / D` 推倒、`W / S` 弹飞或按扁、`Q / E` 旋转或猛甩、`F` 贴脸、`Space` 超载抖动、`R` 归位
- **多口味与软硬度**：支持经典红莓、草莓果冻、焦糖布丁、青提苏打、白桃蜜冻 5 种口味，以及软糯布丁 / Q弹果冻 / 紧实软糖 3 档软硬度。
- **程序化果冻音效**（`app/jelly/audio.ts`）：使用 Web Audio 实时合成随力度与软硬度变化的“duang / boing”音效。

## 本地运行

要求 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 构建与测试

```bash
npm run lint
npm test
npm run pages:build
```
