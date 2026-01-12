import { cn } from '@/lib/utils';

// =============================================================================
// SPINNER
// =============================================================================

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-8 h-8 border-3',
    lg: 'w-12 h-12 border-4',
  };

  return (
    <div
      className={cn(
        'rounded-full border-primary-600 border-t-transparent animate-spin',
        sizeClasses[size],
        className
      )}
      role="status"
      aria-label="Cargando"
    />
  );
}

// =============================================================================
// SKELETON
// =============================================================================

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  className,
  variant = 'text',
  width,
  height,
}: SkeletonProps) {
  const variantClasses = {
    text: 'h-4 rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-lg',
  };

  return (
    <div
      className={cn(
        'skeleton animate-pulse bg-surface-800',
        variantClasses[variant],
        className
      )}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    />
  );
}

// =============================================================================
// LOADING OVERLAY
// =============================================================================

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
  blur?: boolean;
}

export function LoadingOverlay({
  visible,
  message = 'Cargando...',
  blur = true,
}: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center',
        'bg-surface-950/80',
        blur && 'backdrop-blur-sm'
      )}
    >
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" />
        <p className="text-surface-300 text-sm">{message}</p>
      </div>
    </div>
  );
}

// =============================================================================
// PAGE LOADER
// =============================================================================

export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" />
        <p className="text-surface-400 text-sm">Cargando...</p>
      </div>
    </div>
  );
}

// =============================================================================
// BUTTON LOADER
// =============================================================================

interface ButtonLoaderProps {
  loading: boolean;
  children: React.ReactNode;
}

export function ButtonLoader({ loading, children }: ButtonLoaderProps) {
  if (loading) {
    return (
      <span className="flex items-center gap-2">
        <Spinner size="sm" className="border-current border-t-transparent" />
        <span>Cargando...</span>
      </span>
    );
  }
  return <>{children}</>;
}

// =============================================================================
// SKELETON PRESETS
// =============================================================================

export function CardSkeleton() {
  return (
    <div className="card space-y-4">
      <Skeleton variant="text" className="w-1/3 h-6" />
      <Skeleton variant="text" className="w-full" />
      <Skeleton variant="text" className="w-2/3" />
      <div className="flex gap-2 pt-2">
        <Skeleton variant="rectangular" className="w-20 h-8" />
        <Skeleton variant="rectangular" className="w-20 h-8" />
      </div>
    </div>
  );
}

export function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <tr className="border-b border-surface-800">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton variant="text" className="w-full" />
        </td>
      ))}
    </tr>
  );
}

export function ListItemSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4 border-b border-surface-800">
      <Skeleton variant="circular" width={40} height={40} />
      <div className="flex-1 space-y-2">
        <Skeleton variant="text" className="w-1/3" />
        <Skeleton variant="text" className="w-1/2 h-3" />
      </div>
      <Skeleton variant="rectangular" className="w-16 h-6" />
    </div>
  );
}

// =============================================================================
// PROGRESS BAR
// =============================================================================

interface ProgressBarProps {
  progress: number; // 0-100
  showLabel?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function ProgressBar({
  progress,
  showLabel = false,
  size = 'md',
  className,
}: ProgressBarProps) {
  const clampedProgress = Math.min(100, Math.max(0, progress));
  const heightClass = size === 'sm' ? 'h-1' : 'h-2';

  return (
    <div className={className}>
      <div className={cn('w-full bg-surface-800 rounded-full overflow-hidden', heightClass)}>
        <div
          className={cn('bg-primary-500 rounded-full transition-all duration-300', heightClass)}
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
      {showLabel && (
        <p className="text-xs text-surface-400 mt-1 text-right">{Math.round(clampedProgress)}%</p>
      )}
    </div>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {icon && <div className="text-surface-600 mb-4">{icon}</div>}
      <h3 className="text-lg font-medium text-surface-200">{title}</h3>
      {description && <p className="text-surface-400 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

