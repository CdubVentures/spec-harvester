import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const buildId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query', '@tanstack/react-table'],
          'vendor-charts': ['recharts'],
          'vendor-ui': ['zustand', '@radix-ui/react-tooltip'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8788',
        ws: true,
      },
    },
  },
});
