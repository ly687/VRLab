# VRLab Agent Guide

This file records the project rules for coding agents working in this repository.

## Project Overview

VRLab is a Vite + TypeScript browser project for gesture-controlled visual demos.

Core goals:

- Camera-based hand tracking.
- No visible raw camera feed in game scenes.
- Three.js / WebGL visual experiments.
- Classroom-friendly demos with clear HUD and strong visual feedback.

## Tech Stack

- Vite
- TypeScript
- Three.js
- MediaPipe Tasks Vision HandLandmarker
- Browser `getUserMedia`

## Important Commands

Install dependencies:

```bash
npm install
```

Run development server:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Before finishing code changes, run:

```bash
npm run build
```

## Repository Rules

- Do not modify the `参考资料/` directory.
- Reference projects under `参考资料/` are read-only inspiration.
- Production code belongs under `src/`, `docs/`, or project root config files.
- Camera video must stay hidden. It is only an input source for hand tracking.
- Do not add a backend server.
- Prefer focused, modular game folders under `src/games/<game-id>/`.
- Keep reusable tracking logic in `src/core/`.
- Keep shared app metadata in `src/app/gameRegistry.ts`.

## Current App Structure

- `src/app/App.ts`: App shell, home page, game routing.
- `src/app/gameRegistry.ts`: Home page game card metadata.
- `src/core/CameraManager.ts`: Hidden camera video source.
- `src/core/HandTracker.ts`: MediaPipe hand tracking wrapper.
- `src/styles/`: Global design tokens, base styles, shared components.
- `src/games/hand-particle-lab/`: Hand Particle Lab.
- `src/games/void-slasher/`: Void Slasher.
- `src/games/particle-saturn/`: Particle Saturn.
- `src/games/repulsion-orb/`: Repulsion Orb.
- `src/games/quantum-ripple/`: Quantum Ripple.
- `src/games/sword-array/`: Sword Array source is preserved, but its website entry is currently commented out.

## Visual Rules

- Keep the app in a unified dark VR lab / cyber exhibition style.
- Home page cards currently keep only titles, labels, and tags. Descriptive summaries are not rendered.
- Game pages should use fullscreen or large immersive visual stages.
- HUD panels should be readable but should not dominate the main visual.
- Avoid showing the user camera image as a background.
- For new visual experiments, prioritize clarity and classroom readability before advanced effects.

## Game-Specific Notes

### Quantum Ripple

Current state:

- Logic works: hand tracking, HUD, score, missed count, falling anomaly balls.
- Visual design is still under active iteration.
- The current renderer uses CPU-updated `InstancedMesh` hex columns instead of shader deformation.
- See `docs/quantum-ripple-visual-review-for-gemini.md` before changing its visuals.

### Sword Array

- Source code is retained in `src/games/sword-array/`.
- The home card and route import are commented out.
- Do not delete its source unless explicitly requested.

## Documentation

Useful docs:

- `docs/demo-summary.md`
- `docs/frontend-style-guide.md`
- `docs/quantum-ripple-notes.md`
- `docs/quantum-ripple-visual-review-for-gemini.md`
- `docs/void-slasher-notes.md`
- `docs/ktl-migration-notes.md`

When adding a new game, update:

- `src/app/gameRegistry.ts`
- `src/app/App.ts`
- `docs/demo-summary.md`
- `docs/frontend-style-guide.md`
- Add a dedicated notes file under `docs/` when useful.
