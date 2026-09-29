/**
 * ARQUIVO GERADO — NÃO EDITAR À MÃO.
 *
 * Origem: schema do Postgres, via `pnpm db:types` (scripts/gen-db-types.ts).
 * Regenere depois de toda migration e commite o resultado: o CI compara o
 * arquivo commitado com o schema e falha se saírem de sincronia.
 */

export type Json = string | number | boolean | null | { [chave: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      analytics_daily: {
        Row: {
          app_id: string;
          day: string;
          installs: number;
          active_users: number;
          sessions: number;
          push_sent: number;
          push_opened: number;
          orders_app: number;
          revenue_app_cents: number;
          orders_site: number;
          revenue_site_cents: number;
          updated_at: string;
        };
        Insert: {
          app_id: string;
          day: string;
          installs?: number;
          active_users?: number;
          sessions?: number;
          push_sent?: number;
          push_opened?: number;
          orders_app?: number;
          revenue_app_cents?: number;
          orders_site?: number;
          revenue_site_cents?: number;
          updated_at?: string;
        };
        Update: {
          app_id?: string;
          day?: string;
          installs?: number;
          active_users?: number;
          sessions?: number;
          push_sent?: number;
          push_opened?: number;
          orders_app?: number;
          revenue_app_cents?: number;
          orders_site?: number;
          revenue_site_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "analytics_daily_app_id_fkey";
            columns: ["app_id"];
            referencedRelation: "apps";
            referencedColumns: ["id"];
          },
        ];
      };
      app_configs: {
        Row: {
          id: string;
          app_id: string;
          version: number;
          config: Json;
          status: Database["public"]["Enums"]["app_config_status"];
          published_by: string | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          app_id: string;
          version: number;
          config: Json;
          status?: Database["public"]["Enums"]["app_config_status"];
          published_by?: string | null;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          app_id?: string;
          version?: number;
          config?: Json;
          status?: Database["public"]["Enums"]["app_config_status"];
          published_by?: string | null;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "app_configs_app_id_fkey";
            columns: ["app_id"];
            referencedRelation: "apps";
            referencedColumns: ["id"];
          },
        ];
      };
      apps: {
        Row: {
          id: string;
          store_id: string;
          display_name: string;
          bundle_id_ios: string | null;
          package_android: string | null;
          expo_project_id: string | null;
          onesignal_app_id: string | null;
          onesignal_api_key_enc: string | null;
          ios_asc_app_id: string | null;
          apple_team_id: string | null;
          current_config_version: number | null;
          icon_path: string | null;
          splash_path: string | null;
          created_at: string;
          updated_at: string;
          device_secret_enc: string | null;
          android_cert_fingerprints: string[];
          ios_links_linked_at: string | null;
          android_links_linked_at: string | null;
          links_error: string | null;
        };
        Insert: {
          id?: string;
          store_id: string;
          display_name: string;
          bundle_id_ios?: string | null;
          package_android?: string | null;
          expo_project_id?: string | null;
          onesignal_app_id?: string | null;
          onesignal_api_key_enc?: string | null;
          ios_asc_app_id?: string | null;
          apple_team_id?: string | null;
          current_config_version?: number | null;
          icon_path?: string | null;
          splash_path?: string | null;
          created_at?: string;
          updated_at?: string;
          device_secret_enc?: string | null;
          android_cert_fingerprints?: string[];
          ios_links_linked_at?: string | null;
          android_links_linked_at?: string | null;
          links_error?: string | null;
        };
        Update: {
          id?: string;
          store_id?: string;
          display_name?: string;
          bundle_id_ios?: string | null;
          package_android?: string | null;
          expo_project_id?: string | null;
          onesignal_app_id?: string | null;
          onesignal_api_key_enc?: string | null;
          ios_asc_app_id?: string | null;
          apple_team_id?: string | null;
          current_config_version?: number | null;
          icon_path?: string | null;
          splash_path?: string | null;
          created_at?: string;
          updated_at?: string;
          device_secret_enc?: string | null;
          android_cert_fingerprints?: string[];
          ios_links_linked_at?: string | null;
          android_links_linked_at?: string | null;
          links_error?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "apps_store_id_fkey";
            columns: ["store_id"];
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          id: string;
          actor_id: string | null;
          org_id: string | null;
          action: Database["public"]["Enums"]["audit_action"];
          entity: string;
          entity_id: string | null;
          diff: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          org_id?: string | null;
          action: Database["public"]["Enums"]["audit_action"];
          entity: string;
          entity_id?: string | null;
          diff?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_id?: string | null;
          org_id?: string | null;
          action?: Database["public"]["Enums"]["audit_action"];
          entity?: string;
          entity_id?: string | null;
          diff?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      automation_runs: {
        Row: {
          id: string;
          automation_id: string;
          device_id: string;
          trigger_ref: string | null;
          status: Database["public"]["Enums"]["automation_run_status"];
          scheduled_for: string;
          sent_at: string | null;
          canceled_reason: string | null;
          created_at: string;
          claimed_at: string | null;
          deep_link: string | null;
          title: string | null;
          body: string | null;
        };
        Insert: {
          id?: string;
          automation_id: string;
          device_id: string;
          trigger_ref?: string | null;
          status?: Database["public"]["Enums"]["automation_run_status"];
          scheduled_for: string;
          sent_at?: string | null;
          canceled_reason?: string | null;
          created_at?: string;
          claimed_at?: string | null;
          deep_link?: string | null;
          title?: string | null;
          body?: string | null;
        };
        Update: {
          id?: string;
          automation_id?: string;
          device_id?: string;
          trigger_ref?: string | null;
          status?: Database["public"]["Enums"]["automation_run_status"];
          scheduled_for?: string;
          sent_at?: string | null;
          canceled_reason?: string | null;
          created_at?: string;
          claimed_at?: string | null;
          deep_link?: string | null;
          title?: string | null;
          body?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "automation_runs_automation_id_fkey";
            columns: ["automation_id"];
            referencedRelation: "push_automations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_runs_device_id_fkey";
            columns: ["device_id"];
            referencedRelation: "devices";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_webhooks: {
        Row: {
          automation_id: string;
          app_id: string;
          token_hash: string;
          token_hint: string;
          created_by: string | null;
          created_at: string;
          last_received_at: string | null;
          received_count: number;
        };
        Insert: {
          automation_id: string;
          app_id: string;
          token_hash: string;
          token_hint: string;
          created_by?: string | null;
          created_at?: string;
          last_received_at?: string | null;
          received_count?: number;
        };
        Update: {
          automation_id?: string;
          app_id?: string;
          token_hash?: string;
          token_hint?: string;
          created_by?: string | null;
          created_at?: string;
          last_received_at?: string | null;
          received_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "automation_webhooks_app_id_fkey";
            columns: ["app_id"];
            referencedRelation: "apps";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automation_webhooks_automation_id_fkey";
            columns: ["automation_id"];
            referencedRelation: "push_automations";
            referencedColumns: ["id"];
          },
        ];
      };
      back_in_stock_subs: {
        Row: {
          id: string;
          app_id: string;
          device_id: string;
          variant_id: string;
          deep_link: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          app_id: string;
          device_id: string;
          variant_id: string;
          deep_link?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          app_id?: string;
          device_id?: string;
          variant_id?: string;
          deep_link?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "back_in_stock_subs_app_id_fkey";
            columns: ["app_id"];
            referencedRelation: "apps";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "back_in_stock_subs_device_id_fkey";
            columns: ["device_id"];
            referencedRelation: "devices";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_customers: {
        Row: {
          org_id: string;
          provider: Database["public"]["Enums"]["billing_provider"];
          external_id: string;
          nome: string;
          documento_tipo: string;
          documento_final: string;
          email: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          org_id: string;
          provider: Database["public"]["Enums"]["billing_provider"];
          external_id: string;
          nome: string;
          documento_tipo: string;
          documento_final: string;
          email: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          org_id?: string;
          provider?: Database["public"]["Enums"]["billing_provider"];
          external_id?: string;
          nome?: string;
          documento_tipo?: string;
          documento_final?: string;
          email?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "billing_customers_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_events: {
        Row: {
          provider: Database["public"]["Enums"]["billing_provider"];
          external_id: string;
          tipo: string;
          org_id: string | null;
          resultado: string;
          recebido_em: string;
        };
        Insert: {
          provider: Database["public"]["Enums"]["billing_provider"];
          external_id: string;
          tipo: string;
          org_id?: string | null;
          resultado: string;
          recebido_em?: string;
        };
        Update: {
          provider?: Database["public"]["Enums"]["billing_provider"];
          external_id?: string;
          tipo?: string;
          org_id?: string | null;
          resultado?: string;
          recebido_em?: string;
        };
        Relationships: [
          {
            foreignKeyName: "billing_events_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      builds: {
        Row: {
          id: string;
          app_id: string;
          platform: Database["public"]["Enums"]["device_platform"];
          profile: Database["public"]["Enums"]["build_profile"];
          status: Database["public"]["Enums"]["build_status"];
          eas_build_id: string | null;
          version: string | null;
          build_number: number | null;
          logs_url: string | null;
          error: string | null;
          config_version: number | null;
          triggered_by: string | null;
          started_at: string | null;
          finished_at: string | null;
          submitted_at: string | null;
          created_at: string;
          updated_at: string;
          artifact_url: string | null;
          submission_id: string | null;
          manual_action: string | null;
          notified_status: Database["public"]["Enums"]["build_status"] | null;
        };
        Insert: {
          id?: string;
          app_id: string;
          platform: Database["public"]["Enums"]["device_platform"];
          profile?: Database["public"]["Enums"]["build_profile"];
          status?: Database["public"]["Enums"]["build_status"];
          eas_build_id?: string | null;
          version?: string | null;
          build_number?: number | null;
          logs_url?: string | null;
          error?: string | null;
          config_version?: number | null;
          triggered_by?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          submitted_at?: string | null;
          created_at?: string;
          updated_at?: string;
          artifact_url?: string | null;
          submission_id?: string | null;
          manual_action?: string | null;
          notified_status?: Database["public"]["Enums"]["build_status"] | null;
        };
        Update: {
          id?: string;
          app_id?: string;
          platform?: Database["public"]["Enums"]["device_platform"];
          profile?: Database["public"]["Enums"]["build_profile"];
          status?: Database["public"]["Enums"]["build_status"];
          eas_build_id?: string | null;
          version?: string | null;
          build_number?: number | null;
          logs_url?: string | null;
          error?: string | null;
          config_version?: number | null;
          triggered_by?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          submitted_at?: string | null;
          created_at?: string;
          updated_at?: string;
          artifact_url?: string | null;
          submission_id?: string | null;
          manual_action?: string | null;
          notified_status?: Database["public"]["Enums"]["build_status"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "builds_app_id_fkey";
            columns: ["app_id"];
            referencedRelation: "apps";
            referencedColumns: ["id"];
          },
        ];
      };
      cart_events: {
        Row: {
          id: string;
          app_id: string;
          device_id: string | null;
          cart_token: string | null;
          item_count: number;
          value_cents: number | null;
          currency: string | null;
          event: Database["public"]["Enums"]["cart_event_type"];
          created_at: string;
        };
        Insert: {
          id?: string;
          app_id: string;
          device_id?: string | null;
          cart_token?: string | null;
          item_count: number;
          value_cents?: number | null;
          currency?: string | null;
          event: Database["public"]["Enums"]["cart_event_type"];
          created_at?: string;
        };
        Update: {
          id?: string;
          app_id?: string;
          device_id?: string | null;
          cart_token?: string | null;
          item_count?: number;
          value_cents?: number | null;
          currency?: string | null;
          event?: Database["public"]["Enums"]["cart_event_type"];
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cart_events_app_id_fkey";
            columns: ["app_id"];
            referencedRelation: "apps";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cart_events_device_id_fkey";
            columns: ["device_id"];
            referencedRelation: "devices";
            referencedColumns: ["id"];
          },
        ];
      };
      config_presets: {
        Row: {
          id: string;
          nome: string;
          tema: string;
          descricao: string | null;
          tabs: Json;
          hide_selectors: Json;
          custom_css: string;
          ativo: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          nome: string;
          tema: string;
          descricao?: string | null;
          tabs: Json;
          hide_selectors?: Json;
          custom_css?: string;
          ativo?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          nome?: string;
          tema?: string;
          descricao?: string | null;
          tabs?: Json;
          hide_selectors?: Json;
          custom_css?: string;
          ativo?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      developer_accounts: {
        Row: {
          id: string;
          org_id: string;
          platform: Database["public"]["Enums"]["developer_platform"];
          status: Database["public"]["Enums"]["developer_account_status"];
          apple_team_id: string | null;
          asc_key_id: string | null;
          asc_issuer_id: string | null;
          asc_key_enc: string | null;
          apns_key_id: string | null;
          apns_key_enc: string | null;
          google_service_account_enc: string | null;
          verified_at: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          platform: Database["public"]["Enums"]["developer_platform"];
          status?: Database["public"]["Enums"]["developer_account_status"];
          apple_team_id?: string | null;
          asc_key_id?: string | null;
          asc_issuer_id?: string | null;
          asc_key_enc?: string | null;
          apns_key_id?: string | null;
          apns_key_enc?: string | null;
          google_service_account_enc?: string | null;
          verified_at?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          platform?: Database["public"]["Enums"]["developer_platform"];
          status?: Database["public"]["Enums"]["developer_account_status"];
          apple_team_id?: string | null;
          asc_key_id?: string | null;
          asc_issuer_id?: string | null;
          asc_key_enc?: string | null;
          apns_key_id?: string | null;
          apns_key_enc?: string | null;
          google_service_account_enc?: string | null;
          verified_at?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "developer_accounts_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      device_days: {
        Row: {
          app_id: string;
          device_id: string;
          day: string;
          opens: number;
        };
        Insert: {
          app_id: string;
          device_id: string;
          day: string;
          opens?: number;
        };
        Update: {
          app_id?: string;
          device_id?: string;
          day?: string;
          opens?: number;
        };
        Relationships: [
          {
            foreignKeyName: "device_days_app_id_fkey";
            columns: ["app_id"];
            referencedRelation: "apps";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "device_days_device_id_fkey";
            columns: ["device_id"];
            referencedRelation: "devices";
            referencedColumns: ["id"];
          },
        ];
      };
      devices: {
        Row: {
          id: string;
          app_id: string;
          onesignal_subscription_id: string;
          platform: Database["public"]["Enums"]["device_platform"];
          app_version: string | null;
          external_id: string | null;
          customer_email_hash: string | null;
          last_seen_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          app_id: string;
          onesignal_subscription_id: string;
          platform: Database["public"]["Enums"]["device_platform"];
          app_version?: string | null;
          external_id?: string | null;
          customer_email_hash?: string | null;
          last_seen_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          app_id?: string;
          onesignal_subscription_id?: string;
          platform?: Database["public"]["Enums"]["device_platform"];
          app_version?: string | null;
          external_id?: string | null;
          customer_email_hash?: string | null;
          last_seen_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "devices_app_id_fkey";
            columns: ["app_id"];
            referencedRelation: "apps";
            referencedColumns: ["id"];
          },
        ];
      };
      email_preferences: {
        Row: {
          org_id: string;
          user_id: string;
          revisao_do_app: boolean;
          resposta_do_suporte: boolean;
          updated_at: string;
        };
        Insert: {
          org_id: string;
          user_id: string;
          revisao_do_app?: boolean;
          resposta_do_suporte?: boolean;
          updated_at?: string;
        };
        Update: {
          org_id?: string;
          user_id?: string;
          revisao_do_app?: boolean;
          resposta_do_suporte?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "email_preferences_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          id: string;
          kind: Database["public"]["Enums"]["invitation_kind"];
          org_id: string | null;
          org_role: Database["public"]["Enums"]["membership_role"] | null;
          platform_role: Database["public"]["Enums"]["platform_admin_role"] | null;
          email: string;
          token_hash: string;
          invited_by: string | null;
          expires_at: string;
          accepted_at: string | null;
          accepted_by: string | null;
          revoked_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          kind: Database["public"]["Enums"]["invitation_kind"];
          org_id?: string | null;
          org_role?: Database["public"]["Enums"]["membership_role"] | null;
          platform_role?: Database["public"]["Enums"]["platform_admin_role"] | null;
          email: string;
          token_hash: string;
          invited_by?: string | null;
          expires_at: string;
          accepted_at?: string | null;
          accepted_by?: string | null;
          revoked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          kind?: Database["public"]["Enums"]["invitation_kind"];
          org_id?: string | null;
          org_role?: Database["public"]["Enums"]["membership_role"] | null;
          platform_role?: Database["public"]["Enums"]["platform_admin_role"] | null;
          email?: string;
          token_hash?: string;
          invited_by?: string | null;
          expires_at?: string;
          accepted_at?: string | null;
          accepted_by?: string | null;
          revoked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: {
          id: string;
          org_id: string;
          provider: Database["public"]["Enums"]["billing_provider"];
          external_id: string;
          assinatura_externa: string | null;
          valor_centavos: number;
          status: Database["public"]["Enums"]["invoice_status"];
          vencimento: string;
          paga_em: string | null;
          link: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          provider: Database["public"]["Enums"]["billing_provider"];
          external_id: string;
          assinatura_externa?: string | null;
          valor_centavos: number;
          status: Database["public"]["Enums"]["invoice_status"];
          vencimento: string;
          paga_em?: string | null;
          link?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          provider?: Database["public"]["Enums"]["billing_provider"];
          external_id?: string;
          assinatura_externa?: string | null;
          valor_centavos?: number;
          status?: Database["public"]["Enums"]["invoice_status"];
          vencimento?: string;
          paga_em?: string | null;
          link?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_heartbeats: {
        Row: {
          job: string;
          last_success_at: string | null;
          last_failure_at: string | null;
          failing_since: string | null;
          last_error: string | null;
          last_duration_ms: number | null;
          updated_at: string;
        };
        Insert: {
          job: string;
          last_success_at?: string | null;
          last_failure_at?: string | null;
          failing_since?: string | null;
          last_error?: string | null;
          last_duration_ms?: number | null;
          updated_at?: string;
        };
        Update: {
          job?: string;
          last_success_at?: string | null;
          last_failure_at?: string | null;
          failing_since?: string | null;
          last_error?: string | null;
          last_duration_ms?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      memberships: {
        Row: {
          org_id: string;
          user_id: string;
          role: Database["public"]["Enums"]["membership_role"];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          org_id: string;
          user_id: string;
          role?: Database["public"]["Enums"]["membership_role"];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          org_id?: string;
          user_id?: string;
          role?: Database["public"]["Enums"]["membership_role"];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      org_notes: {
        Row: {
          id: string;
          org_id: string;
          author_id: string | null;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          author_id?: string | null;
          body: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          author_id?: string | null;
          body?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "org_notes_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          status: Database["public"]["Enums"]["org_status"];
          trial_ends_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          status?: Database["public"]["Enums"]["org_status"];
          trial_ends_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          status?: Database["public"]["Enums"]["org_status"];
          trial_ends_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ota_updates: {
        Row: {
          id: string;
          status: Database["public"]["Enums"]["ota_status"];
          message: string;
          commit_sha: string | null;
          total: number | null;
          concluidas: number;
          falhas: number;
          error: string | null;
          triggered_by: string | null;
          started_at: string | null;
          finished_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          status?: Database["public"]["Enums"]["ota_status"];
          message: string;
          commit_sha?: string | null;
          total?: number | null;
          concluidas?: number;
          falhas?: number;
          error?: string | null;
          triggered_by?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          status?: Database["public"]["Enums"]["ota_status"];
          message?: string;
          commit_sha?: string | null;
          total?: number | null;
          concluidas?: number;
          falhas?: number;
          error?: string | null;
          triggered_by?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      plans: {
        Row: {
          id: string;
          nome: string;
          descricao: string;
          preco_centavos: number;
          limite_lojas: number | null;
          limite_aparelhos: number | null;
          limite_campanhas_mes: number | null;
          disponivel: boolean;
          vale_no_teste: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          nome: string;
          descricao?: string;
          preco_centavos: number;
          limite_lojas?: number | null;
          limite_aparelhos?: number | null;
          limite_campanhas_mes?: number | null;
          disponivel?: boolean;
          vale_no_teste?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          nome?: string;
          descricao?: string;
          preco_centavos?: number;
          limite_lojas?: number | null;
          limite_aparelhos?: number | null;
          limite_campanhas_mes?: number | null;
          disponivel?: boolean;
          vale_no_teste?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_admins: {
        Row: {
          user_id: string;
          role: Database["public"]["Enums"]["platform_admin_role"];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          role?: Database["public"]["Enums"]["platform_admin_role"];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          role?: Database["public"]["Enums"]["platform_admin_role"];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_settings: {
        Row: {
          chave: string;
          valor: Json;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          chave: string;
          valor: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          chave?: string;
          valor?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      preview_sessions: {
        Row: {
          id: string;
          app_id: string;
          token_hash: string;
          created_by: string | null;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          app_id: string;
          token_hash: string;
          created_by?: string | null;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          app_id?: string;
          token_hash?: string;
          created_by?: string | null;
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "preview_sessions_app_id_fkey";
            columns: ["app_id"];
            referencedRelation: "apps";
            referencedColumns: ["id"];
          },
        ];
      };
      push_automations: {
        Row: {
          id: string;
          app_id: string;
          type: Database["public"]["Enums"]["push_automation_type"];
          enabled: boolean;
          delay_minutes: number;
          title: string;
          body: string;
          deep_link: string | null;
          stats: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          app_id: string;
          type: Database["public"]["Enums"]["push_automation_type"];
          enabled?: boolean;
          delay_minutes?: number;
          title: string;
          body: string;
          deep_link?: string | null;
          stats?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          app_id?: string;
          type?: Database["public"]["Enums"]["push_automation_type"];
          enabled?: boolean;
          delay_minutes?: number;
          title?: string;
          body?: string;
          deep_link?: string | null;
          stats?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_automations_app_id_fkey";
            columns: ["app_id"];
            referencedRelation: "apps";
            referencedColumns: ["id"];
          },
        ];
      };
      push_campaigns: {
        Row: {
          id: string;
          app_id: string;
          title: string;
          body: string;
          image_path: string | null;
          deep_link: string | null;
          segment: Json;
          status: Database["public"]["Enums"]["push_campaign_status"];
          scheduled_at: string | null;
          sent_at: string | null;
          onesignal_notification_id: string | null;
          stats: Json;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          app_id: string;
          title: string;
          body: string;
          image_path?: string | null;
          deep_link?: string | null;
          segment?: Json;
          status?: Database["public"]["Enums"]["push_campaign_status"];
          scheduled_at?: string | null;
          sent_at?: string | null;
          onesignal_notification_id?: string | null;
          stats?: Json;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          app_id?: string;
          title?: string;
          body?: string;
          image_path?: string | null;
          deep_link?: string | null;
          segment?: Json;
          status?: Database["public"]["Enums"]["push_campaign_status"];
          scheduled_at?: string | null;
          sent_at?: string | null;
          onesignal_notification_id?: string | null;
          stats?: Json;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_campaigns_app_id_fkey";
            columns: ["app_id"];
            referencedRelation: "apps";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limits: {
        Row: {
          chave: string;
          janela: string;
          contagem: number;
        };
        Insert: {
          chave: string;
          janela: string;
          contagem?: number;
        };
        Update: {
          chave?: string;
          janela?: string;
          contagem?: number;
        };
        Relationships: [];
      };
      shop_orders: {
        Row: {
          id: string;
          app_id: string;
          shopify_order_id: string;
          order_number: string | null;
          source: Database["public"]["Enums"]["origem_do_pedido"];
          total_cents: number;
          currency: string;
          device_id: string | null;
          cart_token: string | null;
          ordered_at: string;
          created_at: string;
          push_campaign_id: string | null;
          push_automation_id: string | null;
        };
        Insert: {
          id?: string;
          app_id: string;
          shopify_order_id: string;
          order_number?: string | null;
          source: Database["public"]["Enums"]["origem_do_pedido"];
          total_cents?: number;
          currency?: string;
          device_id?: string | null;
          cart_token?: string | null;
          ordered_at: string;
          created_at?: string;
          push_campaign_id?: string | null;
          push_automation_id?: string | null;
        };
        Update: {
          id?: string;
          app_id?: string;
          shopify_order_id?: string;
          order_number?: string | null;
          source?: Database["public"]["Enums"]["origem_do_pedido"];
          total_cents?: number;
          currency?: string;
          device_id?: string | null;
          cart_token?: string | null;
          ordered_at?: string;
          created_at?: string;
          push_campaign_id?: string | null;
          push_automation_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "shop_orders_app_id_fkey";
            columns: ["app_id"];
            referencedRelation: "apps";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shop_orders_device_id_fkey";
            columns: ["device_id"];
            referencedRelation: "devices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shop_orders_push_automation_id_fkey";
            columns: ["push_automation_id"];
            referencedRelation: "push_automations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shop_orders_push_campaign_id_fkey";
            columns: ["push_campaign_id"];
            referencedRelation: "push_campaigns";
            referencedColumns: ["id"];
          },
        ];
      };
      stores: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          shop_domain: string | null;
          primary_url: string;
          platform: Database["public"]["Enums"]["store_platform"];
          shopify_access_token_enc: string | null;
          shopify_scopes: string[] | null;
          status: Database["public"]["Enums"]["store_status"];
          created_at: string;
          updated_at: string;
          timezone: string;
          support_email: string | null;
          shopify_conexao: Database["public"]["Enums"]["shopify_conexao"] | null;
          shopify_client_id: string | null;
          shopify_client_secret_enc: string | null;
          shopify_token_expires_at: string | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          shop_domain?: string | null;
          primary_url: string;
          platform?: Database["public"]["Enums"]["store_platform"];
          shopify_access_token_enc?: string | null;
          shopify_scopes?: string[] | null;
          status?: Database["public"]["Enums"]["store_status"];
          created_at?: string;
          updated_at?: string;
          timezone?: string;
          support_email?: string | null;
          shopify_conexao?: Database["public"]["Enums"]["shopify_conexao"] | null;
          shopify_client_id?: string | null;
          shopify_client_secret_enc?: string | null;
          shopify_token_expires_at?: string | null;
        };
        Update: {
          id?: string;
          org_id?: string;
          name?: string;
          shop_domain?: string | null;
          primary_url?: string;
          platform?: Database["public"]["Enums"]["store_platform"];
          shopify_access_token_enc?: string | null;
          shopify_scopes?: string[] | null;
          status?: Database["public"]["Enums"]["store_status"];
          created_at?: string;
          updated_at?: string;
          timezone?: string;
          support_email?: string | null;
          shopify_conexao?: Database["public"]["Enums"]["shopify_conexao"] | null;
          shopify_client_id?: string | null;
          shopify_client_secret_enc?: string | null;
          shopify_token_expires_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "stores_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          org_id: string;
          provider: Database["public"]["Enums"]["billing_provider"];
          external_id: string;
          plan_id: string;
          valor_centavos: number;
          status: Database["public"]["Enums"]["subscription_status"];
          pago_ate: string | null;
          inadimplente_desde: string | null;
          cancelada_em: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          org_id: string;
          provider: Database["public"]["Enums"]["billing_provider"];
          external_id: string;
          plan_id: string;
          valor_centavos: number;
          status?: Database["public"]["Enums"]["subscription_status"];
          pago_ate?: string | null;
          inadimplente_desde?: string | null;
          cancelada_em?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          org_id?: string;
          provider?: Database["public"]["Enums"]["billing_provider"];
          external_id?: string;
          plan_id?: string;
          valor_centavos?: number;
          status?: Database["public"]["Enums"]["subscription_status"];
          pago_ate?: string | null;
          inadimplente_desde?: string | null;
          cancelada_em?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey";
            columns: ["plan_id"];
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      support_messages: {
        Row: {
          id: string;
          ticket_id: string;
          author_id: string | null;
          da_equipe: boolean;
          texto: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          ticket_id: string;
          author_id?: string | null;
          da_equipe: boolean;
          texto: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          ticket_id?: string;
          author_id?: string | null;
          da_equipe?: boolean;
          texto?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_messages_ticket_id_fkey";
            columns: ["ticket_id"];
            referencedRelation: "support_tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      support_tickets: {
        Row: {
          id: string;
          org_id: string;
          store_id: string | null;
          author_id: string | null;
          assunto: Database["public"]["Enums"]["ticket_topic"];
          titulo: string;
          status: Database["public"]["Enums"]["ticket_status"];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          store_id?: string | null;
          author_id?: string | null;
          assunto: Database["public"]["Enums"]["ticket_topic"];
          titulo: string;
          status?: Database["public"]["Enums"]["ticket_status"];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          store_id?: string | null;
          author_id?: string | null;
          assunto?: Database["public"]["Enums"]["ticket_topic"];
          titulo?: string;
          status?: Database["public"]["Enums"]["ticket_status"];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_tickets_org_id_fkey";
            columns: ["org_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_tickets_store_id_fkey";
            columns: ["store_id"];
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<never, never>;
    Functions: {
      abrir_chamado: {
        Args: { p_org_id: string; p_assunto: Database["public"]["Enums"]["ticket_topic"]; p_titulo: string; p_texto: string; p_store_id?: string };
        Returns: string;
      };
      abrir_previa: {
        Args: { p_app_id: string; p_minutos?: number };
        Returns: { token: string | null; expira_em: string | null }[];
      };
      aceitar_convite: {
        Args: { p_token: string };
        Returns: { resultado: string | null; tipo: Database["public"]["Enums"]["invitation_kind"] | null; organizacao: string | null }[];
      };
      aceitar_convite_por_id: {
        Args: { p_id: string };
        Returns: { resultado: string | null; tipo: Database["public"]["Enums"]["invitation_kind"] | null; organizacao: string | null }[];
      };
      admin_autores_da_auditoria: {
        Args: { p_ids: string[] };
        Returns: { user_id: string | null; email: string | null; nome: string | null; equipe: boolean | null }[];
      };
      admin_config_para_preset: {
        Args: { p_app_id: string };
        Returns: { tabs: Json | null; hide_selectors: Json | null; custom_css: string | null }[];
      };
      admin_email_do_usuario: {
        Args: { p_user_id: string };
        Returns: string;
      };
      admin_equipe: {
        Args: Record<string, never>;
        Returns: { user_id: string | null; email: string | null; role: Database["public"]["Enums"]["platform_admin_role"] | null; created_at: string | null; segundo_fator: boolean | null }[];
      };
      admin_membros_da_org: {
        Args: { p_org_id: string };
        Returns: { user_id: string | null; email: string | null; role: Database["public"]["Enums"]["membership_role"] | null; created_at: string | null; ultimo_acesso: string | null }[];
      };
      admin_notas_da_org: {
        Args: { p_org_id: string; p_limite?: number };
        Returns: { id: string | null; body: string | null; created_at: string | null; author_id: string | null; author_email: string | null }[];
      };
      admin_organizacoes: {
        Args: { p_busca?: string; p_situacao?: Database["public"]["Enums"]["org_status"]; p_plano?: string; p_etapa?: string; p_saude?: string; p_limite?: number; p_deslocamento?: number };
        Returns: { id: string | null; nome: string | null; identificador: string | null; situacao: Database["public"]["Enums"]["org_status"] | null; teste_ate: string | null; criada_em: string | null; plano_id: string | null; plano: string | null; assinatura_cancelada: boolean | null; lojas: number | null; etapa: string | null; saude: string | null; motivos: string[] | null; ultima_atividade: string | null; total: number | null }[];
      };
      admin_redefinir_segundo_fator: {
        Args: { p_ator: string; p_alvo: string };
        Returns: number;
      };
      admin_usuario_por_email: {
        Args: { p_email: string };
        Returns: string;
      };
      agendar_inativos: {
        Args: Record<string, never>;
        Returns: number;
      };
      agendar_pedido_enviado: {
        Args: { p_app_id: string; p_shopify_order_id: string };
        Returns: boolean;
      };
      agendar_pelo_webhook: {
        Args: { p_automacao: string; p_clientes: string[]; p_titulo?: string; p_corpo?: string; p_link?: string; p_ref?: string };
        Returns: number;
      };
      apagar_dados_da_shopify: {
        Args: { p_shop_domain: string };
        Returns: number;
      };
      aparelhos_por_loja: {
        Args: { p_org_id: string };
        Returns: { store_id: string | null; nome: string | null; aparelhos_30d: number | null }[];
      };
      app_da_loja_shopify: {
        Args: { p_shop_domain: string };
        Returns: { app_id: string | null; store_id: string | null; timezone: string | null }[];
      };
      ativos_no_periodo: {
        Args: { p_app_id: string; p_de: string; p_ate: string };
        Returns: number;
      };
      avisar_de_volta: {
        Args: { p_app_id: string; p_variant_id: string };
        Returns: number;
      };
      batimentos_publicos: {
        Args: Record<string, never>;
        Returns: { job: string | null; ultimo_sucesso: string | null; ultima_falha: string | null; falhando_desde: string | null }[];
      };
      builds_em_revisao: {
        Args: { p_limite?: number };
        Returns: { id: string | null; bundle_id_ios: string | null; asc_key_enc: string | null; asc_key_id: string | null; asc_issuer_id: string | null }[];
      };
      caixa_de_avisos: {
        Args: { p_app_id: string; p_subscription: string; p_limite?: number };
        Returns: { id: string | null; title: string | null; body: string | null; deep_link: string | null; image_path: string | null; sent_at: string | null }[];
      };
      campanhas_para_estatistica: {
        Args: { p_limite?: number };
        Returns: { id: string | null; app_id: string | null; onesignal_notification_id: string | null; onesignal_app_id: string | null; onesignal_api_key_enc: string | null }[];
      };
      concluir_campanha: {
        Args: { p_id: string; p_notification_id: string; p_stats?: Json };
        Returns: unknown;
      };
      concluir_envio: {
        Args: { p_id: string };
        Returns: unknown;
      };
      consequencias_de_excluir_minha_conta: {
        Args: Record<string, never>;
        Returns: { org_id: string | null; empresa: string | null; efeito: string | null; sucessor: string | null; lojas: number | null }[];
      };
      consolidar_analytics: {
        Args: { p_dias?: number };
        Returns: number;
      };
      consumir_limite: {
        Args: { p_chave: string; p_maximo: number; p_janela_segundos?: number };
        Returns: boolean;
      };
      contar_abertura: {
        Args: { p_app_id: string; p_device_id: string };
        Returns: unknown;
      };
      contar_ota: {
        Args: { p_id: string; p_ok: boolean };
        Returns: unknown;
      };
      criar_minha_organizacao: {
        Args: { p_nome: string };
        Returns: string;
      };
      dados_da_ota: {
        Args: { p_store_id: string };
        Returns: { app_id: string | null; store_id: string | null; nome_do_app: string | null; bundle_id_ios: string | null; package_android: string | null; expo_project_id: string | null; onesignal_app_id: string | null; device_secret_enc: string | null }[];
      };
      definir_chave_do_webhook: {
        Args: { p_automacao: string; p_ator: string; p_hash: string; p_dica: string };
        Returns: unknown;
      };
      definir_identificador_do_app: {
        Args: { p_app_id: string; p_ator: string; p_identificador: string };
        Returns: unknown;
      };
      desconectar_shopify: {
        Args: { p_shop_domain: string };
        Returns: boolean;
      };
      devolver_aviso: {
        Args: { p_id: string };
        Returns: unknown;
      };
      devolver_campanhas_presas: {
        Args: { p_minutos?: number };
        Returns: number;
      };
      devolver_envios_presos: {
        Args: { p_minutos?: number };
        Returns: number;
      };
      dia_da_loja: {
        Args: { p_app_id: string; p_momento?: string };
        Returns: string;
      };
      email_do_autor_do_chamado: {
        Args: { p_ticket_id: string };
        Returns: string;
      };
      emails_do_build: {
        Args: { p_id: string };
        Returns: { email: string | null; nome_da_loja: string | null }[];
      };
      encerrar_assinatura: {
        Args: { p_provider: Database["public"]["Enums"]["billing_provider"]; p_assinatura: string; p_evento?: string; p_tipo?: string; p_ator?: string };
        Returns: string;
      };
      estender_teste: {
        Args: { p_org_id: string; p_ate: string };
        Returns: unknown;
      };
      falhar_campanha: {
        Args: { p_id: string; p_motivo: string };
        Returns: unknown;
      };
      falhar_envio: {
        Args: { p_id: string; p_motivo: string };
        Returns: unknown;
      };
      gravar_estatistica: {
        Args: { p_id: string; p_stats: Json };
        Returns: unknown;
      };
      gravar_revisao: {
        Args: { p_id: string; p_status?: Database["public"]["Enums"]["build_status"]; p_erro?: string };
        Returns: boolean;
      };
      imagens_de_push_sem_campanha: {
        Args: { p_limite?: number };
        Returns: { caminho: string | null }[];
      };
      inscrever_de_volta: {
        Args: { p_app_id: string; p_device_id: string; p_variant_id: string; p_deep_link?: string };
        Returns: boolean;
      };
      ler_webhook_de_automacao: {
        Args: { p_token_hash: string };
        Returns: { automacao: string | null; app_id: string | null; store_id: string | null; primary_url: string | null; ligada: boolean | null }[];
      };
      lojas_para_ota: {
        Args: Record<string, never>;
        Returns: { store_id: string | null; app_id: string | null; nome: string | null }[];
      };
      membros_da_organizacao: {
        Args: { p_org_id: string };
        Returns: { user_id: string | null; email: string | null; nome: string | null; role: Database["public"]["Enums"]["membership_role"] | null; created_at: string | null; ultimo_acesso: string | null }[];
      };
      mensagens_do_chamado: {
        Args: { p_ticket_id: string };
        Returns: { id: string | null; da_equipe: boolean | null; texto: string | null; autor: string | null; created_at: string | null }[];
      };
      meus_convites: {
        Args: Record<string, never>;
        Returns: { id: string | null; organizacao: string | null; papel: Database["public"]["Enums"]["membership_role"] | null; convidado_por: string | null; expira_em: string | null }[];
      };
      outros_superadmins: {
        Args: { p_exceto: string };
        Returns: number;
      };
      publicar_config: {
        Args: { p_app_id: string };
        Returns: number;
      };
      push_do_admin: {
        Args: { p_dias?: number };
        Returns: { app_id: string | null; loja: string | null; organizacao: string | null; campanhas_enviadas: number | null; campanhas_falhas: number | null; entregues: number | null; abertos: number | null; automacoes_enviadas: number | null; automacoes_falhas: number | null; aparelhos: number | null; ativos: number | null }[];
      };
      receita_das_campanhas: {
        Args: { p_ids: string[] };
        Returns: { campanha_id: string | null; pedidos: number | null; receita_cents: number | null }[];
      };
      receita_do_push: {
        Args: { p_app_id: string; p_dias?: number };
        Returns: { pedidos: number | null; receita_cents: number | null }[];
      };
      registrar_aparelho: {
        Args: { p_app_id: string; p_subscription: string; p_platform: Database["public"]["Enums"]["device_platform"]; p_app_version?: string; p_external_id?: string; p_email_hash?: string };
        Returns: { device_id: string | null; limitado: boolean | null; novo: boolean | null; boas_vindas: boolean | null }[];
      };
      registrar_app_na_apple: {
        Args: { p_app_id: string; p_ator: string; p_asc_app_id: string };
        Returns: unknown;
      };
      registrar_assinatura: {
        Args: { p_org_id: string; p_provider: Database["public"]["Enums"]["billing_provider"]; p_assinatura: string; p_plan_id: string; p_valor_centavos: number; p_ator: string };
        Returns: unknown;
      };
      registrar_batimento: {
        Args: { p_job: string; p_ok: boolean; p_duracao_ms?: number; p_erro?: string };
        Returns: unknown;
      };
      registrar_evento_de_carrinho: {
        Args: { p_app_id: string; p_subscription: string; p_event: Database["public"]["Enums"]["cart_event_type"]; p_item_count: number; p_cart_token?: string; p_value_cents?: number; p_currency?: string };
        Returns: { event_id: string | null; limitado: boolean | null; agendou: boolean | null; cancelou: number | null }[];
      };
      registrar_fatura: {
        Args: { p_provider: Database["public"]["Enums"]["billing_provider"]; p_fatura: string; p_assinatura: string; p_valor_centavos: number; p_status: Database["public"]["Enums"]["invoice_status"]; p_vencimento: string; p_evento?: string; p_tipo?: string; p_paga_em?: string; p_link?: string };
        Returns: string;
      };
      registrar_links_do_app: {
        Args: { p_app_id: string; p_ator: string; p_ios?: string; p_android?: string; p_erro?: string };
        Returns: unknown;
      };
      registrar_pedido: {
        Args: { p_app_id: string; p_shopify_order_id: string; p_source: Database["public"]["Enums"]["origem_do_pedido"]; p_total_cents: number; p_ordered_at: string; p_order_number?: string; p_currency?: string; p_cart_token?: string; p_push_campaign_id?: string; p_push_automation_id?: string };
        Returns: boolean;
      };
      remover_chave_do_webhook: {
        Args: { p_automacao: string; p_ator: string };
        Returns: boolean;
      };
      renomear_app: {
        Args: { p_app_id: string; p_ator: string; p_nome: string };
        Returns: unknown;
      };
      reservar_aviso: {
        Args: { p_id: string; p_status: Database["public"]["Enums"]["build_status"] };
        Returns: boolean;
      };
      reservar_campanhas: {
        Args: { p_limite?: number };
        Returns: { id: string | null; app_id: string | null; title: string | null; body: string | null; deep_link: string | null; segment: Json | null; image_path: string | null; onesignal_app_id: string | null; onesignal_api_key_enc: string | null }[];
      };
      reservar_envios_de_automacao: {
        Args: { p_limite?: number };
        Returns: { id: string | null; automation_id: string | null; app_id: string | null; subscription_id: string | null; title: string | null; body: string | null; deep_link: string | null; onesignal_app_id: string | null; onesignal_api_key_enc: string | null }[];
      };
      reservar_versao_do_build: {
        Args: { p_build_id: string };
        Returns: { numero: number | null; versao: string | null }[];
      };
      restaurar_config: {
        Args: { p_app_id: string; p_version: number };
        Returns: number;
      };
      resultado_das_automacoes: {
        Args: { p_app_id: string; p_dias?: number };
        Returns: { automacao_id: string | null; envios: number | null; pedidos: number | null; receita_cents: number | null }[];
      };
      resumo_do_admin: {
        Args: Record<string, never>;
        Returns: { orgs_ativas: number | null; orgs_em_trial: number | null; trials_vencendo_7d: number | null; orgs_inadimplentes: number | null; lojas_live: number | null; lojas_em_revisao: number | null; builds_na_fila: number | null; builds_com_erro_7d: number | null; builds_rejeitados_7d: number | null; contas_dev_com_erro: number | null; chamados_esperando: number | null; testes_encerrados_7d: number | null; acima_do_limite: number | null; mrr_centavos: number | null; assinaturas_ativas: number | null }[];
      };
      salvar_quem_paga: {
        Args: { p_org_id: string; p_provider: Database["public"]["Enums"]["billing_provider"]; p_cliente: string; p_nome: string; p_documento_tipo: string; p_documento_final: string; p_email: string; p_ator: string };
        Returns: unknown;
      };
      situacao_da_cobranca: {
        Args: { p_org_id: string };
        Returns: { em_dia: boolean | null; liberado_ate: string | null; teste_ate: string | null; assinatura: Database["public"]["Enums"]["subscription_status"] | null; plano_id: string | null; plano_nome: string | null; valor_centavos: number | null; pago_ate: string | null; inadimplente_desde: string | null; cancelada_em: string | null; limites_do_teste: boolean | null; limite_lojas: number | null; limite_aparelhos: number | null; limite_campanhas_mes: number | null; hoje: string | null }[];
      };
      status_da_loja_pelos_builds: {
        Args: { p_app_id: string };
        Returns: Database["public"]["Enums"]["store_status"];
      };
      trocar_plano_da_assinatura: {
        Args: { p_org_id: string; p_plan_id: string; p_valor_centavos: number; p_ator: string };
        Returns: unknown;
      };
      uso_da_org: {
        Args: { p_org_id: string };
        Returns: { lojas: number | null; aparelhos_30d: number | null; campanhas_no_mes: number | null }[];
      };
      ver_convite: {
        Args: { p_token: string };
        Returns: { situacao: string | null; tipo: Database["public"]["Enums"]["invitation_kind"] | null; email: string | null; organizacao: string | null; papel: Database["public"]["Enums"]["membership_role"] | null; papel_na_plataforma: Database["public"]["Enums"]["platform_admin_role"] | null; expira_em: string | null; convidado_por: string | null; ja_tem_conta: boolean | null }[];
      };
    };
    Enums: {
      app_config_status: "draft" | "published" | "archived";
      audit_action: "create" | "update" | "delete" | "view_as_start" | "view_as_end";
      automation_run_status: "scheduled" | "sent" | "canceled" | "failed";
      billing_provider: "asaas";
      build_profile: "development" | "preview" | "production";
      build_status: "queued" | "building" | "finished" | "errored" | "submitted" | "in_review" | "approved" | "rejected" | "canceled";
      cart_event_type: "add" | "update" | "checkout_started" | "purchased";
      developer_account_status: "pending" | "invited" | "verified" | "error";
      developer_platform: "apple" | "google";
      device_platform: "ios" | "android";
      invitation_kind: "organizacao" | "conta" | "equipe";
      invoice_status: "pending" | "paid" | "overdue" | "refunded" | "canceled";
      membership_role: "owner" | "admin" | "member";
      org_status: "trialing" | "active" | "past_due" | "canceled";
      origem_do_pedido: "app" | "site";
      ota_status: "queued" | "running" | "finished" | "errored";
      platform_admin_role: "superadmin" | "support";
      push_automation_type: "welcome" | "abandoned_cart" | "back_in_stock" | "order_shipped" | "inactive_7d" | "custom_webhook";
      push_campaign_status: "draft" | "scheduled" | "sending" | "sent" | "failed" | "canceled";
      shopify_conexao: "oauth" | "manual";
      store_platform: "shopify" | "other";
      store_status: "draft" | "building" | "in_review" | "rejected" | "live" | "paused";
      subscription_status: "pending" | "active" | "past_due" | "canceled";
      ticket_status: "aberto" | "respondido" | "fechado";
      ticket_topic: "publicacao" | "notificacoes" | "shopify" | "app" | "cobranca" | "outro";
    };
    CompositeTypes: Record<never, never>;
  };
};
