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
      appointments: {
        Row: {
          brand_id: string
          created_at: string
          ends_at: string | null
          id: string
          lead_id: string
          location: string | null
          member_id: string | null
          notes: string | null
          starts_at: string
          status: string
          title: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          ends_at?: string | null
          id?: string
          lead_id: string
          location?: string | null
          member_id?: string | null
          notes?: string | null
          starts_at: string
          status?: string
          title: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          lead_id?: string
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
          ein: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          dba?: string | null
          ein?: string | null
          id: string
          name: string
          slug: string
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          dba?: string | null
          ein?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      calls: {
        Row: {
          brand_id: string
          callback_at: string | null
          created_at: string
          direction: Database["public"]["Enums"]["call_direction"]
          disposition: string | null
          duration_sec: number | null
          ended_at: string | null
          from_number: string
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
          created_at?: string
          direction: Database["public"]["Enums"]["call_direction"]
          disposition?: string | null
          duration_sec?: number | null
          ended_at?: string | null
          from_number: string
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
          created_at?: string
          direction?: Database["public"]["Enums"]["call_direction"]
          disposition?: string | null
          duration_sec?: number | null
          ended_at?: string | null
          from_number?: string
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
      dispositions: {
        Row: {
          brand_id: string
          code: string
          created_at: string
          id: string
          is_archived: boolean
          label: string
          sort_order: number
          tone: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          code: string
          created_at?: string
          id?: string
          is_archived?: boolean
          label: string
          sort_order?: number
          tone?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          code?: string
          created_at?: string
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
        ]
      }
      inbound_routes: {
        Row: {
          brand_id: string
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
      members: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          email_oauth: Json | null
          email_provider: string | null
          full_name: string | null
          id: string
          mobile_phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          email_oauth?: Json | null
          email_provider?: string | null
          full_name?: string | null
          id: string
          mobile_phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          email_oauth?: Json | null
          email_provider?: string | null
          full_name?: string | null
          id?: string
          mobile_phone?: string | null
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
      grant_founder_brand_access: {
        Args: { p_email: string; p_member_id: string }
        Returns: undefined
      }
      is_brand_member: { Args: { b: string }; Returns: boolean }
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
