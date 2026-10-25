import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'WS Telemetry Analyzer - Real-Time Stream & JSON-RPC DevTools',
    description: 'High-frequency WebSocket Telemetry, JSON-RPC & Real-time Stream Analyzer for Chrome DevTools',
    version: '1.0.2',
    permissions: ['tabs', 'storage'],
    icons: {
      16: 'icon-16.png',
      48: 'icon-48.png',
      128: 'icon-128.png',
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
