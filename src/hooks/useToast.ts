'use client';

import { useToastContext } from '@/components/ui/toast';

/**
 * Hook that provides a `toast` object with typed notification methods.
 *
 * Usage:
 * ```tsx
 * const toast = useToast();
 * toast.success('Operación exitosa');
 * toast.error('Error al procesar');
 * toast.warning('Precaución requerida');
 * toast.info('Datos actualizados');
 * ```
 *
 * Each method accepts an optional second argument for duration (ms, default 4000).
 */
export function useToast() {
  return useToastContext();
}

export default useToast;
