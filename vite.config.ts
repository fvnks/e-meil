import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  // Tauri compiles under src-tauri/target; never let Vite recursively watch Rust artifacts.
  server: { strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/target/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: { target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13' },
});
