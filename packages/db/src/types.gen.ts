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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      action_log: {
        Row: {
          action_kind: string
          automation_id: string
          brand_id: string
          created_at: string
          detail: Json | null
          id: string
          lead_id: string | null
          status: string
          trigger_type: string
          workflow_run_id: string | null
        }
        Insert: {
          action_kind: string
          automation_id: string
          brand_id: string
          created_at?: string
          detail?: Json | null
          id?: string
          lead_id?: string | null
          status: string
          trigger_type: string
          workflow_run_id?: string | null
        }
        Update: {
          action_kind?: string
          automation_id?: string
          brand_id?: string
          created_at?: string
          detail?: Json | null
          id?: string
          lead_id?: string | null
          status?: string
          trigger_type?: string
          workflow_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_log_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_log_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_log_workflow_run_id_fkey"
            columns: ["workflow_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          brand_id: string
          calendar_id: string | null
          campaign_id: string | null
          created_at: string
          ends_at: string | null
          ext_etag: string | null
          ext_event_id: string | null
          ext_status: string
          id: string
          lead_id: string | null
          location: string | null
          member_id: string | null
          notes: string | null
          starts_at: string
          status: string
          title: string
        }
        Insert: {
          brand_id: string
          calendar_id?: string | null
          campaign_id?: string | null
          created_at?: string
          ends_at?: string | null
          ext_etag?: string | null
          ext_event_id?: string | null
          ext_status?: string
          id?: string
          lead_id?: string | null
          location?: string | null
          member_id?: string | null
          notes?: string | null
          starts_at: string
          status?: string
          title: string
        }
        Update: {
          brand_id?: string
          calendar_id?: string | null
          campaign_id?: string | null
          created_at?: string
          ends_at?: string | null
          ext_etag?: string | null
          ext_event_id?: string | null
          ext_status?: string
          id?: string
          lead_id?: string | null
          location?: string | null
          member_id?: string | null
          notes?: string | null
          starts_at?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          brand_id: string | null
          created_at: string
          diff: Json | null
          entity: string
          entity_id: string | null
          id: number
          ip: string | null
          member_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          brand_id?: string | null
          created_at?: string
          diff?: Json | null
          entity: string
          entity_id?: string | null
          id?: number
          ip?: string | null
          member_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          brand_id?: string | null
          created_at?: string
          diff?: Json | null
          entity?: string
          entity_id?: string | null
          id?: number
          ip?: string | null
          member_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          actions: Json
          brand_id: string
          created_at: string
          created_by: string | null
          description: string | null
          graph: Json | null
          id: string
          is_enabled: boolean
          is_system: boolean
          mode: string
          name: string
          sort_order: number
          trigger_config: Json
          trigger_type: string
          updated_at: string
          webhook_token: string | null
        }
        Insert: {
          actions?: Json
          brand_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          graph?: Json | null
          id?: string
          is_enabled?: boolean
          is_system?: boolean
          mode?: string
          name: string
          sort_order?: number
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
          webhook_token?: string | null
        }
        Update: {
          actions?: Json
          brand_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          graph?: Json | null
          id?: string
          is_enabled?: boolean
          is_system?: boolean
          mode?: string
          name?: string
          sort_order?: number
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
          webhook_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_members: {
        Row: {
          brand_id: string
          created_at: string
          is_active: boolean
          member_id: string
          role: Database["public"]["Enums"]["member_role"]
        }
        Insert: {
          brand_id: string
          created_at?: string
          is_active?: boolean
          member_id: string
          role?: Database["public"]["Enums"]["member_role"]
        }
        Update: {
          brand_id?: string
          created_at?: string
          is_active?: boolean
          member_id?: string
          role?: Database["public"]["Enums"]["member_role"]
        }
        Relationships: [
          {
            foreignKeyName: "brand_members_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          dba: string | null
          default_pool_id: string | null
          ein: string | null
          id: string
          max_dials_per_lead_per_day: number | null
          name: string
          slug: string
          timezone: string
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          dba?: string | null
          default_pool_id?: string | null
          ein?: string | null
          id: string
          max_dials_per_lead_per_day?: number | null
          name: string
          slug: string
          timezone?: string
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          dba?: string | null
          default_pool_id?: string | null
          ein?: string | null
          id?: string
          max_dials_per_lead_per_day?: number | null
          name?: string
          slug?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_default_pool_id_fkey"
            columns: ["default_pool_id"]
            isOneToOne: false
            referencedRelation: "phone_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_members: {
        Row: {
          calendar_id: string
          can_book: boolean
          created_at: string
          is_owner: boolean
          member_id: string
        }
        Insert: {
          calendar_id: string
          can_book?: boolean
          created_at?: string
          is_owner?: boolean
          member_id: string
        }
        Update: {
          calendar_id?: string
          can_book?: boolean
          created_at?: string
          is_owner?: boolean
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_members_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      calendars: {
        Row: {
          brand_id: string
          color: string | null
          created_at: string
          default_duration_min: number
          ext_calendar_id: string | null
          ext_last_sync_at: string | null
          ext_provider: string | null
          ext_sync_token: string | null
          id: string
          is_active: boolean
          name: string
          owner_account_id: string | null
          owner_member_id: string | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          color?: string | null
          created_at?: string
          default_duration_min?: number
          ext_calendar_id?: string | null
          ext_last_sync_at?: string | null
          ext_provider?: string | null
          ext_sync_token?: string | null
          id?: string
          is_active?: boolean
          name: string
          owner_account_id?: string | null
          owner_member_id?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          color?: string | null
          created_at?: string
          default_duration_min?: number
          ext_calendar_id?: string | null
          ext_last_sync_at?: string | null
          ext_provider?: string | null
          ext_sync_token?: string | null
          id?: string
          is_active?: boolean
          name?: string
          owner_account_id?: string | null
          owner_member_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendars_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendars_owner_account_id_fkey"
            columns: ["owner_account_id"]
            isOneToOne: false
            referencedRelation: "member_oauth_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendars_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          brand_id: string
          callback_at: string | null
          campaign_id: string | null
          created_at: string
          direction: Database["public"]["Enums"]["call_direction"]
          disposition: string | null
          duration_sec: number | null
          ended_at: string | null
          from_number: string
          handled_at: string | null
          handled_by: string | null
          hangup_cause: string | null
          id: string
          is_voicemail: boolean
          lead_id: string | null
          member_id: string | null
          needs_disposition: boolean
          note: string | null
          number_id: string | null
          recording_duration_sec: number | null
          recording_sid: string | null
          recording_url: string | null
          signalwire_call_id: string | null
          sip_response: number | null
          started_at: string
          stir_attestation: string | null
          to_number: string
          transcript: string | null
          transcript_status: string | null
        }
        Insert: {
          brand_id: string
          callback_at?: string | null
          campaign_id?: string | null
          created_at?: string
          direction: Database["public"]["Enums"]["call_direction"]
          disposition?: string | null
          duration_sec?: number | null
          ended_at?: string | null
          from_number: string
          handled_at?: string | null
          handled_by?: string | null
          hangup_cause?: string | null
          id?: string
          is_voicemail?: boolean
          lead_id?: string | null
          member_id?: string | null
          needs_disposition?: boolean
          note?: string | null
          number_id?: string | null
          recording_duration_sec?: number | null
          recording_sid?: string | null
          recording_url?: string | null
          signalwire_call_id?: string | null
          sip_response?: number | null
          started_at?: string
          stir_attestation?: string | null
          to_number: string
          transcript?: string | null
          transcript_status?: string | null
        }
        Update: {
          brand_id?: string
          callback_at?: string | null
          campaign_id?: string | null
          created_at?: string
          direction?: Database["public"]["Enums"]["call_direction"]
          disposition?: string | null
          duration_sec?: number | null
          ended_at?: string | null
          from_number?: string
          handled_at?: string | null
          handled_by?: string | null
          hangup_cause?: string | null
          id?: string
          is_voicemail?: boolean
          lead_id?: string | null
          member_id?: string | null
          needs_disposition?: boolean
          note?: string | null
          number_id?: string | null
          recording_duration_sec?: number | null
          recording_sid?: string | null
          recording_url?: string | null
          signalwire_call_id?: string | null
          sip_response?: number | null
          started_at?: string
          stir_attestation?: string | null
          to_number?: string
          transcript?: string | null
          transcript_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calls_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_number_id_fkey"
            columns: ["number_id"]
            isOneToOne: false
            referencedRelation: "numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_agents: {
        Row: {
          campaign_id: string
          member_id: string
        }
        Insert: {
          campaign_id: string
          member_id: string
        }
        Update: {
          campaign_id?: string
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_agents_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_agents_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_lists: {
        Row: {
          campaign_id: string
          list_id: string
        }
        Insert: {
          campaign_id: string
          list_id: string
        }
        Update: {
          campaign_id?: string
          list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_lists_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_lists_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          brand_id: string
          calendar_id: string | null
          created_at: string
          created_by: string | null
          default_owner_id: string | null
          description: string | null
          dial_window_end_min: number
          dial_window_start_min: number
          id: string
          name: string
          phone_pool_id: string | null
          recently_called_minutes: number
          script_id: string | null
          skip_weekends: boolean
          status: string
          tcpa_enabled: boolean
          updated_at: string
        }
        Insert: {
          brand_id: string
          calendar_id?: string | null
          created_at?: string
          created_by?: string | null
          default_owner_id?: string | null
          description?: string | null
          dial_window_end_min?: number
          dial_window_start_min?: number
          id?: string
          name: string
          phone_pool_id?: string | null
          recently_called_minutes?: number
          script_id?: string | null
          skip_weekends?: boolean
          status?: string
          tcpa_enabled?: boolean
          updated_at?: string
        }
        Update: {
          brand_id?: string
          calendar_id?: string | null
          created_at?: string
          created_by?: string | null
          default_owner_id?: string | null
          description?: string | null
          dial_window_end_min?: number
          dial_window_start_min?: number
          id?: string
          name?: string
          phone_pool_id?: string | null
          recently_called_minutes?: number
          script_id?: string | null
          skip_weekends?: boolean
          status?: string
          tcpa_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "calendars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_default_owner_id_fkey"
            columns: ["default_owner_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_phone_pool_id_fkey"
            columns: ["phone_pool_id"]
            isOneToOne: false
            referencedRelation: "phone_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      disposition_followups: {
        Row: {
          add_tag_ids: string[]
          brand_id: string
          campaign_id: string | null
          create_task: boolean
          created_at: string
          disposition_id: string
          email_body: string | null
          email_subject: string | null
          enabled: boolean
          id: string
          move_stage_id: string | null
          send_email: boolean
          send_sms: boolean
          sms_body: string | null
          task_due_minutes: number | null
          task_title: string | null
          updated_at: string
        }
        Insert: {
          add_tag_ids?: string[]
          brand_id: string
          campaign_id?: string | null
          create_task?: boolean
          created_at?: string
          disposition_id: string
          email_body?: string | null
          email_subject?: string | null
          enabled?: boolean
          id?: string
          move_stage_id?: string | null
          send_email?: boolean
          send_sms?: boolean
          sms_body?: string | null
          task_due_minutes?: number | null
          task_title?: string | null
          updated_at?: string
        }
        Update: {
          add_tag_ids?: string[]
          brand_id?: string
          campaign_id?: string | null
          create_task?: boolean
          created_at?: string
          disposition_id?: string
          email_body?: string | null
          email_subject?: string | null
          enabled?: boolean
          id?: string
          move_stage_id?: string | null
          send_email?: boolean
          send_sms?: boolean
          sms_body?: string | null
          task_due_minutes?: number | null
          task_title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "disposition_followups_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposition_followups_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposition_followups_disposition_id_fkey"
            columns: ["disposition_id"]
            isOneToOne: false
            referencedRelation: "dispositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposition_followups_move_stage_id_fkey"
            columns: ["move_stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      dispositions: {
        Row: {
          brand_id: string
          category: string
          code: string
          cooldown_minutes: number | null
          created_at: string
          escalation_enabled: boolean
          escalation_match_category: boolean
          escalation_stage_ids: string[]
          escalation_terminal_set_dnc: boolean
          escalation_terminal_stage_id: string | null
          escalation_terminal_tag_id: string | null
          id: string
          is_archived: boolean
          label: string
          sort_order: number
          tone: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          category?: string
          code: string
          cooldown_minutes?: number | null
          created_at?: string
          escalation_enabled?: boolean
          escalation_match_category?: boolean
          escalation_stage_ids?: string[]
          escalation_terminal_set_dnc?: boolean
          escalation_terminal_stage_id?: string | null
          escalation_terminal_tag_id?: string | null
          id?: string
          is_archived?: boolean
          label: string
          sort_order?: number
          tone?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          category?: string
          code?: string
          cooldown_minutes?: number | null
          created_at?: string
          escalation_enabled?: boolean
          escalation_match_category?: boolean
          escalation_stage_ids?: string[]
          escalation_terminal_set_dnc?: boolean
          escalation_terminal_stage_id?: string | null
          escalation_terminal_tag_id?: string | null
          id?: string
          is_archived?: boolean
          label?: string
          sort_order?: number
          tone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispositions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispositions_escalation_terminal_stage_id_fkey"
            columns: ["escalation_terminal_stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispositions_escalation_terminal_tag_id_fkey"
            columns: ["escalation_terminal_tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      email_messages: {
        Row: {
          body_html: string | null
          body_text: string | null
          cc_addrs: string[]
          created_at: string
          direction: string
          ext_history_id: string | null
          ext_message_id: string
          from_addr: string | null
          id: string
          member_id: string | null
          sent_at: string
          snippet: string | null
          subject: string | null
          thread_id: string
          to_addrs: string[]
        }
        Insert: {
          body_html?: string | null
          body_text?: string | null
          cc_addrs?: string[]
          created_at?: string
          direction: string
          ext_history_id?: string | null
          ext_message_id: string
          from_addr?: string | null
          id?: string
          member_id?: string | null
          sent_at: string
          snippet?: string | null
          subject?: string | null
          thread_id: string
          to_addrs?: string[]
        }
        Update: {
          body_html?: string | null
          body_text?: string | null
          cc_addrs?: string[]
          created_at?: string
          direction?: string
          ext_history_id?: string | null
          ext_message_id?: string
          from_addr?: string | null
          id?: string
          member_id?: string | null
          sent_at?: string
          snippet?: string | null
          subject?: string | null
          thread_id?: string
          to_addrs?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "email_messages_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "email_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sync_state: {
        Row: {
          last_error: string | null
          last_history_id: string | null
          last_synced_at: string | null
          member_id: string
          updated_at: string
        }
        Insert: {
          last_error?: string | null
          last_history_id?: string | null
          last_synced_at?: string | null
          member_id: string
          updated_at?: string
        }
        Update: {
          last_error?: string | null
          last_history_id?: string | null
          last_synced_at?: string | null
          member_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sync_state_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      email_threads: {
        Row: {
          brand_id: string
          created_at: string
          ext_provider: string
          ext_thread_id: string
          id: string
          last_message_at: string | null
          lead_id: string | null
          member_id: string
          snippet: string | null
          subject: string | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          ext_provider?: string
          ext_thread_id: string
          id?: string
          last_message_at?: string | null
          lead_id?: string | null
          member_id: string
          snippet?: string | null
          subject?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          ext_provider?: string
          ext_thread_id?: string
          id?: string
          last_message_at?: string | null
          lead_id?: string | null
          member_id?: string
          snippet?: string | null
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_threads_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      import_presets: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          default_country: string
          extra_tag_ids: string[]
          id: string
          mapping: Json
          name: string
          skip_dedup: boolean
          stage_id: string | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          default_country?: string
          extra_tag_ids?: string[]
          id?: string
          mapping?: Json
          name: string
          skip_dedup?: boolean
          stage_id?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          default_country?: string
          extra_tag_ids?: string[]
          id?: string
          mapping?: Json
          name?: string
          skip_dedup?: boolean
          stage_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_presets_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_presets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_presets_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_routes: {
        Row: {
          brand_id: string
          last_rung_member_id: string | null
          member_ids: string[]
          number_id: string
          ring_timeout_sec: number
          strategy: string
          updated_at: string
          voicemail_enabled: boolean
          voicemail_greeting: string | null
        }
        Insert: {
          brand_id: string
          last_rung_member_id?: string | null
          member_ids?: string[]
          number_id: string
          ring_timeout_sec?: number
          strategy?: string
          updated_at?: string
          voicemail_enabled?: boolean
          voicemail_greeting?: string | null
        }
        Update: {
          brand_id?: string
          last_rung_member_id?: string | null
          member_ids?: string[]
          number_id?: string
          ring_timeout_sec?: number
          strategy?: string
          updated_at?: string
          voicemail_enabled?: boolean
          voicemail_greeting?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_routes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_routes_number_id_fkey"
            columns: ["number_id"]
            isOneToOne: true
            referencedRelation: "numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_custom_fields: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          id: string
          key: string
          label: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          key: string
          label: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key?: string
          label?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_custom_fields_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_custom_fields_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_events: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          lead_id: string
          member_id: string | null
          payload: Json
          type: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          lead_id: string
          member_id?: string | null
          payload?: Json
          type: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          lead_id?: string
          member_id?: string | null
          payload?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_lists: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          criteria: Json | null
          id: string
          name: string
          source: Database["public"]["Enums"]["list_source"]
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          criteria?: Json | null
          id?: string
          name: string
          source?: Database["public"]["Enums"]["list_source"]
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          criteria?: Json | null
          id?: string
          name?: string
          source?: Database["public"]["Enums"]["list_source"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_lists_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_lists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_tags: {
        Row: {
          created_at: string
          created_by: string | null
          lead_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          lead_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          lead_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_tags_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          brand_id: string
          city: string | null
          created_at: string
          custom: Json
          do_not_call: boolean
          do_not_email: boolean
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          list_id: string | null
          notes: string | null
          owner_id: string | null
          phone: string | null
          source: Database["public"]["Enums"]["lead_source"]
          stage_id: string | null
          state: string | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          brand_id: string
          city?: string | null
          created_at?: string
          custom?: Json
          do_not_call?: boolean
          do_not_email?: boolean
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          list_id?: string | null
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          stage_id?: string | null
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          brand_id?: string
          city?: string | null
          created_at?: string
          custom?: Json
          do_not_call?: boolean
          do_not_email?: boolean
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          list_id?: string | null
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          stage_id?: string | null
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lead_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      member_oauth_accounts: {
        Row: {
          account_email: string
          created_at: string
          id: string
          member_id: string
          oauth: Json
          provider: string
          scopes: string[]
          updated_at: string
        }
        Insert: {
          account_email: string
          created_at?: string
          id?: string
          member_id: string
          oauth: Json
          provider: string
          scopes?: string[]
          updated_at?: string
        }
        Update: {
          account_email?: string
          created_at?: string
          id?: string
          member_id?: string
          oauth?: Json
          provider?: string
          scopes?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_oauth_accounts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_presence: {
        Row: {
          brand_id: string
          last_event_at: string
          last_session_started_at: string | null
          member_id: string
          seconds_today: number
          status: string
        }
        Insert: {
          brand_id: string
          last_event_at?: string
          last_session_started_at?: string | null
          member_id: string
          seconds_today?: number
          status: string
        }
        Update: {
          brand_id?: string
          last_event_at?: string
          last_session_started_at?: string | null
          member_id?: string
          seconds_today?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_presence_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_presence_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_screen_daily: {
        Row: {
          brand_id: string
          captured_at: string
          day_local: string
          member_id: string
          seconds_on_screen: number
        }
        Insert: {
          brand_id: string
          captured_at?: string
          day_local: string
          member_id: string
          seconds_on_screen?: number
        }
        Update: {
          brand_id?: string
          captured_at?: string
          day_local?: string
          member_id?: string
          seconds_on_screen?: number
        }
        Relationships: [
          {
            foreignKeyName: "member_screen_daily_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_screen_daily_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          email_oauth: Json | null
          email_provider: string | null
          email_signature: string | null
          full_name: string | null
          id: string
          mobile_phone: string | null
          oauth_scopes: string[]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          email_oauth?: Json | null
          email_provider?: string | null
          email_signature?: string | null
          full_name?: string | null
          id: string
          mobile_phone?: string | null
          oauth_scopes?: string[]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          email_oauth?: Json | null
          email_provider?: string | null
          email_signature?: string | null
          full_name?: string | null
          id?: string
          mobile_phone?: string | null
          oauth_scopes?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      message_outbox: {
        Row: {
          attempts: number
          automation_run_id: string | null
          body: string
          brand_id: string
          channel: string
          created_at: string
          error: string | null
          from_addr: string | null
          id: string
          lead_id: string | null
          provider_message_id: string | null
          sent_at: string | null
          status: string
          subject: string | null
          to_addr: string
        }
        Insert: {
          attempts?: number
          automation_run_id?: string | null
          body: string
          brand_id: string
          channel: string
          created_at?: string
          error?: string | null
          from_addr?: string | null
          id?: string
          lead_id?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          to_addr: string
        }
        Update: {
          attempts?: number
          automation_run_id?: string | null
          body?: string
          brand_id?: string
          channel?: string
          created_at?: string
          error?: string | null
          from_addr?: string | null
          id?: string
          lead_id?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          to_addr?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_outbox_automation_run_id_fkey"
            columns: ["automation_run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_outbox_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_outbox_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          brand_id: string
          created_at: string
          data: Json | null
          id: string
          kind: string
          link_url: string | null
          read_at: string | null
          recipient_member_id: string | null
          recipient_role: Database["public"]["Enums"]["member_role"] | null
          title: string
        }
        Insert: {
          body?: string | null
          brand_id: string
          created_at?: string
          data?: Json | null
          id?: string
          kind: string
          link_url?: string | null
          read_at?: string | null
          recipient_member_id?: string | null
          recipient_role?: Database["public"]["Enums"]["member_role"] | null
          title: string
        }
        Update: {
          body?: string | null
          brand_id?: string
          created_at?: string
          data?: Json | null
          id?: string
          kind?: string
          link_url?: string | null
          read_at?: string | null
          recipient_member_id?: string | null
          recipient_role?: Database["public"]["Enums"]["member_role"] | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_member_id_fkey"
            columns: ["recipient_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      numbers: {
        Row: {
          a2p_campaign_id: string | null
          active: boolean
          brand_id: string
          cnam: string | null
          cnam_checked_at: string | null
          created_at: string
          e164: string
          id: string
          inbound_connected_at: string | null
          label: string | null
          signalwire_id: string | null
        }
        Insert: {
          a2p_campaign_id?: string | null
          active?: boolean
          brand_id: string
          cnam?: string | null
          cnam_checked_at?: string | null
          created_at?: string
          e164: string
          id?: string
          inbound_connected_at?: string | null
          label?: string | null
          signalwire_id?: string | null
        }
        Update: {
          a2p_campaign_id?: string | null
          active?: boolean
          brand_id?: string
          cnam?: string | null
          cnam_checked_at?: string | null
          created_at?: string
          e164?: string
          id?: string
          inbound_connected_at?: string | null
          label?: string | null
          signalwire_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "numbers_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_pool_numbers: {
        Row: {
          last_used_at: string | null
          number_id: string
          pool_id: string
          weight: number
        }
        Insert: {
          last_used_at?: string | null
          number_id: string
          pool_id: string
          weight?: number
        }
        Update: {
          last_used_at?: string | null
          number_id?: string
          pool_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "phone_pool_numbers_number_id_fkey"
            columns: ["number_id"]
            isOneToOne: false
            referencedRelation: "numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_pool_numbers_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "phone_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_pools: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          name: string
          strategy: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          name: string
          strategy?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          name?: string
          strategy?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_pools_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      recordings: {
        Row: {
          brand_id: string
          call_id: string
          created_at: string
          duration_sec: number | null
          id: string
          storage_path: string
          transcript: string | null
        }
        Insert: {
          brand_id: string
          call_id: string
          created_at?: string
          duration_sec?: number | null
          id?: string
          storage_path: string
          transcript?: string | null
        }
        Update: {
          brand_id?: string
          call_id?: string
          created_at?: string
          duration_sec?: number | null
          id?: string
          storage_path?: string
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recordings_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordings_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      scripts: {
        Row: {
          body: string
          brand_id: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          kind: string
          name: string
          sections: Json | null
          subject: string | null
          updated_at: string
        }
        Insert: {
          body: string
          brand_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          kind?: string
          name: string
          sections?: Json | null
          subject?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          brand_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          kind?: string
          name?: string
          sections?: Json | null
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scripts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scripts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_violations: {
        Row: {
          brand_id: string
          detail: Json
          id: string
          kind: string
          last_seen_at: string
          member_id: string
          opened_at: string
        }
        Insert: {
          brand_id: string
          detail?: Json
          id?: string
          kind: string
          last_seen_at?: string
          member_id: string
          opened_at?: string
        }
        Update: {
          brand_id?: string
          detail?: Json
          id?: string
          kind?: string
          last_seen_at?: string
          member_id?: string
          opened_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sla_violations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_violations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      sms: {
        Row: {
          body: string
          brand_id: string
          created_at: string
          direction: Database["public"]["Enums"]["sms_direction"]
          from_number: string
          id: string
          lead_id: string | null
          member_id: string | null
          number_id: string | null
          signalwire_sms_id: string | null
          status: Database["public"]["Enums"]["sms_status"]
          to_number: string
        }
        Insert: {
          body: string
          brand_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["sms_direction"]
          from_number: string
          id?: string
          lead_id?: string | null
          member_id?: string | null
          number_id?: string | null
          signalwire_sms_id?: string | null
          status?: Database["public"]["Enums"]["sms_status"]
          to_number: string
        }
        Update: {
          body?: string
          brand_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["sms_direction"]
          from_number?: string
          id?: string
          lead_id?: string | null
          member_id?: string | null
          number_id?: string | null
          signalwire_sms_id?: string | null
          status?: Database["public"]["Enums"]["sms_status"]
          to_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_number_id_fkey"
            columns: ["number_id"]
            isOneToOne: false
            referencedRelation: "numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      stages: {
        Row: {
          brand_id: string
          color: string | null
          created_at: string
          id: string
          is_lost: boolean
          is_won: boolean
          name: string
          position: number
        }
        Insert: {
          brand_id: string
          color?: string | null
          created_at?: string
          id?: string
          is_lost?: boolean
          is_won?: boolean
          name: string
          position: number
        }
        Update: {
          brand_id?: string
          color?: string | null
          created_at?: string
          id?: string
          is_lost?: boolean
          is_won?: boolean
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "stages_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          brand_id: string
          color: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      task_reminders: {
        Row: {
          channel: Database["public"]["Enums"]["task_reminder_channel"]
          created_at: string
          id: string
          offset_minutes: number
          remind_at: string
          send_error: string | null
          sent_at: string | null
          task_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["task_reminder_channel"]
          created_at?: string
          id?: string
          offset_minutes: number
          remind_at: string
          send_error?: string | null
          sent_at?: string | null
          task_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["task_reminder_channel"]
          created_at?: string
          id?: string
          offset_minutes?: number
          remind_at?: string
          send_error?: string | null
          sent_at?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_reminders_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          brand_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          due_at: string | null
          id: string
          kind: Database["public"]["Enums"]["task_kind"]
          lead_id: string | null
          notes: string | null
          parent_task_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          recurrence: Json | null
          snoozed_until: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          brand_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["task_kind"]
          lead_id?: string | null
          notes?: string | null
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence?: Json | null
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          brand_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["task_kind"]
          lead_id?: string | null
          notes?: string | null
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence?: Json | null
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_runs: {
        Row: {
          automation_id: string | null
          brand_id: string
          current_node_id: string | null
          finished_at: string | null
          id: string
          lead_id: string | null
          next_run_at: string | null
          started_at: string
          state: Json
          status: string
          workflow_id: string | null
        }
        Insert: {
          automation_id?: string | null
          brand_id: string
          current_node_id?: string | null
          finished_at?: string | null
          id?: string
          lead_id?: string | null
          next_run_at?: string | null
          started_at?: string
          state?: Json
          status?: string
          workflow_id?: string | null
        }
        Update: {
          automation_id?: string | null
          brand_id?: string
          current_node_id?: string | null
          finished_at?: string | null
          id?: string
          lead_id?: string | null
          next_run_at?: string | null
          started_at?: string
          state?: Json
          status?: string
          workflow_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          enabled: boolean
          graph: Json
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          graph: Json
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          graph?: Json
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflows_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      brand_role: {
        Args: { b: string }
        Returns: Database["public"]["Enums"]["member_role"]
      }
      current_member_campaign_ids: { Args: never; Returns: string[] }
      current_member_visible_calendar_ids: { Args: never; Returns: string[] }
      current_member_visible_list_ids: { Args: never; Returns: string[] }
      current_member_visible_script_ids: { Args: never; Returns: string[] }
      grant_founder_brand_access: {
        Args: { p_email: string; p_member_id: string }
        Returns: undefined
      }
      is_brand_member: { Args: { b: string }; Returns: boolean }
      is_manager_or_above: { Args: { b: string }; Returns: boolean }
      seed_automations_for_brand: {
        Args: { p_brand_id: string }
        Returns: undefined
      }
    }
    Enums: {
      call_direction: "outbound" | "inbound"
      lead_source: "manual" | "form" | "csv" | "api" | "workflow"
      list_source: "import" | "manual" | "filter"
      member_role: "owner" | "admin" | "manager" | "agent" | "viewer"
      sms_direction: "outbound" | "inbound"
      sms_status: "queued" | "sent" | "delivered" | "failed" | "received"
      task_kind: "call" | "text" | "email" | "meeting" | "note" | "other"
      task_priority: "low" | "normal" | "high"
      task_reminder_channel: "email" | "sms" | "in_app"
      task_status: "open" | "done"
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
    Enums: {
      call_direction: ["outbound", "inbound"],
      lead_source: ["manual", "form", "csv", "api", "workflow"],
      list_source: ["import", "manual", "filter"],
      member_role: ["owner", "admin", "manager", "agent", "viewer"],
      sms_direction: ["outbound", "inbound"],
      sms_status: ["queued", "sent", "delivered", "failed", "received"],
      task_kind: ["call", "text", "email", "meeting", "note", "other"],
      task_priority: ["low", "normal", "high"],
      task_reminder_channel: ["email", "sms", "in_app"],
      task_status: ["open", "done"],
    },
  },
} as const
