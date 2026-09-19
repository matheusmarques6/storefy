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
      admin_email_do_usuario: {
        Args: { p_user_id: string };
        Returns: string;
      };
      admin_membros_da_org: {
        Args: { p_org_id: string };
        Returns: { user_id: string | null; email: string | null; role: Database["public"]["Enums"]["membership_role"] | null; created_at: string | null; ultimo_acesso: string | null }[];
      };
      publicar_config: {
        Args: { p_app_id: string };
        Returns: number;
      };
      restaurar_config: {
        Args: { p_app_id: string; p_version: number };
        Returns: number;
      };
    };
    Enums: {
      app_config_status: "draft" | "published" | "archived";
      audit_action: "create" | "update" | "delete";
      membership_role: "owner" | "admin" | "member";
      org_status: "trialing" | "active" | "past_due" | "canceled";
      platform_admin_role: "superadmin" | "support";
      store_platform: "shopify" | "other";
      store_status: "draft" | "building" | "in_review" | "live" | "paused";
    };
    CompositeTypes: Record<never, never>;
  };
};
