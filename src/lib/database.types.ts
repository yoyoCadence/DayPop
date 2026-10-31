export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      attachment_cleanup_jobs: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          object_path: string
          owner_id: string
        }
        Insert: {
          bucket_id?: string
          created_at?: string
          id?: string
          object_path: string
          owner_id: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          object_path?: string
          owner_id?: string
        }
        Relationships: []
      }
      calendar_group_shares: {
        Row: {
          calendar_id: string
          created_at: string
          group_id: string
          owner_id: string
          permission: string
          updated_at: string
        }
        Insert: {
          calendar_id: string
          created_at?: string
          group_id: string
          owner_id: string
          permission: string
          updated_at?: string
        }
        Update: {
          calendar_id?: string
          created_at?: string
          group_id?: string
          owner_id?: string
          permission?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_group_shares_calendar_id_owner_id_fkey"
            columns: ["calendar_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "calendar_group_shares_group_id_owner_id_fkey"
            columns: ["group_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "family_memberships"
            referencedColumns: ["group_id", "user_id"]
          },
        ]
      }
      calendar_reminder_settings: {
        Row: {
          calendar_id: string
          created_at: string
          date_time: string
          include_todos: boolean
          minutes_before: number[]
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          calendar_id: string
          created_at?: string
          date_time?: string
          include_todos?: boolean
          minutes_before?: number[]
          timezone: string
          updated_at?: string
          user_id: string
        }
        Update: {
          calendar_id?: string
          created_at?: string
          date_time?: string
          include_todos?: boolean
          minutes_before?: number[]
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_reminder_settings_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id"]
          },
        ]
      }
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
          created_by: string | null
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
          created_by?: string | null
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
          created_by?: string | null
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
      family_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      family_invitations: {
        Row: {
          accepted_by: string | null
          consumed_at: string | null
          created_at: string
          email: string
          expires_at: string
          group_id: string
          id: string
          invited_by: string
          status: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_by?: string | null
          consumed_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          group_id: string
          id?: string
          invited_by: string
          status?: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_by?: string | null
          consumed_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          group_id?: string
          id?: string
          invited_by?: string
          status?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_invitations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "family_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      family_memberships: {
        Row: {
          created_at: string
          group_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "family_groups"
            referencedColumns: ["id"]
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
      reminder_push_devices: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          public_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          public_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          public_key?: string
          updated_at?: string
          user_id?: string
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
          created_by: string | null
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
          created_by?: string | null
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
          created_by?: string | null
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
      append_daypop_ics: { Args: { p_payload: Json }; Returns: undefined }
      calendar_sharing_manifest: { Args: never; Returns: Json }
      cancel_event_occurrence: {
        Args: {
          p_event_id: string
          p_exception_id: string
          p_occurrence_date: string
          p_occurrence_starts_at: string
        }
        Returns: Json
      }
      claim_reminder_delivery: {
        Args: {
          p_calendar_id: string
          p_device_id: string
          p_fire_at: string
          p_job_hash: string
          p_version: string
        }
        Returns: Json
      }
      delete_calendar_with_reassignment: {
        Args: { p_calendar_id: string }
        Returns: boolean
      }
      delete_event_attachment_with_cleanup: {
        Args: { p_attachment_id: string }
        Returns: boolean
      }
      delete_event_with_attachment_cleanup: {
        Args: { p_event_id: string }
        Returns: boolean
      }
      family_command: {
        Args: { p_action: string; p_payload: Json }
        Returns: Json
      }
      family_invitation_preview: { Args: { p_token: string }; Returns: Json }
      family_snapshot: { Args: never; Returns: Json }
      finalize_event_attachment_upload: {
        Args: {
          p_event_id: string
          p_file_name: string
          p_id: string
          p_mime_type: string
          p_object_path: string
          p_size_bytes: number
        }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "event_attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finish_reminder_delivery: {
        Args: {
          p_device_id: string
          p_job_hash: string
          p_lease_id: string
          p_result: string
        }
        Returns: undefined
      }
      import_legacy_daypop: {
        Args: { p_fingerprint: string; p_payload: Json }
        Returns: Json
      }
      register_reminder_device: {
        Args: {
          p_auth: string
          p_endpoint: string
          p_p256dh: string
          p_public_key: string
        }
        Returns: string
      }
      reminder_capabilities: { Args: never; Returns: Json }
      reminder_sender_configuration: { Args: never; Returns: Json }
      reminder_sender_context: {
        Args: { p_calendar_id: string; p_device_id: string }
        Returns: Json
      }
      reminder_sender_heartbeat: {
        Args: { p_error?: string; p_public_key: string }
        Returns: undefined
      }
      reminder_sender_page: { Args: { p_after?: string }; Returns: Json }
      replace_daypop_data: { Args: { p_payload: Json }; Returns: undefined }
      replace_event_occurrence: {
        Args: {
          p_event_id: string
          p_exception_id: string
          p_occurrence_date: string
          p_occurrence_starts_at: string
          p_replacement: Json
        }
        Returns: Json
      }
      set_calendar_group_share: {
        Args: {
          p_calendar_id: string
          p_expected_updated_at?: string
          p_permission: string
        }
        Returns: Json
      }
      set_calendar_reminder: {
        Args: {
          p_calendar_id: string
          p_date_time: string
          p_expected_updated_at?: string
          p_include_todos: boolean
          p_minutes_before: number[]
          p_timezone: string
        }
        Returns: Json
      }
      unregister_reminder_device: {
        Args: { p_device_id: string }
        Returns: undefined
      }
      write_shared_calendar_item: {
        Args: { p_action: string; p_payload: Json; p_versions?: Json }
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

