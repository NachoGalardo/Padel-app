/**
 * =============================================================================
 * TIPOS COMPARTIDOS PARA EDGE FUNCTIONS
 * =============================================================================
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// =============================================================================
// CONTEXT
// =============================================================================

export interface AppContext {
  requestId: string;
  startTime: number;
  profileId: string;
  tenantId: string;
  tenantUserId: string;
  role: 'owner' | 'admin' | 'player';
  supabase: SupabaseClient;
  clientIp: string;
  userAgent: string;
}

// =============================================================================
// ENUMS (mirror de la DB)
// =============================================================================

export type MatchStatus = 
  | 'scheduled' 
  | 'called' 
  | 'in_progress' 
  | 'finished' 
  | 'walkover' 
  | 'cancelled' 
  | 'postponed';

export type IncidentType = 
  | 'injury' 
  | 'no_show' 
  | 'dispute' 
  | 'weather' 
  | 'equipment' 
  | 'misconduct' 
  | 'other';

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ResultStatus = 'pending' | 'confirmed' | 'disputed' | 'admin_override';

// =============================================================================
// DATABASE TYPES
// =============================================================================

export interface Match {
  id: string;
  tenant_id: string;
  tournament_id: string;
  round_number: number;
  round_name: string;
  match_number: number;
  bracket_position: string;
  team1_id: string | null;
  team2_id: string | null;
  team1_entry_id: string | null;
  team2_entry_id: string | null;
  court_name: string | null;
  scheduled_at: string | null;
  status: MatchStatus;
  started_at: string | null;
  finished_at: string | null;
  winner_id: string | null;
  loser_id: string | null;
  is_walkover: boolean;
  walkover_reason: string | null;
  next_match_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MatchResult {
  id: string;
  tenant_id: string;
  match_id: string;
  set_number: number;
  team1_games: number;
  team2_games: number;
  tiebreak_team1: number | null;
  tiebreak_team2: number | null;
  duration_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface Incident {
  id: string;
  tenant_id: string;
  tournament_id: string | null;
  match_id: string | null;
  type: IncidentType;
  severity: IncidentSeverity;
  title: string;
  description: string;
  affected_team_id: string | null;
  affected_player_id: string | null;
  reported_by: string;
  reported_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tournament {
  id: string;
  tenant_id: string;
  name: string;
  status: string;
  sets_to_win: number;
  games_per_set: number;
  settings: Record<string, unknown>;
}

// =============================================================================
// REQUEST/RESPONSE TYPES
// =============================================================================

export interface SetScore {
  set_number: number;
  team1_games: number;
  team2_games: number;
  tiebreak_team1?: number;
  tiebreak_team2?: number;
}

export interface ReportResultRequest {
  match_id: string;
  sets: SetScore[];
  winner_team_id: string;
  duration_minutes?: number;
  notes?: string;
}

export interface AcceptResultRequest {
  match_id: string;
  accept: boolean;
  dispute_reason?: string;
}

export interface ResolveIncidentRequest {
  incident_id: string;
  resolution_notes: string;
  action?: 'dismiss' | 'warn' | 'disqualify' | 'reschedule' | 'override_result';
  override_winner_id?: string;
}

// =============================================================================
// NOTIFICATION TYPES
// =============================================================================

export interface Notification {
  type: 'result_reported' | 'result_confirmed' | 'result_disputed' | 'incident_resolved';
  recipients: string[]; // tenant_user_ids
  title: string;
  body: string;
  data: Record<string, unknown>;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "No autorizado") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Permisos insuficientes") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string) {
    super("NOT_FOUND", `${entity} no encontrado`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}

