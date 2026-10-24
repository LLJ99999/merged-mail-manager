import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

// 应用版本唯一来源：仓库根目录的 VERSION 文件
const APP_VERSION = (() => {
  try { return fs.readFileSync(path.resolve(__dirname, '../VERSION'), 'utf8').replace(/^\uFEFF/, '').trim().split(/\s+/)[0] || 'dev'; } catch { return 'dev'; }
})();

/** 构建结束后写 dist/.version（start.bat / start.sh 据此判断是否需要重新构建；服务端 /api/version 读取它） */
function versionStamp(): Plugin {
  return {
    name: 'mm-version-stamp',
    apply: 'build',
    closeBundle() {
      const out = path.resolve(__dirname, 'dist');
      if (fs.existsSync(out)) fs.writeFileSync(path.join(out, '.version'), APP_VERSION + '\n');
    },
  };
}

export default defineConfig({
  plugins: [react(), versionStamp()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: id => (id.includes('node_modules') && !id.includes('@fontsource') ? 'vendor' : undefined),
      },
    },
  },
});
