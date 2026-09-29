/**
 * "Are you sure you want to leave?" for pages with unsaved work (the router in use has no
 * navigation blocker). A page sets a message while it has unsaved work; in-app links call
 * confirmLeave(), and closing or reloading the tab gets the browser's own prompt.
 */
let message: string | null = null;

function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
}

export function setLeaveGuard(next: string | null): void {
  if (next && !message) window.addEventListener('beforeunload', onBeforeUnload);
  if (!next && message) window.removeEventListener('beforeunload', onBeforeUnload);
  message = next;
}

/** True if navigation may go ahead (no guard, or the user confirmed). */
export function confirmLeave(): boolean {
  if (!message) return true;
  const ok = window.confirm(message);
  if (ok) setLeaveGuard(null);
  return ok;
}
