import { HandParticleLab } from '../games/hand-particle-lab';
import { ParticleSaturn } from '../games/particle-saturn';
import { QuantumRipple } from '../games/quantum-ripple';
import { RepulsionOrb } from '../games/repulsion-orb';
// Sword Array 源码保留在 src/games/sword-array/，当前先从网站入口下线。
// import { SwordArray } from '../games/sword-array';
import { VoidSlasher } from '../games/void-slasher';
import { gameRegistry, getGameDefinition } from './gameRegistry';
import { goHome, goToGame, parseRoute, type Route } from './router';
import type { DisposableGame, GameDefinition } from './types';

export class App {
  private readonly root: HTMLElement;
  private currentGame: DisposableGame | null = null;
  private readonly handleRouteChange = () => this.renderCurrentRoute();

  constructor(root: HTMLElement) {
    this.root = root;
  }

  start(): void {
    window.addEventListener('hashchange', this.handleRouteChange);
    this.renderCurrentRoute();
  }

  dispose(): void {
    window.removeEventListener('hashchange', this.handleRouteChange);
    this.currentGame?.dispose();
    this.currentGame = null;
  }

  private renderCurrentRoute(): void {
    const route = parseRoute();
    this.currentGame?.dispose();
    this.currentGame = null;
    this.root.innerHTML = '';

    if (route.name === 'home') {
      this.renderHome();
      return;
    }

    this.renderGame(route);
  }

  private renderHome(): void {
    const shell = document.createElement('main');
    shell.className = 'app-shell home-shell';
    shell.innerHTML = `
      <div class="ambient-field" aria-hidden="true">
        <span class="scan-line scan-line-a"></span>
        <span class="scan-line scan-line-b"></span>
      </div>

      <section class="hero-panel">
        <div class="hero-copy">
          <p class="eyebrow">NJUST Interactive Web Lab</p>
          <h1>VRLab</h1>
          <p class="subtitle">Gesture-Controlled Visual Reality Lab</p>
        </div>
        <div class="hero-orbit" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </section>

      <section class="game-section" aria-labelledby="game-list-title">
        <div class="section-heading">
          <p class="eyebrow">Experiments</p>
          <h2 id="game-list-title">选择一个手势实验</h2>
        </div>
        <div class="game-grid"></div>
      </section>
    `;

    const grid = shell.querySelector<HTMLElement>('.game-grid');
    if (!grid) {
      throw new Error('Home game grid was not created.');
    }

    for (const game of gameRegistry) {
      grid.appendChild(this.createGameCard(game));
    }

    this.root.appendChild(shell);
  }

  private createGameCard(game: GameDefinition): HTMLButtonElement {
    const card = document.createElement('button');
    card.className = `game-card game-card-${game.accent}`;
    card.type = 'button';
    card.disabled = game.status !== 'available';
    card.innerHTML = `
      <div class="game-card-glow"></div>
      <div class="game-card-topline">
        <span>${game.eyebrow}</span>
        <span class="status-pill">${game.status === 'available' ? 'Live Demo' : 'Soon'}</span>
      </div>
      <h3>${game.title}</h3>
      <div class="gesture-list">
        ${game.gestures.map((gesture) => `<span>${gesture}</span>`).join('')}
      </div>
    `;

    if (game.status === 'available') {
      card.addEventListener('click', () => goToGame(game.id));
    }

    return card;
  }

  private renderGame(route: Extract<Route, { name: 'game' }>): void {
    const game = getGameDefinition(route.gameId);

    if (!game) {
      this.renderNotFound();
      return;
    }

    const gameRoot = document.createElement('main');
    gameRoot.className = 'app-shell game-shell';
    this.root.appendChild(gameRoot);

    if (game.id === 'hand-particle-lab') {
      this.currentGame = new HandParticleLab(gameRoot, {
        onBack: () => goHome(),
      });
    } else if (game.id === 'particle-saturn') {
      this.currentGame = new ParticleSaturn(gameRoot, {
        onBack: () => goHome(),
      });
    } else if (game.id === 'quantum-ripple') {
      this.currentGame = new QuantumRipple(gameRoot, {
        onBack: () => goHome(),
      });
    // } else if (game.id === 'sword-array') {
    //   this.currentGame = new SwordArray(gameRoot, {
    //     onBack: () => goHome(),
    //   });
    } else if (game.id === 'repulsion-orb') {
      this.currentGame = new RepulsionOrb(gameRoot, {
        onBack: () => goHome(),
      });
    } else if (game.id === 'void-slasher') {
      this.currentGame = new VoidSlasher(gameRoot, {
        onBack: () => goHome(),
      });
    } else {
      this.renderNotFound();
      return;
    }

    void this.currentGame.start();
  }

  private renderNotFound(): void {
    const panel = document.createElement('main');
    panel.className = 'app-shell center-shell';
    panel.innerHTML = `
      <section class="empty-state-panel">
        <p class="eyebrow">Route unavailable</p>
        <h1>这个实验还没接入</h1>
        <p>返回首页选择当前可运行的实验。</p>
        <button class="primary-button" type="button">返回首页</button>
      </section>
    `;

    panel.querySelector('button')?.addEventListener('click', () => goHome());
    this.root.appendChild(panel);
  }
}
