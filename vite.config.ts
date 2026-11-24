import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// Maya Secure: no API keys are compiled into the browser bundle.
// The original config inlined GEMINI_API_KEY into the client JavaScript.
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    hmr: process.env.DISABLE_HMR !== 'true',
  },
}));
