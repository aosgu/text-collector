import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 纯 Node 环境运行，不依赖任何浏览器 API
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
