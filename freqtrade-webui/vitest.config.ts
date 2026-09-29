import { defineConfig } from 'vitest/config'

// notify-service 有自己的测试运行器，不归 vitest 管
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
