# 果冻不倒翁互动实验

这是一个网页端 3D 果冻不倒翁 MVP。整个角色使用一个连续的果冻主体，原来的狗头作为嵌入式细节与主体融合，并在点击、拖拽或按键时一起挤压、晃动、失衡和自动回正。

## 示例 Demo

- GitHub 仓库：[xikijinise/tumbler-web-mvp](https://github.com/xikijinise/tumbler-web-mvp)
- GitHub Pages：[打开在线 Demo](https://xikijinise.github.io/tumbler-web-mvp/)
- Supabase：保存 Demo 的全站历史输入计数，不保存访客个人信息

## 交互

- 鼠标点击或拖拽：施加连续的三维力量
- `A / D`：向左或向右压倒
- `W / S`：上勾拳或下砸
- `Q / E`：回旋击或反手扫
- `F`：朝观看者方向推动
- `Space`：超载冲击
- `R`：立即归零
- 长按键盘或鼠标：持续受力；停止操作一段时间后自动缓慢回到初始位置
- 台词气泡：每次反应会在不倒翁身边随机换一个位置
- 底部“自动”：模拟随机输入；右侧“全站历史”：累计所有访客的输入次数
- 设置：自定义互动时的提示语；果冻主体和狗头保持为一个完整的互动模型

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
```

GitHub Pages 使用以下流程生成静态 artifact：

```bash
npm run build
npm run pages:build
```

`pages:build` 会用当前 Vinext SSR 输出生成 `dist/pages/index.html`，并复制 `dist/client` 的 3D 客户端资源；GitHub Actions 随后把该目录发布到 Pages。
