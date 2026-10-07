import { reactive } from 'vue';

export const toasts = reactive([]);

let seed = 0;

export function showToast(message, type = 'error') {
  const id = ++seed;
  toasts.push({ id, message, type });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, 3200);
}
