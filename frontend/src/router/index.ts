import { createRouter, createWebHistory } from 'vue-router'
import { isInIframe } from '../utils/token'
import { usePermissions, type PermissionAction } from '../composables/usePermissions'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    title?: string
    requiresPermission?: PermissionAction
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
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
    {
      path: '/',
      component: () => import('../layout/AppLayout.vue'),
      children: [
        {
          path: '',
          name: 'Generator',
          component: () => import('../views/GeneratorView.vue'),
          meta: { title: 'AI 3D Generator', requiresPermission: 'generate-model' },
        },
        {
          path: 'history',
          name: 'History',
          component: () => import('../views/HistoryView.vue'),
          meta: { title: 'History', requiresPermission: 'view-usage' },
        },
        {
          path: 'admin',
          name: 'Admin',
          component: () => import('../views/AdminView.vue'),
          meta: { title: 'Admin', requiresPermission: 'admin-config' },
        },
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  if (!to.meta.public && !isInIframe()) {
    return '/not-in-iframe'
  }

  if (!to.meta.requiresPermission) {
    return true
  }

  const { fetchAllowedActions, can } = usePermissions()
  await fetchAllowedActions()
  if (!can(to.meta.requiresPermission)) {
    return '/no-permission'
  }
  return true
})

export default router
