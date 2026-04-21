import { createRouter, createWebHistory } from 'vue-router'
import { isInIframe } from '../utils/token'
import { useAuthSession } from '../composables/useAuthSession'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    title?: string
    requiresRoot?: boolean
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
          meta: { title: 'Admin', requiresRoot: true },
        },
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  if (!to.meta.public && !isInIframe()) {
    return '/not-in-iframe'
  }

  if (!to.meta.requiresRoot) {
    return true
  }

  const { fetchSession, isRootUser } = useAuthSession()
  await fetchSession()
  if (to.meta.requiresRoot && !isRootUser.value) {
    return '/no-permission'
  }
  return true
})

export default router
