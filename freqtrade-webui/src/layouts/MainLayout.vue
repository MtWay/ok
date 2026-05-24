<template>
  <div class="main-layout">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="logo">
        <div class="logo-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div class="logo-text">
          <h2>Freqtrade</h2>
          <p>OKEX 回测中心</p>
        </div>
      </div>

      <nav class="nav-menu">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: $route.path === item.path }"
        >
          <el-icon :size="18">
            <component :is="item.icon" />
          </el-icon>
          <span>{{ item.label }}</span>
          <div class="nav-indicator" />
        </router-link>
      </nav>

      <div class="sidebar-footer">
        <div class="version">v2.0.0</div>
      </div>
    </aside>

    <!-- Main Content -->
    <div class="content-wrapper">
      <!-- Header -->
      <header class="header">
        <div class="header-left">
          <h1>{{ pageTitle }}</h1>
          <p>{{ pageSubtitle }}</p>
        </div>
        <div class="header-right">
          <div class="data-source-badge" :class="{ online: store.isRealData }">
            <span class="status-dot" />
            <span class="status-text">{{ store.isRealData ? 'OKX 实时' : '模拟数据' }}</span>
          </div>
        </div>
      </header>

      <!-- Main -->
      <main class="main-content">
        <el-alert
          v-if="store.errorMessage"
          :title="store.errorMessage"
          type="error"
          closable
          @close="store.clearError"
          class="error-alert"
        />
        <router-view v-loading="store.isLoading" :element-loading-text="store.loadingText" />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useBacktestStore } from '@/stores/backtest'
import { TrendCharts, Search, SetUp, CircleCheck } from '@element-plus/icons-vue'

const store = useBacktestStore()
const route = useRoute()

const navItems = [
  { path: '/backtest', label: '回测结果', icon: TrendCharts },
  { path: '/scan', label: '多品种扫描', icon: Search },
  { path: '/optimize', label: '参数优化', icon: SetUp },
  { path: '/validate', label: '区间验证', icon: CircleCheck },
]

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  '/backtest': { title: '回测结果', subtitle: '策略回测与可视化分析' },
  '/scan': { title: '多品种扫描', subtitle: '批量扫描市场机会' },
  '/optimize': { title: '参数优化', subtitle: '寻找最优参数组合' },
  '/validate': { title: '移动区间验证', subtitle: '滑动窗口验证推荐准确性' },
}

const pageInfo = computed(() => pageTitles[route.path] || pageTitles['/backtest'])
const pageTitle = computed(() => pageInfo.value.title)
const pageSubtitle = computed(() => pageInfo.value.subtitle)
</script>

<style scoped lang="scss">
.main-layout {
  display: flex;
  min-height: 100vh;
  background: var(--bg-primary);
}

/* Sidebar */
.sidebar {
  width: 240px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 100;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.04);
}

.logo {
  padding: 28px 24px;
  display: flex;
  align-items: center;
  gap: 14px;
  border-bottom: 1px solid var(--border-light);

  .logo-icon {
    width: 40px;
    height: 40px;
    background: var(--gradient-gold);
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    flex-shrink: 0;
    box-shadow: var(--shadow-glow-gold);

    svg {
      width: 22px;
      height: 22px;
    }
  }

  .logo-text {
    h2 {
      font-size: 1.15rem;
      font-weight: 800;
      color: var(--text-primary);
      letter-spacing: -0.02em;
      line-height: 1.2;
    }

    p {
      font-size: 0.72rem;
      color: var(--text-tertiary);
      margin-top: 2px;
      font-weight: 500;
      letter-spacing: 0.02em;
    }
  }
}

.nav-menu {
  flex: 1;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.88rem;
  font-weight: 600;
  transition: all var(--transition-fast);
  position: relative;
  overflow: hidden;

  .nav-indicator {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 0;
    background: var(--gradient-gold);
    border-radius: 0 2px 2px 0;
    transition: height var(--transition-base);
  }

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.active {
    background: var(--accent-gold-dim);
    color: var(--accent-gold);

    .nav-indicator {
      height: 24px;
    }
  }

  span {
    flex: 1;
  }
}

.sidebar-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--border-light);

  .version {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-family: 'JetBrains Mono', monospace;
    text-align: center;
  }
}

/* Content Wrapper */
.content-wrapper {
  flex: 1;
  margin-left: 240px;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* Header */
.header {
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-light);
  padding: 20px 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: sticky;
  top: 0;
  z-index: 50;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.header-left {
  h1 {
    font-size: 1.35rem;
    font-weight: 800;
    color: var(--text-primary);
    letter-spacing: -0.02em;
    line-height: 1.2;
  }

  p {
    color: var(--text-tertiary);
    margin-top: 4px;
    font-size: 0.82rem;
    font-weight: 500;
  }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.data-source-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-light);
  border-radius: 100px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-tertiary);
  transition: all var(--transition-fast);

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-red);
    position: relative;

    &::after {
      content: '';
      position: absolute;
      inset: -3px;
      border-radius: 50%;
      border: 1.5px solid var(--accent-red);
      opacity: 0.4;
      animation: pulse-ring 2s ease-out infinite;
    }
  }

  &.online {
    border-color: var(--accent-green-dim);
    color: var(--accent-green);
    background: var(--accent-green-dim);

    .status-dot {
      background: var(--accent-green);

      &::after {
        border-color: var(--accent-green);
      }
    }
  }
}

@keyframes pulse-ring {
  0% {
    transform: scale(1);
    opacity: 0.4;
  }
  100% {
    transform: scale(1.6);
    opacity: 0;
  }
}

/* Main Content */
.main-content {
  flex: 1;
  padding: 24px 28px;
  max-width: 1600px;
}

.error-alert {
  margin-bottom: 20px;
  border-radius: var(--radius-md);
}
</style>
