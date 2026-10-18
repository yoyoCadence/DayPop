import { createContext, useContext } from 'react';
import { getSupabaseClient } from '../lib/supabase';
import { SupabaseFamilyService, type FamilyService } from './familyService';

export type FamilyServiceFactory = (userId: string) => FamilyService;
/** Injection seam for tests; the production factory is lazy, so a guest or an
 * unconfirmed session cannot accidentally construct a network request. */
export const FamilyServiceContext = createContext<FamilyServiceFactory | null>(null);
const productionFactory: FamilyServiceFactory = userId => new SupabaseFamilyService(getSupabaseClient(), userId);
export function useFamilyServiceFactory() { return useContext(FamilyServiceContext) ?? productionFactory; }
