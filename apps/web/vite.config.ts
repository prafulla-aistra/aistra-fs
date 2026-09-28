import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
      // Resolve workspace packages (e.g. @finance-close/shared) from their TypeScript source.
      conditions: ['@finance-close/source', ...defaultClientConditions],
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        // xfwd: pass the browser's IP to the API (X-Forwarded-For) for the audit log.
        '/api': {
          target: env.API_PROXY_TARGET || 'http://localhost:3000',
          changeOrigin: true,
          xfwd: true,
        },
      },
    },
  };
});
