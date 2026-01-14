import { useState } from 'react';
import { useTenantStore } from '@/stores/tenantStore';
import { Button } from '@/components/ui/Button';
import { FormField, Input } from '@/components/ui/FormField';
import { useToast } from '@/stores/uiStore';
import { supabase } from '@/lib/supabase';

export default function SettingsPage() {
  const { currentTenant, currentMembership } = useTenantStore();
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const isAdmin = currentMembership?.role === 'owner' || currentMembership?.role === 'admin';

  if (!currentTenant) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // Placeholder for save logic
    // In a real app, we'd have a form state and update Supabase
    setTimeout(() => {
      setIsLoading(false);
      toast.success('Guardado', 'La configuración se ha actualizado correctamente.');
    }, 1000);
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-3xl font-display font-bold text-surface-100">
          Configuración
        </h1>
        <p className="text-surface-400 mt-1">
          Administra la configuración de {currentTenant.name}
        </p>
      </div>

      <div className="card space-y-6">
        <h2 className="text-xl font-semibold text-surface-100 border-b border-surface-800 pb-4">
          Información General
        </h2>

        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField label="Nombre del Club/Organización">
              <Input
                defaultValue={currentTenant.name}
                disabled={!isAdmin}
              />
            </FormField>
            <FormField label="Slug (URL)">
              <Input
                defaultValue={currentTenant.slug}
                disabled={true} // Slug usually shouldn't be changed easily
                className="bg-surface-900 text-surface-500"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField label="Plan Actual">
              <div className="input flex items-center justify-between bg-surface-800/50 border-surface-700">
                <span className="capitalize font-medium text-primary-400">{currentTenant.plan}</span>
                <button type="button" className="text-xs text-surface-400 hover:text-white underline">
                  Cambiar Plan
                </button>
              </div>
            </FormField>
            <FormField label="Estado">
              <div className="input flex items-center bg-surface-800/50 border-surface-700">
                <span className="w-2 h-2 rounded-full bg-green-500 mr-2"></span>
                <span className="capitalize text-surface-200">{currentTenant.status}</span>
              </div>
            </FormField>
          </div>

          {isAdmin && (
            <div className="flex justify-end pt-4">
              <Button type="submit" isLoading={isLoading}>
                Guardar Cambios
              </Button>
            </div>
          )}
        </form>
      </div>

      {/* Danger Zone */}
      {currentMembership?.role === 'owner' && (
        <div className="card border border-red-900/30 bg-red-900/5">
          <h2 className="text-xl font-semibold text-red-400 mb-4">Zona de Peligro</h2>
          <p className="text-surface-400 mb-6 text-sm">
            Estas acciones son destructivas y no se pueden deshacer.
          </p>
          <div className="flex items-center justify-between p-4 border border-red-900/20 rounded-lg bg-red-900/10">
            <div>
              <h3 className="font-medium text-red-200">Eliminar Organización</h3>
              <p className="text-xs text-red-300/70">Eliminar permanentemente este tenant y todos sus datos.</p>
            </div>
            <Button variant="secondary" className="border-red-900/50 text-red-400 hover:bg-red-900/20">
              Eliminar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
