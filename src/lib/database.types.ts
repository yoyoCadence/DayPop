export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      calendars: {
        Row: {
          color: string
          created_at: string
          id: string
          is_default: boolean
          is_visible: boolean
          name: string
          owner_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_default?: boolean
          is_visible?: boolean
          name: string
          owner_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_default?: boolean
          is_visible?: boolean
          name?: string
          owner_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      event_attachments: {
        Row: {
          created_at: string
          event_id: string
          file_name: string
          id: string
          mime_type: string
          object_path: string
          owner_id: string
          size_bytes: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          file_name: string
          id?: string
          mime_type: string
          object_path: string
          owner_id: string
          size_bytes: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          file_name?: string
          id?: string
          mime_type?: string
          object_path?: string
          owner_id?: string
          size_bytes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_attachments_event_owner_fk"
            columns: ["event_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      event_attendees: {
        Row: {
          created_at: string
          email: string | null
          event_id: string
          id: string
          name: string | null
          owner_id: string
          response_status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          event_id: string
          id?: string
          name?: string | null
          owner_id: string
          response_status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          event_id?: string
          id?: string
          name?: string | null
          owner_id?: string
          response_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_attendees_event_owner_fk"
            columns: ["event_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      event_exceptions: {
        Row: {
          created_at: string
          event_id: string
          id: string
          is_cancelled: boolean
          occurrence_date: string | null
          occurrence_starts_at: string | null
          owner_id: string
          replacement_event_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          is_cancelled?: boolean
          occurrence_date?: string | null
          occurrence_starts_at?: string | null
          owner_id: string
          replacement_event_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          is_cancelled?: boolean
          occurrence_date?: string | null
          occurrence_starts_at?: string | null
          owner_id?: string
          replacement_event_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_exceptions_event_owner_fk"
            columns: ["event_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "event_exceptions_replacement_owner_fk"
            columns: ["replacement_event_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      events: {
        Row: {
          calendar_id: string
          created_at: string
          end_date: string | null
          ends_at: string | null
          id: string
          is_all_day: boolean
          location: string | null
          notes: string | null
          owner_id: string
          recurrence_rule: string | null
          reminder_minutes: number[]
          sharing_scope: string
          start_date: string | null
          starts_at: string | null
          timezone: string | null
          title: string
          updated_at: string
        }
        Insert: {
          calendar_id: string
          created_at?: string
          end_date?: string | null
          ends_at?: string | null
          id?: string
          is_all_day?: boolean
          location?: string | null
          notes?: string | null
          owner_id: string
          recurrence_rule?: string | null
          reminder_minutes?: number[]
          sharing_scope?: string
          start_date?: string | null
          starts_at?: string | null
          timezone?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          calendar_id?: string
          created_at?: string
          end_date?: string | null
          ends_at?: string | null
          id?: string
          is_all_day?: boolean
          location?: string | null
          notes?: string | null
          owner_id?: string
          recurrence_rule?: string | null
          reminder_minutes?: number[]
          sharing_scope?: string
          start_date?: string | null
          starts_at?: string | null
          timezone?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_calendar_owner_fk"
            columns: ["calendar_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          display_name: string | null
          id: string
          legacy_import_fingerprint: string | null
          legacy_imported_at: string | null
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          legacy_import_fingerprint?: string | null
          legacy_imported_at?: string | null
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          legacy_import_fingerprint?: string | null
          legacy_imported_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      stickers: {
        Row: {
          asset_key: string | null
          calendar_id: string
          created_at: string
          glyph: string | null
          id: string
          owner_id: string
          sort_order: number
          sticker_date: string
          updated_at: string
        }
        Insert: {
          asset_key?: string | null
          calendar_id: string
          created_at?: string
          glyph?: string | null
          id?: string
          owner_id: string
          sort_order?: number
          sticker_date: string
          updated_at?: string
        }
        Update: {
          asset_key?: string | null
          calendar_id?: string
          created_at?: string
          glyph?: string | null
          id?: string
          owner_id?: string
          sort_order?: number
          sticker_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stickers_calendar_owner_fk"
            columns: ["calendar_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      todos: {
        Row: {
          calendar_id: string
          completed_at: string | null
          created_at: string
          due_date: string | null
          id: string
          owner_id: string
          parent_id: string | null
          priority: string
          sharing_scope: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          calendar_id: string
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          owner_id: string
          parent_id?: string | null
          priority?: string
          sharing_scope?: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          calendar_id?: string
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          owner_id?: string
          parent_id?: string | null
          priority?: string
          sharing_scope?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "todos_calendar_owner_fk"
            columns: ["calendar_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "todos_parent_owner_calendar_fk"
            columns: ["parent_id", "owner_id", "calendar_id"]
            isOneToOne: false
            referencedRelation: "todos"
            referencedColumns: ["id", "owner_id", "calendar_id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          created_at: string
          default_reminder_minutes: number[]
          fixed_six_week_grid: boolean
          pet_enabled: boolean
          pet_name: string
          theme: string
          theme_id: string
          timezone: string
          updated_at: string
          user_id: string
          week_starts_on: number
        }
        Insert: {
          created_at?: string
          default_reminder_minutes?: number[]
          fixed_six_week_grid?: boolean
          pet_enabled?: boolean
          pet_name?: string
          theme?: string
          theme_id?: string
          timezone?: string
          updated_at?: string
          user_id: string
          week_starts_on?: number
        }
        Update: {
          created_at?: string
          default_reminder_minutes?: number[]
          fixed_six_week_grid?: boolean
          pet_enabled?: boolean
          pet_name?: string
          theme?: string
          theme_id?: string
          timezone?: string
          updated_at?: string
          user_id?: string
          week_starts_on?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      import_legacy_daypop: {
        Args: { p_fingerprint: string; p_payload: Json }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
