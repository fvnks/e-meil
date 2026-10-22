import { mount } from 'svelte';
import App from './App.svelte';
import './styles.css';
import { isTauri } from '@tauri-apps/api/core';
import { Window, getCurrentWindow } from '@tauri-apps/api/window';

const startedAt = performance.now();
mount(App, { target: document.getElementById('app')! });

// Splash de arranque: "splashscreen" se muestra al instante (tauri.conf.json)
// y la ventana "main" permanece oculta hasta que el frontend terminó de
// montarse. Aquí se revela main y se cierra el splash, garantizando un
// mínimo de presencia para que no sea un parpadeo.
const SPLASH_MIN_MS = 900;
if (isTauri()) {
  const dismissSplash = async () => {
    try {
      const main = getCurrentWindow();
      const splash = await Window.getByLabel('splashscreen');
      await main.show();
      await main.setFocus();
      await splash?.close();
    } catch (error) {
      console.warn('No se pudo cerrar el splash screen:', error);
    }
  };
  const elapsed = performance.now() - startedAt;
  window.setTimeout(dismissSplash, Math.max(0, SPLASH_MIN_MS - elapsed));
}
