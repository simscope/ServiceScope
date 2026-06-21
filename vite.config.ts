import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const supabaseUrl = env.VITE_SUPABASE_URL?.replace(/\/$/, '');

  return {
    plugins: [react()],
    server: supabaseUrl
      ? {
          proxy: {
            '/supabase': {
              target: supabaseUrl,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/supabase/, ''),
            },
          },
        }
      : undefined,
  };
});
