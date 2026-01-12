import { useAuthStore } from '@/stores/authStore';
import { useTenantStore } from '@/stores/tenantStore';
import { useUIStore } from '@/stores/uiStore';
import { supabase } from '@/lib/supabase';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

export function Header() {
  const { user } = useAuthStore();
  const { currentTenant, availableTenants, switchTenant } = useTenantStore();
  const { toggleSidebar } = useUIStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <header className="h-16 border-b border-surface-800 bg-surface-900/50 backdrop-blur-sm sticky top-0 z-30">
      <div className="h-full px-4 lg:px-8 flex items-center justify-between">
        {/* Left side */}
        <div className="flex items-center gap-4">
          <button
            onClick={toggleSidebar}
            className="p-2 rounded-lg hover:bg-surface-800 lg:hidden"
          >
            <MenuIcon className="w-5 h-5 text-surface-400" />
          </button>

          {/* Tenant switcher */}
          {availableTenants.length > 1 && (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 transition-colors"
              >
                <span className="text-sm font-medium">{currentTenant?.name}</span>
                <ChevronDownIcon className="w-4 h-4 text-surface-400" />
              </button>

              {dropdownOpen && (
                <div className="absolute top-full left-0 mt-2 w-48 bg-surface-800 border border-surface-700 rounded-lg shadow-xl animate-fade-in">
                  {availableTenants.map((tenant) => (
                    <button
                      key={tenant.id}
                      onClick={() => {
                        switchTenant(tenant.id);
                        setDropdownOpen(false);
                      }}
                      className={cn(
                        'w-full px-4 py-2 text-left text-sm hover:bg-surface-700 first:rounded-t-lg last:rounded-b-lg',
                        tenant.id === currentTenant?.id && 'bg-primary-600/10 text-primary-400'
                      )}
                    >
                      {tenant.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-4">
          {/* User menu */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-3 p-1.5 rounded-lg hover:bg-surface-800 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center">
                <span className="text-sm font-medium text-white">
                  {user?.email?.[0]?.toUpperCase() ?? 'U'}
                </span>
              </div>
              <span className="hidden sm:block text-sm text-surface-300">
                {user?.email}
              </span>
            </button>

            {dropdownOpen && (
              <div className="absolute top-full right-0 mt-2 w-48 bg-surface-800 border border-surface-700 rounded-lg shadow-xl animate-fade-in">
                <div className="px-4 py-3 border-b border-surface-700">
                  <p className="text-sm font-medium text-surface-100">
                    {user?.user_metadata?.['name'] ?? 'Usuario'}
                  </p>
                  <p className="text-xs text-surface-400 truncate">
                    {user?.email}
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-surface-700 rounded-b-lg"
                >
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

