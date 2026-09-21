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
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          plan: string;
          status: Database["public"]["Enums"]["org_status"];
          trial_ends_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          plan?: string;
          status?: Database["public"]["Enums"]["org_status"];
          trial_ends_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          plan?: string;
          status?: Database["public"]["Enums"]["org_status"];
          trial_ends_at?: string | null;
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
    };
    Views: Record<never, never>;
    Functions: {
      abrir_previa: {
        Args: { p_app_id: string; p_minutos?: number };
        Returns: { token: string | null; expira_em: string | null }[];
      };
      admin_email_do_usuario: {
        Args: { p_user_id: string };
        Returns: string;
      };
      admin_membros_da_org: {
        Args: { p_org_id: string };
        Returns: { user_id: string | null; email: string | null; role: Database["public"]["Enums"]["membership_role"] | null; created_at: string | null; ultimo_acesso: string | null }[];
      };
      agendar_pedido_enviado: {
        Args: { p_app_id: string; p_shopify_order_id: string };
        Returns: boolean;
      };
      apagar_dados_da_shopify: {
        Args: { p_shop_domain: string };
        Returns: number;
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
      dados_da_ota: {
        Args: { p_store_id: string };
        Returns: { app_id: string | null; store_id: string | null; nome_do_app: string | null; bundle_id_ios: string | null; package_android: string | null; expo_project_id: string | null; onesignal_app_id: string | null; device_secret_enc: string | null }[];
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
      emails_do_build: {
        Args: { p_id: string };
        Returns: { email: string | null; nome_da_loja: string | null }[];
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
      inscrever_de_volta: {
        Args: { p_app_id: string; p_device_id: string; p_variant_id: string; p_deep_link?: string };
        Returns: boolean;
      };
      lojas_para_ota: {
        Args: Record<string, never>;
        Returns: { store_id: string | null; app_id: string | null; nome: string | null }[];
      };
      publicar_config: {
        Args: { p_app_id: string };
        Returns: number;
      };
      registrar_aparelho: {
        Args: { p_app_id: string; p_subscription: string; p_platform: Database["public"]["Enums"]["device_platform"]; p_app_version?: string; p_external_id?: string; p_email_hash?: string };
        Returns: { device_id: string | null; limitado: boolean | null; novo: boolean | null; boas_vindas: boolean | null }[];
      };
      registrar_evento_de_carrinho: {
        Args: { p_app_id: string; p_subscription: string; p_event: Database["public"]["Enums"]["cart_event_type"]; p_item_count: number; p_cart_token?: string; p_value_cents?: number; p_currency?: string };
        Returns: { event_id: string | null; limitado: boolean | null; agendou: boolean | null; cancelou: number | null }[];
      };
      registrar_pedido: {
        Args: { p_app_id: string; p_shopify_order_id: string; p_source: Database["public"]["Enums"]["origem_do_pedido"]; p_total_cents: number; p_ordered_at: string; p_order_number?: string; p_currency?: string; p_cart_token?: string };
        Returns: boolean;
      };
      reservar_aviso: {
        Args: { p_id: string; p_status: Database["public"]["Enums"]["build_status"] };
        Returns: boolean;
      };
      reservar_campanhas: {
        Args: { p_limite?: number };
        Returns: { id: string | null; app_id: string | null; title: string | null; body: string | null; deep_link: string | null; segment: Json | null; onesignal_app_id: string | null; onesignal_api_key_enc: string | null }[];
      };
      reservar_envios_de_automacao: {
        Args: { p_limite?: number };
        Returns: { id: string | null; automation_id: string | null; app_id: string | null; subscription_id: string | null; title: string | null; body: string | null; deep_link: string | null; onesignal_app_id: string | null; onesignal_api_key_enc: string | null }[];
      };
      restaurar_config: {
        Args: { p_app_id: string; p_version: number };
        Returns: number;
      };
    };
    Enums: {
      app_config_status: "draft" | "published" | "archived";
      audit_action: "create" | "update" | "delete";
      automation_run_status: "scheduled" | "sent" | "canceled" | "failed";
      build_profile: "development" | "preview" | "production";
      build_status: "queued" | "building" | "finished" | "errored" | "submitted" | "in_review" | "approved" | "rejected" | "canceled";
      cart_event_type: "add" | "update" | "checkout_started" | "purchased";
      developer_account_status: "pending" | "invited" | "verified" | "error";
      developer_platform: "apple" | "google";
      device_platform: "ios" | "android";
      membership_role: "owner" | "admin" | "member";
      org_status: "trialing" | "active" | "past_due" | "canceled";
      origem_do_pedido: "app" | "site";
      ota_status: "queued" | "running" | "finished" | "errored";
      platform_admin_role: "superadmin" | "support";
      push_automation_type: "welcome" | "abandoned_cart" | "back_in_stock" | "order_shipped" | "inactive_7d" | "custom_webhook";
      push_campaign_status: "draft" | "scheduled" | "sending" | "sent" | "failed" | "canceled";
      store_platform: "shopify" | "other";
      store_status: "draft" | "building" | "in_review" | "live" | "paused";
    };
    CompositeTypes: Record<never, never>;
  };
};
