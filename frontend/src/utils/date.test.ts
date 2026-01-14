import { describe, it, expect } from 'vitest';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

describe('Date Utils', () => {
    it('should format date correctly in Spanish', () => {
        const date = new Date(2024, 0, 1); // Jan 1, 2024
        const formatted = format(date, 'dd MMMM yyyy', { locale: es });
        expect(formatted).toBe('01 enero 2024');
    });
});
