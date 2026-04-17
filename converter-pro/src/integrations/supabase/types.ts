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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      suppliers: {
        Row: {
          id: string
          name: string
          file_type: string | null
          frequency: string | null
          default_discount: number | null
          default_ipi: number | null
          last_processed: string | null
          total_products: number | null
          status: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          file_type?: string | null
          frequency?: string | null
          default_discount?: number | null
          default_ipi?: number | null
          last_processed?: string | null
          total_products?: number | null
          status?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          file_type?: string | null
          frequency?: string | null
          default_discount?: number | null
          default_ipi?: number | null
          last_processed?: string | null
          total_products?: number | null
          status?: string | null
          created_at?: string | null
        }
      }
      standardized_products: {
        Row: {
          id: string
          supplier_id: string | null
          supplier_name: string
          original_code: string
          final_code: string | null
          name: string
          description: string | null
          base_price: number | null
          discount_percent: number | null
          final_price: number | null
          ipi: number | null
          unit: string | null
          box_qty: number | null
          categoria: string | null
          embalagem: string | null
          status: string | null
          errors: Json | null
          has_image: boolean | null
          image_url: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          supplier_id?: string | null
          supplier_name: string
          original_code: string
          final_code?: string | null
          name: string
          description?: string | null
          base_price?: number | null
          discount_percent?: number | null
          final_price?: number | null
          ipi?: number | null
          unit?: string | null
          box_qty?: number | null
          categoria?: string | null
          embalagem?: string | null
          status?: string | null
          errors?: Json | null
          has_image?: boolean | null
          image_url?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          supplier_id?: string | null
          supplier_name?: string
          original_code?: string
          final_code?: string | null
          name?: string
          description?: string | null
          base_price?: number | null
          discount_percent?: number | null
          final_price?: number | null
          ipi?: number | null
          unit?: string | null
          box_qty?: number | null
          categoria?: string | null
          embalagem?: string | null
          status?: string | null
          errors?: Json | null
          has_image?: boolean | null
          image_url?: string | null
          created_at?: string | null
        }
      }
      export_history: {
        Row: {
          id: string
          filename: string
          supplier_name: string | null
          user_name: string | null
          date: string | null
          conversion_type: string | null
          item_count: number | null
          status: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          filename: string
          supplier_name?: string | null
          user_name?: string | null
          date?: string | null
          conversion_type?: string | null
          item_count?: number | null
          status?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          filename?: string
          supplier_name?: string | null
          user_name?: string | null
          date?: string | null
          conversion_type?: string | null
          item_count?: number | null
          status?: string | null
          created_at?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
