import { config } from '../config'
import { createMockService } from './mockService'
import { createSupabaseService } from './supabaseService'

export const portalService = config.useMock ? createMockService() : createSupabaseService()
