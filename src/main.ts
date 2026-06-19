import { App } from './app/App';
import './styles/tokens.css';
import './styles/global.css';
import './styles/components.css';

const root = document.getElementById('app');

if (!root) {
  throw new Error('VRLab root element #app was not found.');
}

const app = new App(root);
app.start();

window.addEventListener('beforeunload', () => {
  app.dispose();
});

