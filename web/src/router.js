import { createRouter, createWebHistory } from 'vue-router';
import { getToken } from './api.js';
import Login from './views/Login.vue';
import Home from './views/Home.vue';
import Workbench from './views/Workbench.vue';
import ProjectDetail from './views/ProjectDetail.vue';
import Studio from './views/Studio.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: Login },
    { path: '/', component: Home },
    { path: '/workbench', component: Workbench },
    { path: '/studio', component: Studio },
    { path: '/project/:id', component: ProjectDetail },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach((to) => {
  if (to.path !== '/login' && !getToken()) return '/login';
  if (to.path === '/login' && getToken()) return '/';
  return true;
});

export default router;
