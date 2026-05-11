// Phase 1: проверка, что preload API доступен
document.addEventListener('DOMContentLoaded', () => {
  const status = document.getElementById('status');

  // @ts-ignore — window.electronAPI expose через contextBridge
  if (window.electronAPI) {
    status.textContent = 'Preload API connected';
    status.className = 'ready';
  } else {
    status.textContent = 'Preload API NOT available';
    status.className = '';
  }
});
