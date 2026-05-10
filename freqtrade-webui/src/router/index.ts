import { createRouter, createWebHistory } from 'vue-router'
import Layout from '@/layouts/MainLayout.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: Layout,
      redirect: '/backtest',
      children: [
        {
          path: 'backtest',
          name: 'Backtest',
          component: () => import('@/views/BacktestView.vue'),
          meta: { title: '回测结果', icon: 'TrendCharts' }
        },
        {
          path: 'scan',
          name: 'Scan',
          component: () => import('@/views/ScanView.vue'),
          meta: { title: '多品种扫描', icon: 'Search' }
        },
        {
          path: 'optimize',
          name: 'Optimize',
          component: () => import('@/views/OptimizeView.vue'),
          meta: { title: '参数优化', icon: 'SetUp' }
        },
      ]
    }
  ]
})

export default router
