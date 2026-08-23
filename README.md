# 不倒翁互动实验

这是一个网页端 3D 不倒翁 MVP，用鼠标和键盘测试受力、失衡、前后景深移动以及自动回正。

以核云作为灵感。

## 示例 Demo

- GitHub 仓库：[xikijinise/tumbler-web-mvp](https://github.com/xikijinise/tumbler-web-mvp)
- GitHub Pages：[打开在线 Demo](https://xikijinise.github.io/tumbler-web-mvp/)

当前仓库保留为私有仓库；如果 GitHub 账号或组织的 Pages 权限限制了私有仓库访问，在线地址需要登录后打开。

## 交互

- 鼠标点击或拖拽：施加连续的三维力量
- `A / D`：向左或向右压倒
- `W / S`：上勾拳或下砸
- `Q / E`：回旋击或反手扫
- `F`：朝观看者方向推动
- `Space`：超载冲击
- `R`：立即归零
- 长按键盘或鼠标：持续受力；停止操作一段时间后自动缓慢回到初始位置
- 设置：自定义不倒翁说的话，并上传头部、中段、底部图片

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
