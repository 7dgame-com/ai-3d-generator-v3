import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { isInIframe } from '../utils/token'
import { usePermissions } from '../composables/usePermissions'
import { notifyHostPluginUrlChanged } from '../utils/hostEvents'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    title?: string
    requiresQuotaAdmin?: boolean
  }
}

export const shouldRegisterDiagnostics = (isProduction: boolean) => !isProduction
const developmentRoutes: RouteRecordRaw[] = []
if (!import.meta.env.PROD) {
  developmentRoutes.push({
    path: '/api-diagnostics',
    name: 'ApiDiagnostics',
    component: () => import('../views/ApiDiagnosticsView.vue'),
    meta: { public: true, title: 'API Diagnostics' },
  })
}

export const appRoutes: RouteRecordRaw[] = [
    {
      path: '/not-in-iframe',
      name: 'NotInIframe',
      component: () => import('../views/NotInIframeView.vue'),
      meta: { public: true, title: 'Not In Iframe' },
    },
    {
      path: '/no-permission',
      name: 'NoPermission',
      component: () => import('../views/NoPermissionView.vue'),
      meta: { public: true, title: 'No Permission' },
    },
    ...developmentRoutes,
    {
      path: '/',
      component: () => import('../layout/AppLayout.vue'),
      children: [
        {
          path: '',
          name: 'Generator',
          component: () => import('../views/GeneratorView.vue'),
          meta: { title: 'AI 3D Generator' },
        },
        {
          path: 'history',
          name: 'History',
          component: () => import('../views/HistoryView.vue'),
          meta: { title: 'History' },
        },
        {
          path: 'admin',
          name: 'Admin',
          component: () => import('../views/AdminView.vue'),
          meta: { title: 'Admin', requiresQuotaAdmin: true },
        },
      ],
    },
  ]

const router = createRouter({
  history: createWebHistory(),
  routes: appRoutes,
})

router.beforeEach(async (to) => {
  if (!to.meta.public && !isInIframe()) {
    return '/not-in-iframe'
  }

  if (!to.meta.requiresQuotaAdmin) {
    return true
  }

  const { fetchAllowedActions, can } = usePermissions()
  await fetchAllowedActions()
  if (to.meta.requiresQuotaAdmin && !can('manage-quota')) {
    return '/no-permission'
  }
  return true
})

router.afterEach((to) => {
  notifyHostPluginUrlChanged(to.fullPath)
})

export default router
