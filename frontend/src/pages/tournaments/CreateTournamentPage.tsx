import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useTenantStore } from '@/stores/tenantStore';
import { useToast } from '@/stores/uiStore';
import { validate, tournamentSchema, type TournamentInput } from '@/lib/validations';
import { Button } from '@/components/ui/Button';
import { FormField, Input, Select } from '@/components/ui/FormField';

const TOURNAMENT_FORMATS = [
    { value: 'single_elimination', label: 'Eliminación Directa' },
    { value: 'round_robin', label: 'Todos contra Todos (Grupos)' },
];

const GENDER_OPTIONS = [
    { value: 'male', label: 'Masculino' },
    { value: 'female', label: 'Femenino' },
    { value: 'mixed', label: 'Mixto' },
];

export default function CreateTournamentPage() {
    const navigate = useNavigate();
    const { currentTenant, currentMembership } = useTenantStore();
    const toast = useToast();

    const [isLoading, setIsLoading] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Form state
    const [formData, setFormData] = useState<Partial<TournamentInput>>({
        name: '',
        start_date: '',
        end_date: '',
        gender: 'male',
        format: 'single_elimination',
        max_teams: 16,
        entry_fee_cents: 0,
        currency: 'ARS',
    });

    const handleChange = (field: keyof TournamentInput, value: any) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        // Clear error for this field
        if (errors[field]) {
            setErrors((prev) => {
                const newErrors = { ...prev };
                delete newErrors[field];
                return newErrors;
            });
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrors({});
        setIsLoading(true);

        try {
            // 1. Validate
            const validation = validate(tournamentSchema, formData);
            if (!validation.success) {
                setErrors(validation.errors ?? {});
                setIsLoading(false);
                return;
            }

            const data = validation.data!;

            // 2. Create in Supabase
            // Cast to any to avoid "never" type error until types are generated
            const { data: tournament, error } = await (supabase
                .from('tournaments') as any)
                .insert({
                    tenant_id: currentTenant?.id,
                    created_by: currentMembership?.tenantUserId,
                    name: data.name,
                    start_date: data.start_date,
                    end_date: data.end_date || null,
                    gender: data.gender,
                    format: data.format,
                    max_teams: data.max_teams,
                    entry_fee_cents: data.entry_fee_cents,
                    currency: data.currency,
                    status: 'draft',
                    settings: {},
                })
                .select()
                .single();

            if (error) throw error;

            toast.success('Torneo creado', 'El torneo se ha creado correctamente en borrador.');
            navigate(`/tournaments/${tournament.id}`);

        } catch (error: any) {
            console.error('Error creating tournament:', error);
            toast.error('Error', error.message || 'No se pudo crear el torneo');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
                <button
                    onClick={() => navigate('/tournaments')}
                    className="text-surface-400 hover:text-white transition-colors"
                >
                    ← Volver
                </button>
                <h1 className="text-2xl font-bold text-surface-100">Nuevo Torneo</h1>
            </div>

            <div className="card">
                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Basic Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2">
                            <FormField label="Nombre del Torneo" error={errors.name} required>
                                <Input
                                    value={formData.name}
                                    onChange={(e) => handleChange('name', e.target.value)}
                                    placeholder="Ej: Torneo de Verano 2024"
                                />
                            </FormField>
                        </div>

                        <FormField label="Fecha de Inicio" error={errors.start_date} required>
                            <Input
                                type="date"
                                value={formData.start_date}
                                onChange={(e) => handleChange('start_date', e.target.value)}
                            />
                        </FormField>

                        <FormField label="Fecha de Fin (Opcional)" error={errors.end_date}>
                            <Input
                                type="date"
                                value={formData.end_date}
                                onChange={(e) => handleChange('end_date', e.target.value)}
                                min={formData.start_date}
                            />
                        </FormField>

                        <FormField label="Género" error={errors.gender} required>
                            <Select
                                value={formData.gender}
                                onChange={(e) => handleChange('gender', e.target.value)}
                                options={GENDER_OPTIONS}
                            />
                        </FormField>

                        <FormField label="Formato" error={errors.format} required>
                            <Select
                                value={formData.format}
                                onChange={(e) => handleChange('format', e.target.value)}
                                options={TOURNAMENT_FORMATS}
                            />
                        </FormField>
                    </div>

                    <div className="border-t border-surface-800 my-6 pt-6">
                        <h3 className="text-lg font-medium text-surface-200 mb-4">Configuración</h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <FormField label="Cantidad Máxima de Equipos" error={errors.max_teams} required>
                                <Input
                                    type="number"
                                    value={formData.max_teams || ''}
                                    onChange={(e) => handleChange('max_teams', e.target.value === '' ? 0 : parseInt(e.target.value))}
                                    min={4}
                                    max={256}
                                />
                            </FormField>

                            <FormField label="Precio de Inscripción" error={errors.entry_fee_cents} required>
                                <div className="relative">
                                    <span className="absolute left-3 top-2.5 text-surface-400">$</span>
                                    <Input
                                        type="number"
                                        className="pl-8"
                                        value={formData.entry_fee_cents || ''}
                                        onChange={(e) => handleChange('entry_fee_cents', e.target.value === '' ? 0 : parseInt(e.target.value))}
                                        min={0}
                                    />
                                </div>
                            </FormField>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => navigate('/tournaments')}
                            disabled={isLoading}
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="submit"
                            isLoading={isLoading}
                        >
                            Crear Torneo
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
