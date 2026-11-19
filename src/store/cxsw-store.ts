/**
 * CXSW / Companion Store Adapter
 * Connects DevTools Zustand layer to CXSW Local Companion Bridge.
 */
import { useCompanionStore } from './companion-store';

export const useCXSWStore = useCompanionStore;
export { useCompanionStore };
export default useCXSWStore;
