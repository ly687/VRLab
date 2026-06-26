# VRLab

VRLab 是一个基于浏览器的手势交互视觉实验室。项目使用普通摄像头识别手部动作，通过 Three.js / WebGL 在页面中渲染课堂演示友好的视觉实验。

项目不会把原始摄像头画面显示在页面上。摄像头只作为手部追踪输入源，用户看到的是经过设计的可交互视觉场景。

## 功能特点

- 使用 MediaPipe Tasks Vision 进行摄像头手部追踪。
- 使用 Three.js / WebGL 渲染沉浸式视觉实验。
- 摄像头画面保持隐藏，不作为背景或游戏画面展示。
- 支持多个手势控制 Demo，可从首页卡片进入。
- 无需后端服务，安装依赖后即可在本地浏览器运行。
- 适合课堂展示、交互演示和视觉实验原型开发。

## 在线运行方式概览

使用者只需要完成下面几步：

1. 安装 Node.js。
2. 克隆本仓库。
3. 执行 `npm install` 安装依赖。
4. 执行 `npm run dev` 启动本地服务。
5. 在 Chrome 或 Edge 中打开 Vite 输出的本地地址。
6. 授权摄像头权限后开始体验手势交互。

下面有完整步骤。

## 环境要求

推荐环境：

- Node.js 18 或更高版本。
- npm，通常会随 Node.js 一起安装。
- Google Chrome 或 Microsoft Edge。
- 一枚可正常使用的摄像头。
- 首次运行时需要网络连接，用于加载 MediaPipe 的 wasm 和模型资源。

检查 Node.js 是否已安装：

```bash
node -v
npm -v
```

如果命令无法识别，请先从 [Node.js 官网](https://nodejs.org/) 安装 LTS 版本。

## 安装步骤

克隆项目：

```bash
git clone https://github.com/ly687/VRLab.git
cd VRLab
```

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

终端会输出一个本地地址，通常类似：

```txt
http://localhost:5173/
```

把这个地址复制到 Chrome 或 Edge 浏览器中打开。

## 使用方法

1. 打开 VRLab 首页。
2. 点击任意实验卡片进入 Demo。
3. 在 Demo 页面点击开始按钮。
4. 浏览器询问摄像头权限时选择允许。
5. 将手放到摄像头可见区域内。
6. 根据页面 HUD 提示移动手部、捏合或挥动。
7. 需要暂停时点击暂停按钮。
8. 需要切换实验时返回首页重新选择。

注意：页面不会显示摄像头原始画面。如果页面没有明显反应，请确认摄像头权限、光线和手部是否在镜头范围内。

## 当前 Demo

### Hand Particle Lab

基础手势粒子实验。页面会显示发光手部骨架、关键点和柔和拖尾，适合确认摄像头与手部追踪是否正常。

### Void Slasher

使用食指指尖控制刀光轨迹。快速挥动可以切碎漂浮晶体，并触发连击反馈。

### Quantum Ripple

使用手部位置影响六边形地形场，并接住下落的异常球。该实验包含计分、漏接统计和视觉反馈。

### Particle Saturn

使用手势控制粒子土星。捏合距离影响缩放，手掌移动影响旋转。

### Repulsion Orb

红黑色粒子球场景。右手握拳可以排斥粒子，左手捏合可以抓取单个粒子。

### Sword Array

源码保留在项目中，但当前没有在首页开放入口。

## 常用命令

启动本地开发：

```bash
npm run dev
```

构建生产版本：

```bash
npm run build
```

预览生产构建：

```bash
npm run preview
```

## 构建与部署

执行：

```bash
npm run build
```

构建结果会生成在 `dist/` 目录中。`dist/` 是构建产物，不提交到 Git 仓库。

如果要部署到静态网站平台，可以上传 `dist/` 目录中的内容。常见平台包括 GitHub Pages、Vercel、Netlify 或任意静态文件服务器。

部署后需要注意：

- 页面必须通过 `http://localhost` 或 `https://` 打开，浏览器才允许调用摄像头。
- 如果使用普通 `http://` 远程地址，摄像头权限通常会被浏览器拦截。
- MediaPipe 资源需要能从用户网络正常加载。

## 项目结构

```txt
VRLab/
  index.html              # Vite 页面入口
  package.json            # 项目脚本和依赖
  tsconfig.json           # TypeScript 配置
  src/
    app/
      App.ts              # 应用外壳、首页和路由入口
      gameRegistry.ts     # 首页实验卡片元数据
      router.ts           # Hash 路由
      types.ts            # 应用级类型
    core/
      CameraManager.ts    # 隐藏摄像头输入管理
      HandTracker.ts      # MediaPipe HandLandmarker 封装
      types.ts            # 手部追踪共享类型
    effects/
      GlowHandRenderer.ts # 手部骨架绘制
      TrailCanvas.ts      # 拖尾效果辅助
    games/
      hand-particle-lab/
      void-slasher/
      quantum-ripple/
      particle-saturn/
      repulsion-orb/
      sword-array/
    styles/
      tokens.css
      global.css
      components.css
```

## 添加新 Demo 的建议

新实验建议放在：

```txt
src/games/<demo-id>/
```

并更新：

- `src/app/gameRegistry.ts`：添加首页卡片信息。
- `src/app/App.ts`：添加路由加载逻辑。
- 需要复用摄像头和手部追踪时，优先使用 `src/core/CameraManager.ts` 和 `src/core/HandTracker.ts`。

开发时请保持摄像头画面隐藏，只将手部追踪结果用于视觉交互。

## 常见问题

### 浏览器提示摄像头权限被拒绝

点击地址栏中的摄像头图标，重新允许摄像头权限，然后刷新页面。

### 页面没有识别到手

请确认：

- 摄像头没有被会议软件或其他应用占用。
- 浏览器已经允许摄像头权限。
- 手部处于镜头范围内。
- 环境光线足够。
- 使用的是 Chrome 或 Edge。

### Hand tracking 加载失败

项目依赖 MediaPipe 的 wasm 和模型资源。请检查网络是否能访问相关资源。如果网络环境拦截这些文件，手部追踪会初始化失败。


## License

当前项目尚未指定开源许可证。
