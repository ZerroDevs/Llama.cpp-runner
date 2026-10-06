/**
 * Llama Server Control - Toast Notification System
 */

export function showToast(title, message = '', type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-item pointer-events-auto flex items-start gap-3 p-3.5 rounded-2xl border shadow-xl backdrop-blur-md transition-all duration-200 bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-primary)]';

  let iconName = 'info';
  let iconColor = 'text-cyan-400';
  if (type === 'success') {
    iconName = 'check-circle-2';
    iconColor = 'text-emerald-400';
  } else if (type === 'error') {
    iconName = 'alert-circle';
    iconColor = 'text-rose-400';
  } else if (type === 'warning') {
    iconName = 'alert-triangle';
    iconColor = 'text-amber-400';
  }

  toast.innerHTML = `
    <i data-lucide="${iconName}" class="w-4 h-4 ${iconColor} mt-0.5 shrink-0"></i>
    <div class="flex-1 min-w-0">
      <div class="text-xs font-semibold text-[var(--text-primary)] leading-tight">${title}</div>
      ${message ? `<div class="text-[11px] text-[var(--text-secondary)] mt-0.5 leading-snug break-words">${message}</div>` : ''}
    </div>
    <button class="toast-close text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5">
      <i data-lucide="x" class="w-3.5 h-3.5"></i>
    </button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
  container.appendChild(toast);

  if (window.lucide) {
    window.lucide.createIcons({ root: toast });
  }

  if (duration > 0) {
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, duration);
  }
}
