import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useTenantStore } from '@/stores/tenantStore';
import { Button } from '@/components/ui/Button';
import { FormField, Input, Select } from '@/components/ui/FormField';
import { useToast } from '@/stores/uiStore';

interface CreateMemberModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

const GENDER_OPTIONS = [
    { value: 'male', label: 'Masculino' },
    { value: 'female', label: 'Femenino' },
];

export function CreateMemberModal({ isOpen, onClose, onSuccess }: CreateMemberModalProps) {
    const { currentTenant } = useTenantStore();
    const toast = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        email: '', // Optional for ghost players
        gender: 'male',
        phone: '',
    });

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!formData.name) return;

        setIsSubmitting(true);
        try {
            // Use the RPC to create profile and membership in one go (bypassing RLS issues)
            const { error } = await (supabase as any).rpc('create_tenant_member_v2', {
                p_tenant_id: currentTenant?.id,
                p_name: formData.name,
                p_gender: formData.gender,
                p_email: formData.email || null,
                p_phone: formData.phone || null,
            });

            if (error) throw error;

            toast.success('Éxito', 'Jugador creado correctamente');
            onSuccess();
            onClose();
            setFormData({ name: '', email: '', gender: 'male', phone: '' });

        } catch (error: any) {
            console.error('Error creating member:', error);
            toast.error('Error', error.message || 'No se pudo crear el jugador');
        } finally {
            setIsSubmitting(false);
        }
    }

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-surface-900 border border-surface-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="p-6 border-b border-surface-800">
                    <h2 className="text-xl font-bold text-surface-100">Nuevo Jugador</h2>
                    <p className="text-sm text-surface-400 mt-1">
                        Crea un perfil para un jugador que no tiene cuenta.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <FormField label="Nombre Completo" required>
                        <Input
                            value={formData.name}
                            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="Ej: Juan Pérez"
                        />
                    </FormField>

                    <FormField label="Género" required>
                        <Select
                            value={formData.gender}
                            onChange={(e) => setFormData(prev => ({ ...prev, gender: e.target.value }))}
                            options={GENDER_OPTIONS}
                        />
                    </FormField>

                    <div className="grid grid-cols-2 gap-4">
                        <FormField label="Email (Opcional)">
                            <Input
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                                placeholder="juan@ejemplo.com"
                            />
                        </FormField>

                        <FormField label="Teléfono (Opcional)">
                            <Input
                                type="tel"
                                value={formData.phone}
                                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                                placeholder="11..."
                            />
                        </FormField>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <Button variant="secondary" type="button" onClick={onClose}>
                            Cancelar
                        </Button>
                        <Button type="submit" isLoading={isSubmitting}>
                            Crear Jugador
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
