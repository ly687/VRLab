export type Route =
  | { name: 'home' }
  | { name: 'game'; gameId: string };

export function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [segment, gameId] = hash.split('/');

  if (segment === 'game' && gameId) {
    return { name: 'game', gameId };
  }

  return { name: 'home' };
}

export function goHome(): void {
  window.location.hash = '/';
}

export function goToGame(gameId: string): void {
  window.location.hash = `/game/${gameId}`;
}

