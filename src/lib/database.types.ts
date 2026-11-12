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
          /** Hours a turn can wait before its player is reminded (0 = never). */
          reminder_hours: number;
          objection_hours: number;
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
          reminder_hours?: number;
          objection_hours?: number;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          turn_time_limit_hours?: number | null;
          reminder_hours?: number;
          objection_hours?: number;
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
      world_notification_settings: {
        Row: { world_id: string; user_id: string; muted: boolean };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      world_nudges: {
        Row: {
          id: number;
          world_id: string;
          from_user: string;
          to_god: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      action_comments: {
        Row: {
          id: string;
          world_id: string;
          event_seq: number;
          parent_id: string | null;
          user_id: string;
          body: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      action_reactions: {
        Row: {
          world_id: string;
          event_seq: number;
          user_id: string;
          emoji: string;
          created_at: string;
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
      add_comment: {
        Args: { target_world: string; action_seq: number; body: string; reply_to?: string | null };
        Returns: string;
      };
      delete_comment: { Args: { comment: string }; Returns: undefined };
      toggle_reaction: {
        Args: { target_world: string; action_seq: number; emoji: string };
        Returns: boolean;
      };
      mark_world_read: { Args: { target_world: string }; Returns: undefined };
      register_push_token: { Args: { token: string; platform: string }; Returns: undefined };
      unregister_push_token: { Args: { token: string }; Returns: undefined };
      set_world_muted: { Args: { target_world: string; muted: boolean }; Returns: undefined };
      nudge: { Args: { target_world: string }; Returns: string };
      unread_counts: {
        Args: Record<PropertyKey, never>;
        Returns: { world_id: string; unread: number }[];
      };
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
      create_race: {
        Args: {
          target_world: string;
          race_name: string;
          race_description: string;
          race_appearance: string;
          race_alignment: number;
          hex_x: number;
          hex_y: number;
        };
        Returns: string;
      };
      create_order: {
        Args: {
          target_world: string;
          race: string;
          order_name: string;
          order_type: string;
          purpose: string;
        };
        Returns: string;
      };
      command_order: {
        Args: { target_world: string; target_order: string; directive: string };
        Returns: undefined;
      };
      create_avatar: {
        Args: {
          target_world: string;
          avatar_name: string;
          avatar_type: string;
          description: string;
          race: string | null;
          hex_x: number;
          hex_y: number;
        };
        Returns: string;
      };
      command_avatar: {
        Args: { target_world: string; avatar: string; intent: string; args: Json };
        Returns: string | null;
      };
      propose_next_age: { Args: { target_world: string }; Returns: string };
      object_to_action: {
        Args: { target_world: string; action_seq: number; reason: string };
        Returns: string;
      };
      vote: { Args: { target_world: string; proposal: string; choice: string }; Returns: string };
      close_proposal: { Args: { target_world: string; proposal: string }; Returns: string };
      command_city: {
        Args: { target_world: string; city: string; action: string; args: Json };
        Returns: string;
      };
      march_army: {
        Args: {
          target_world: string;
          army: string;
          hex_x: number;
          hex_y: number;
          description: string;
        };
        Returns: undefined;
      };
      attack: {
        Args: {
          target_world: string;
          army: string;
          target_kind: string;
          target: string;
          attacker_modifiers: Json;
          defender_modifiers: Json;
          utterly_destroy: boolean;
          description: string;
        };
        Returns: string;
      };
      resurrect_avatar: {
        Args: { target_world: string; avatar: string; description: string };
        Returns: undefined;
      };
      create_subrace: {
        Args: {
          target_world: string;
          parent_race: string;
          race_name: string;
          race_description: string;
          race_appearance: string;
          race_alignment: number;
          hex_x: number;
          hex_y: number;
        };
        Returns: string;
      };
      advance: {
        Args: { target_world: string; target: string; field: string; description: string };
        Returns: string;
      };
      change_alignment: {
        Args: {
          target_world: string;
          target_kind: string;
          target: string | null;
          hex_x: number | null;
          hex_y: number | null;
          direction: number;
          description: string;
        };
        Returns: number;
      };
      found_city: {
        Args: {
          target_world: string;
          race: string;
          city_name: string;
          hex_x: number;
          hex_y: number;
          description: string;
        };
        Returns: string;
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
export type CommentRow = Database['public']['Tables']['action_comments']['Row'];
export type ReactionRow = Database['public']['Tables']['action_reactions']['Row'];
