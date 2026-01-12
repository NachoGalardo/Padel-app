/**
 * Database types for Supabase
 * 
 * En producción, generar con:
 * npx supabase gen types typescript --project-id <project-id> > src/types/database.ts
 */

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          plan: 'free' | 'starter' | 'pro' | 'enterprise';
          plan_valid_until: string | null;
          status: 'active' | 'suspended' | 'cancelled';
          settings: Record<string, unknown>;
          logo_url: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          address: string | null;
          timezone: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['tenants']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['tenants']['Insert']>;
      };
      profiles: {
        Row: {
          id: string;
          phone: string | null;
          email: string | null;
          name: string;
          avatar_url: string | null;
          gender: 'male' | 'female' | 'mixed' | null;
          birth_date: string | null;
          auth_provider: string;
          auth_provider_id: string | null;
          last_login_at: string | null;
          is_complete: boolean;
          completion_missing: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
      };
      tenant_users: {
        Row: {
          id: string;
          tenant_id: string;
          profile_id: string;
          role: 'owner' | 'admin' | 'player';
          status: 'active' | 'invited' | 'suspended';
          display_name: string | null;
          level: string | null;
          invited_by: string | null;
          joined_at: string;
          suspended_at: string | null;
          suspension_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['tenant_users']['Row'], 'id' | 'created_at' | 'updated_at' | 'joined_at'>;
        Update: Partial<Database['public']['Tables']['tenant_users']['Insert']>;
      };
      tournaments: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          description: string | null;
          gender: 'male' | 'female' | 'mixed';
          level_min: string | null;
          level_max: string | null;
          format: 'single_elimination' | 'double_elimination' | 'round_robin' | 'groups_then_knockout';
          status: 'draft' | 'registration_open' | 'registration_closed' | 'in_progress' | 'finished' | 'cancelled';
          registration_opens_at: string | null;
          registration_closes_at: string | null;
          start_date: string;
          end_date: string | null;
          max_teams: number;
          min_teams: number;
          entry_fee_cents: number;
          currency: string;
          sets_to_win: number;
          games_per_set: number;
          tiebreak_at: number;
          golden_point: boolean;
          settings: Record<string, unknown>;
          created_by: string;
          created_at: string;
          updated_at: string;
          cancelled_at: string | null;
          cancellation_reason: string | null;
        };
        Insert: Omit<Database['public']['Tables']['tournaments']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['tournaments']['Insert']>;
      };
      matches: {
        Row: {
          id: string;
          tenant_id: string;
          tournament_id: string;
          round_number: number;
          round_name: string | null;
          match_number: number;
          bracket_position: string | null;
          team1_id: string | null;
          team2_id: string | null;
          team1_entry_id: string | null;
          team2_entry_id: string | null;
          court_name: string | null;
          scheduled_at: string | null;
          estimated_duration_minutes: number;
          status: 'scheduled' | 'called' | 'in_progress' | 'finished' | 'walkover' | 'cancelled' | 'postponed';
          started_at: string | null;
          finished_at: string | null;
          winner_id: string | null;
          loser_id: string | null;
          is_walkover: boolean;
          walkover_reason: string | null;
          next_match_id: string | null;
          loser_next_match_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['matches']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['matches']['Insert']>;
      };
      match_results: {
        Row: {
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
        };
        Insert: Omit<Database['public']['Tables']['match_results']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['match_results']['Insert']>;
      };
      teams: {
        Row: {
          id: string;
          tenant_id: string;
          name: string | null;
          gender: 'male' | 'female' | 'mixed';
          level: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['teams']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['teams']['Insert']>;
      };
      rankings: {
        Row: {
          id: string;
          tenant_id: string;
          tenant_user_id: string;
          gender: 'male' | 'female' | 'mixed';
          level: string | null;
          points: number;
          position: number | null;
          previous_position: number | null;
          matches_played: number;
          matches_won: number;
          tournaments_played: number;
          tournaments_won: number;
          best_result: string | null;
          current_streak: number;
          last_activity_at: string | null;
          calculated_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['rankings']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['rankings']['Insert']>;
      };
      incidents: {
        Row: {
          id: string;
          tenant_id: string;
          tournament_id: string | null;
          match_id: string | null;
          type: 'injury' | 'no_show' | 'dispute' | 'weather' | 'equipment' | 'misconduct' | 'other';
          severity: 'low' | 'medium' | 'high' | 'critical';
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
        };
        Insert: Omit<Database['public']['Tables']['incidents']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['incidents']['Insert']>;
      };
    };
    Functions: {
      set_session_context: {
        Args: {
          p_profile_id: string;
          p_tenant_id: string;
          p_client_ip?: string;
          p_user_agent?: string;
        };
        Returns: void;
      };
    };
  };
}

// Helper types
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type Insertable<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type Updatable<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];

