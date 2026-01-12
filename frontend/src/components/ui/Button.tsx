import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './LoadingStates';

// =============================================================================
// TYPES
// =============================================================================

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

// =============================================================================
// STYLES
// =============================================================================

const variantStyles: Record<ButtonVariant, string> = {
  primary: cn(
    'bg-gradient-to-r from-primary-600 to-primary-500',
    'hover:from-primary-500 hover:to-primary-400',
    'text-white shadow-lg shadow-primary-500/25',
    'border border-primary-400/20'
  ),
  secondary: cn(
    'bg-surface-800 hover:bg-surface-700',
    'text-surface-100',
    'border border-surface-700'
  ),
  ghost: cn(
    'bg-transparent hover:bg-surface-800',
    'text-surface-300 hover:text-surface-100'
  ),
  danger: cn(
    'bg-red-600 hover:bg-red-500',
    'text-white',
    'border border-red-500/20'
  ),
  outline: cn(
    'bg-transparent',
    'text-primary-400 hover:text-primary-300',
    'border border-primary-500/50 hover:border-primary-400',
    'hover:bg-primary-500/10'
  ),
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-2',
  lg: 'px-6 py-3 text-base gap-2.5',
};

// =============================================================================
// COMPONENT
// =============================================================================

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={cn(
          // Base
          'inline-flex items-center justify-center font-medium rounded-lg',
          'transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface-950 focus:ring-primary-500',
          // Variant & Size
          variantStyles[variant],
          sizeStyles[size],
          // States
          isDisabled && 'opacity-50 cursor-not-allowed',
          fullWidth && 'w-full',
          className
        )}
        {...props}
      >
        {isLoading ? (
          <>
            <Spinner size="sm" className="mr-2" />
            <span>Cargando...</span>
          </>
        ) : (
          <>
            {leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
            {children}
            {rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
          </>
        )}
      </button>
    );
  }
);
Button.displayName = 'Button';

// =============================================================================
// ICON BUTTON
// =============================================================================

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  'aria-label': string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      className,
      variant = 'ghost',
      size = 'md',
      isLoading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || isLoading;

    const iconSizeStyles: Record<ButtonSize, string> = {
      sm: 'w-8 h-8',
      md: 'w-10 h-10',
      lg: 'w-12 h-12',
    };

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={cn(
          'inline-flex items-center justify-center rounded-lg',
          'transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface-950 focus:ring-primary-500',
          variantStyles[variant],
          iconSizeStyles[size],
          isDisabled && 'opacity-50 cursor-not-allowed',
          className
        )}
        {...props}
      >
        {isLoading ? <Spinner size="sm" /> : children}
      </button>
    );
  }
);
IconButton.displayName = 'IconButton';

// =============================================================================
// LINK BUTTON (styled as button)
// =============================================================================

interface LinkButtonProps {
  variant?: 'primary' | 'secondary';
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
}

export function LinkButton({
  variant = 'primary',
  className,
  children,
  onClick,
}: LinkButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-sm font-medium transition-colors',
        variant === 'primary'
          ? 'text-primary-400 hover:text-primary-300'
          : 'text-surface-400 hover:text-surface-300',
        className
      )}
    >
      {children}
    </button>
  );
}

