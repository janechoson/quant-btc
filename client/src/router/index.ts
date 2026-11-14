import { createRouter, createWebHistory } from 'vue-router';
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/terminal' },
    {
      path: '/terminal',
      name: 'terminal',
      component: () => import('../views/TradingTerminal.vue'),
    },
    {
      path: '/learning',
      name: 'learning',
      component: () => import('../views/ChartLearning.vue'),
    },
    {
      path: '/patterns',
      name: 'patterns',
      component: () => import('../views/PatternLibrary.vue'),
    },
    {
      path: '/prediction-history',
      name: 'history',
      component: () => import('../views/PredictionHistory.vue'),
    },
    {
      path: '/backtest',
      name: 'backtest',
      component: () => import('../views/Backtest.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/Settings.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/terminal' },
  ],
});
export default router;
