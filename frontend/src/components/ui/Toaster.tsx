import { useUIStore, type Toast } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

export function Toaster() {
  const { toasts, removeToast } = useUIStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onClose: () => void;
}

function ToastItem({ toast, onClose }: ToastItemProps) {
  const iconMap = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  };

  const colorMap = {
    success: 'border-green-500 bg-green-500/10',
    error: 'border-red-500 bg-red-500/10',
    warning: 'border-yellow-500 bg-yellow-500/10',
    info: 'border-blue-500 bg-blue-500/10',
  };

  const iconColorMap = {
    success: 'text-green-400',
    error: 'text-red-400',
    warning: 'text-yellow-400',
    info: 'text-blue-400',
  };

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-4 rounded-lg border shadow-lg animate-slide-up',
        'bg-surface-900',
        colorMap[toast.type]
      )}
    >
      <span className={cn('text-lg', iconColorMap[toast.type])}>
        {iconMap[toast.type]}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-surface-100">{toast.title}</p>
        {toast.message && (
          <p className="text-sm text-surface-400 mt-0.5">{toast.message}</p>
        )}
      </div>
      <button
        onClick={onClose}
        className="text-surface-500 hover:text-surface-300 transition-colors"
      >
        ✕
      </button>
    </div>
  );
}

