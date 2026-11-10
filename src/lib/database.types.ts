/**
 * Types for the Supabase database, matching supabase/migrations.
 *
 * Written by hand in the shape `supabase gen types typescript` produces. Once someone has the
 * Supabase CLI linked to the project, regenerate with:
 *   npx supabase gen types typescript --project-id ypbvbyijrpiqwfymqnpb > src/lib/database.types.ts
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string;
          avatar_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      worlds: {
        Row: {
          id: string;
          name: string;
          ruleset_id: string;
          status: 'lobby' | 'active' | 'finished';
          invite_code: string;
          turn_time_limit_hours: number | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          ruleset_id?: string;
          status?: 'lobby' | 'active' | 'finished';
          invite_code?: string;
          turn_time_limit_hours?: number | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          turn_time_limit_hours?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'worlds_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      world_members: {
        Row: {
          world_id: string;
          user_id: string;
          role: 'host' | 'player';
          is_gm: boolean;
          joined_at: string;
        };
        Insert: {
          world_id: string;
          user_id: string;
          role?: 'host' | 'player';
          is_gm?: boolean;
          joined_at?: string;
        };
        Update: {
          role?: 'host' | 'player';
          is_gm?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'world_members_world_id_fkey';
            columns: ['world_id'];
            isOneToOne: false;
            referencedRelation: 'worlds';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'world_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      gods: {
        Row: {
          id: string;
          world_id: string;
          user_id: string;
          name: string;
          spheres: string[];
          personality: string;
          color: string;
          sigil: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          world_id: string;
          user_id?: string;
          name: string;
          spheres: string[];
          personality?: string;
          color: string;
          sigil: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          spheres?: string[];
          personality?: string;
          color?: string;
          sigil?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'gods_world_id_fkey';
            columns: ['world_id'];
            isOneToOne: false;
            referencedRelation: 'worlds';
            referencedColumns: ['id'];
          },
        ];
      };
      world_state: {
        Row: {
          world_id: string;
          age: number;
          round: number;
          year: number;
          turn_order: string[];
          active_position: number;
          turn_started_at: string | null;
          turn_deadline: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'world_state_world_id_fkey';
            columns: ['world_id'];
            isOneToOne: true;
            referencedRelation: 'worlds';
            referencedColumns: ['id'];
          },
        ];
      };
      god_power: {
        Row: { god_id: string; world_id: string; power: number; low_pool_bonus: number };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      world_events: {
        Row: {
          id: number;
          world_id: string;
          seq: number;
          age: number;
          round: number;
          god_id: string | null;
          type: string;
          payload: Json;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      world_map: {
        Row: {
          world_id: string;
          width: number;
          height: number;
          terrain: string[];
          climate: string[];
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      rulesets: {
        Row: { id: string; config: Json };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_world_member: { Args: { target_world: string }; Returns: boolean };
      is_world_host: { Args: { target_world: string }; Returns: boolean };
      shares_world_with: { Args: { other_user: string }; Returns: boolean };
      join_world: { Args: { code: string }; Returns: string };
      start_world: { Args: { target_world: string }; Returns: undefined };
      set_my_gm_role: { Args: { target_world: string; gm: boolean }; Returns: undefined };
      generate_invite_code: { Args: Record<PropertyKey, never>; Returns: string };
      end_turn: { Args: { target_world: string; pass?: boolean }; Returns: undefined };
      skip_timed_out_turn: { Args: { target_world: string }; Returns: undefined };
      set_initial_map: {
        Args: { target_world: string; map_width: number; map_height: number; terrain: string[] };
        Returns: undefined;
      };
      take_action: {
        Args: {
          target_world: string;
          power_id: string;
          hexes: Json;
          choice: string;
          description: string;
        };
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type World = Database['public']['Tables']['worlds']['Row'];
export type WorldMember = Database['public']['Tables']['world_members']['Row'];
export type God = Database['public']['Tables']['gods']['Row'];
export type WorldState = Database['public']['Tables']['world_state']['Row'];
export type WorldEventRow = Database['public']['Tables']['world_events']['Row'];
export type WorldMapRow = Database['public']['Tables']['world_map']['Row'];
