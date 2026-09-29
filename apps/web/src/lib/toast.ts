/** Minimal toast messages: toast('Task created'); <Toaster /> shows them. */
export interface ToastItem {
  id: number;
  text: string;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
  for (const l of listeners) l(items);
}

export function toast(text: string, ms = 5000): void {
  const item = { id: nextId++, text };
  items = [...items, item];
  emit();
  setTimeout(() => dismissToast(item.id), ms);
}

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(fn: (items: ToastItem[]) => void): () => void {
  listeners.add(fn);
  fn(items);
  return () => listeners.delete(fn);
}
