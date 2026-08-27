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
      lukas_drawing_issue_anchors: {
        Row: {
          id: string
          issue_id: string
          project_id: string
          file_id: string
          anchor_kind: string
          element_id: string | null
          ifc_global_id: string | null
          camera_json: Json | null
          page_number: number | null
          x: number | null
          y: number | null
          width: number | null
          height: number | null
          label: string
          active: boolean
          created_by: string
          created_at: string
          deactivated_by: string | null
          deactivated_at: string | null
          deactivation_note: string | null
          replaces_anchor_id: string | null
        }
        Insert: {
          id?: string
          issue_id: string
          project_id: string
          file_id: string
          anchor_kind: string
          element_id?: string | null
          ifc_global_id?: string | null
          camera_json?: Json | null
          page_number?: number | null
          x?: number | null
          y?: number | null
          width?: number | null
          height?: number | null
          label?: string
          active?: boolean
          created_by: string
          created_at?: string
          deactivated_by?: string | null
          deactivated_at?: string | null
          deactivation_note?: string | null
          replaces_anchor_id?: string | null
        }
        Update: {
          active?: boolean
          deactivated_by?: string | null
          deactivated_at?: string | null
          deactivation_note?: string | null
        }
        Relationships: []
      }
      lukas_drawing_object_sources: {
        Row: {
          id: string
          object_id: string
          revision_id: string
          project_id: string
          source_file_id: string
          source_sha256: string
          source_kind: string
          pdf_page_number: number | null
          x: number | null
          y: number | null
          width: number | null
          height: number | null
          element_id: string | null
          ifc_global_id: string | null
          camera_json: Json | null
          status: string
          version: number
          created_by: string
          created_at: string
          updated_by: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      hangil_project_inquiries: {
        Row: {
          company: string
          consent: boolean
          created_at: string
          email: string
          id: string
          message: string
          name: string
          phone: string
          project_name: string
          status: string
        }
        Insert: {
          company?: string
          consent: boolean
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          phone?: string
          project_name: string
          status?: string
        }
        Update: {
          company?: string
          consent?: boolean
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          phone?: string
          project_name?: string
          status?: string
        }
        Relationships: []
      }
      lua_commands: {
        Row: {
          agent: string
          approval: string
          approvedAt: string | null
          chatId: string
          command: string
          completedAt: string | null
          createdAt: string
          id: number
          intent: string | null
          messageId: number | null
          payload: string | null
          processedAt: string | null
          receivedAt: string
          recordedAt: string | null
          recordingAt: string | null
          result: string | null
          routeAgent: string
          source: string
          startedAt: string | null
          status: string
          text: string
          todoState: string | null
          updateId: number | null
          userId: string | null
          username: string | null
          workerId: string | null
        }
        Insert: {
          agent: string
          approval?: string
          approvedAt?: string | null
          chatId: string
          command: string
          completedAt?: string | null
          createdAt?: string
          id?: never
          intent?: string | null
          messageId?: number | null
          payload?: string | null
          processedAt?: string | null
          receivedAt: string
          recordedAt?: string | null
          recordingAt?: string | null
          result?: string | null
          routeAgent?: string
          source?: string
          startedAt?: string | null
          status?: string
          text: string
          todoState?: string | null
          updateId?: number | null
          userId?: string | null
          username?: string | null
          workerId?: string | null
        }
        Update: {
          agent?: string
          approval?: string
          approvedAt?: string | null
          chatId?: string
          command?: string
          completedAt?: string | null
          createdAt?: string
          id?: never
          intent?: string | null
          messageId?: number | null
          payload?: string | null
          processedAt?: string | null
          receivedAt?: string
          recordedAt?: string | null
          recordingAt?: string | null
          result?: string | null
          routeAgent?: string
          source?: string
          startedAt?: string | null
          status?: string
          text?: string
          todoState?: string | null
          updateId?: number | null
          userId?: string | null
          username?: string | null
          workerId?: string | null
        }
        Relationships: []
      }
      lua_logs: {
        Row: {
          chatId: string | null
          command: string | null
          createdAt: string
          event: string
          id: number
          level: string
          message: string | null
        }
        Insert: {
          chatId?: string | null
          command?: string | null
          createdAt?: string
          event: string
          id?: never
          level?: string
          message?: string | null
        }
        Update: {
          chatId?: string | null
          command?: string | null
          createdAt?: string
          event?: string
          id?: never
          level?: string
          message?: string | null
        }
        Relationships: []
      }
      lua_memories: {
        Row: {
          chatId: string | null
          createdAt: string
          id: number
          source: string
          text: string
        }
        Insert: {
          chatId?: string | null
          createdAt?: string
          id?: never
          source: string
          text: string
        }
        Update: {
          chatId?: string | null
          createdAt?: string
          id?: never
          source?: string
          text?: string
        }
        Relationships: []
      }
      lua_reminders: {
        Row: {
          chatId: string
          createdAt: string
          id: number
          message: string
          remindAt: string
          sentAt: string | null
          status: string
        }
        Insert: {
          chatId: string
          createdAt?: string
          id?: never
          message: string
          remindAt: string
          sentAt?: string | null
          status?: string
        }
        Update: {
          chatId?: string
          createdAt?: string
          id?: never
          message?: string
          remindAt?: string
          sentAt?: string | null
          status?: string
        }
        Relationships: []
      }
      lua_worker_pairs: {
        Row: {
          chatId: string
          createdAt: string
          id: number
          lastSeenAt: string | null
          pairCodeHash: string
          pairedAt: string | null
          pairExpiresAt: string
          revokedAt: string | null
          workerId: string | null
          workerTokenHash: string | null
        }
        Insert: {
          chatId: string
          createdAt?: string
          id?: never
          lastSeenAt?: string | null
          pairCodeHash: string
          pairedAt?: string | null
          pairExpiresAt: string
          revokedAt?: string | null
          workerId?: string | null
          workerTokenHash?: string | null
        }
        Update: {
          chatId?: string
          createdAt?: string
          id?: never
          lastSeenAt?: string | null
          pairCodeHash?: string
          pairedAt?: string | null
          pairExpiresAt?: string
          revokedAt?: string | null
          workerId?: string | null
          workerTokenHash?: string | null
        }
        Relationships: []
      }
      lukas_qto_boq_approvals: {
        Row: {
          created_at: string
          decided_by: string
          decision: string
          id: string
          note: string
          version_id: string
        }
        Insert: {
          created_at?: string
          decided_by: string
          decision: string
          id?: string
          note?: string
          version_id: string
        }
        Update: {
          created_at?: string
          decided_by?: string
          decision?: string
          id?: string
          note?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_boq_approvals_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_boq_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      lukas_qto_boq_lines: {
        Row: {
          adjustment_reason: string
          created_at: string
          created_by: string
          id: string
          item_code: string
          item_name: string
          project_id: string
          section_id: string
          signed_adjustment: number
          sort_order: number
          specification: string
          unit: string
          version_id: string
        }
        Insert: {
          adjustment_reason?: string
          created_at?: string
          created_by: string
          id?: string
          item_code: string
          item_name: string
          project_id: string
          section_id: string
          signed_adjustment?: number
          sort_order?: number
          specification?: string
          unit: string
          version_id: string
        }
        Update: {
          adjustment_reason?: string
          created_at?: string
          created_by?: string
          id?: string
          item_code?: string
          item_name?: string
          project_id?: string
          section_id?: string
          signed_adjustment?: number
          sort_order?: number
          specification?: string
          unit?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_boq_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lukas_qto_boq_lines_section_fkey"
            columns: ["section_id", "version_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_boq_sections"
            referencedColumns: ["id", "version_id", "project_id"]
          },
          {
            foreignKeyName: "lukas_qto_boq_lines_version_fkey"
            columns: ["version_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_boq_versions"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lukas_qto_boq_quantity_mappings: {
        Row: {
          created_at: string
          created_by: string
          element_ids: string[]
          factor: number
          id: string
          line_id: string
          project_id: string
          source_file_id: string
          source_quantity: number
          source_sha256: string
          source_subject_key: string
          unit: string
          version_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          element_ids?: string[]
          factor: number
          id?: string
          line_id: string
          project_id: string
          source_file_id: string
          source_quantity: number
          source_sha256: string
          source_subject_key: string
          unit: string
          version_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          element_ids?: string[]
          factor?: number
          id?: string
          line_id?: string
          project_id?: string
          source_file_id?: string
          source_quantity?: number
          source_sha256?: string
          source_subject_key?: string
          unit?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_boq_quantity_mappings_line_fkey"
            columns: ["line_id", "version_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_boq_lines"
            referencedColumns: ["id", "version_id", "project_id"]
          },
          {
            foreignKeyName: "lukas_qto_boq_quantity_mappings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lukas_qto_boq_quantity_mappings_source_fkey"
            columns: ["source_file_id", "project_id", "source_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
        ]
      }
      lukas_qto_boq_rate_components: {
        Row: {
          coefficient: number
          created_at: string
          created_by: string
          id: string
          line_id: string
          project_id: string
          resource_id: string
          version_id: string
        }
        Insert: {
          coefficient: number
          created_at?: string
          created_by: string
          id?: string
          line_id: string
          project_id: string
          resource_id: string
          version_id: string
        }
        Update: {
          coefficient?: number
          created_at?: string
          created_by?: string
          id?: string
          line_id?: string
          project_id?: string
          resource_id?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_boq_rate_components_line_fkey"
            columns: ["line_id", "version_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_boq_lines"
            referencedColumns: ["id", "version_id", "project_id"]
          },
          {
            foreignKeyName: "lukas_qto_boq_rate_components_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lukas_qto_boq_rate_components_resource_fkey"
            columns: ["resource_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_price_resources"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lukas_qto_boq_sections: {
        Row: {
          code: string
          created_at: string
          created_by: string
          id: string
          name: string
          parent_id: string | null
          project_id: string
          sort_order: number
          version_id: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          id?: string
          name: string
          parent_id?: string | null
          project_id: string
          sort_order?: number
          version_id: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          parent_id?: string | null
          project_id?: string
          sort_order?: number
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_boq_sections_parent_fkey"
            columns: ["parent_id", "version_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_boq_sections"
            referencedColumns: ["id", "version_id", "project_id"]
          },
          {
            foreignKeyName: "lukas_qto_boq_sections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lukas_qto_boq_sections_version_fkey"
            columns: ["version_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_boq_versions"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lukas_qto_boq_source_exclusions: {
        Row: {
          created_at: string
          created_by: string
          element_ids: string[]
          id: string
          project_id: string
          reason: string
          source_file_id: string
          source_quantity: number
          source_sha256: string
          source_subject_key: string
          unit: string
          version_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          element_ids?: string[]
          id?: string
          project_id: string
          reason: string
          source_file_id: string
          source_quantity: number
          source_sha256: string
          source_subject_key: string
          unit: string
          version_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          element_ids?: string[]
          id?: string
          project_id?: string
          reason?: string
          source_file_id?: string
          source_quantity?: number
          source_sha256?: string
          source_subject_key?: string
          unit?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_boq_source_exclusions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lukas_qto_boq_source_exclusions_source_fkey"
            columns: ["source_file_id", "project_id", "source_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
          {
            foreignKeyName: "lukas_qto_boq_source_exclusions_version_fkey"
            columns: ["version_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_boq_versions"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lukas_qto_boq_versions: {
        Row: {
          approved_at: string | null
          calculation_policy: string
          created_at: string
          created_by: string
          direct_cost_krw: number | null
          engine_version: string
          id: string
          line_count: number | null
          price_book_id: string
          project_id: string
          quantity_scale: number
          result_sha256: string | null
          status: string
          submitted_at: string | null
          supersedes_id: string | null
          title: string
          version_no: number
        }
        Insert: {
          approved_at?: string | null
          calculation_policy: string
          created_at?: string
          created_by: string
          direct_cost_krw?: number | null
          engine_version?: string
          id?: string
          line_count?: number | null
          price_book_id: string
          project_id: string
          quantity_scale?: number
          result_sha256?: string | null
          status?: string
          submitted_at?: string | null
          supersedes_id?: string | null
          title: string
          version_no: number
        }
        Update: {
          approved_at?: string | null
          calculation_policy?: string
          created_at?: string
          created_by?: string
          direct_cost_krw?: number | null
          engine_version?: string
          id?: string
          line_count?: number | null
          price_book_id?: string
          project_id?: string
          quantity_scale?: number
          result_sha256?: string | null
          status?: string
          submitted_at?: string | null
          supersedes_id?: string | null
          title?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_boq_versions_price_book_fkey"
            columns: ["price_book_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_price_books"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "lukas_qto_boq_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lukas_qto_boq_versions_supersedes_fkey"
            columns: ["supersedes_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_boq_versions"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lukas_qto_boq_wbs_allocations: {
        Row: {
          allocation_percent: number
          created_at: string
          created_by: string
          id: string
          line_id: string
          project_id: string
          version_id: string
          wbs_node_id: string
        }
        Insert: {
          allocation_percent: number
          created_at?: string
          created_by: string
          id?: string
          line_id: string
          project_id: string
          version_id: string
          wbs_node_id: string
        }
        Update: {
          allocation_percent?: number
          created_at?: string
          created_by?: string
          id?: string
          line_id?: string
          project_id?: string
          version_id?: string
          wbs_node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_boq_wbs_allocations_line_fkey"
            columns: ["line_id", "version_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_boq_lines"
            referencedColumns: ["id", "version_id", "project_id"]
          },
          {
            foreignKeyName: "lukas_qto_boq_wbs_allocations_node_fkey"
            columns: ["wbs_node_id", "version_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_boq_wbs_nodes"
            referencedColumns: ["id", "version_id", "project_id"]
          },
          {
            foreignKeyName: "lukas_qto_boq_wbs_allocations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lukas_qto_boq_wbs_nodes: {
        Row: {
          code: string
          created_at: string
          created_by: string
          id: string
          name: string
          parent_id: string | null
          project_id: string
          sort_order: number
          version_id: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          id?: string
          name: string
          parent_id?: string | null
          project_id: string
          sort_order?: number
          version_id: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          parent_id?: string | null
          project_id?: string
          sort_order?: number
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_boq_wbs_nodes_parent_fkey"
            columns: ["parent_id", "version_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_boq_wbs_nodes"
            referencedColumns: ["id", "version_id", "project_id"]
          },
          {
            foreignKeyName: "lukas_qto_boq_wbs_nodes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lukas_qto_boq_wbs_nodes_version_fkey"
            columns: ["version_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_boq_versions"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lukas_qto_carbon_factors: {
        Row: {
          created_at: string
          created_by: string
          declared_unit: string
          epd_declaration_number: string
          epd_program_operator: string
          epd_verifier: string
          geography: string
          gwp_a1_a3_per_unit: number
          id: string
          manufacturer: string
          material_code: string
          pcr_reference: string
          product_name: string
          project_id: string
          source_file_id: string
          source_sha256: string
          source_type: string
          standard: string
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          declared_unit: string
          epd_declaration_number?: string
          epd_program_operator?: string
          epd_verifier?: string
          geography?: string
          gwp_a1_a3_per_unit: number
          id?: string
          manufacturer?: string
          material_code: string
          pcr_reference?: string
          product_name: string
          project_id: string
          source_file_id: string
          source_sha256: string
          source_type: string
          standard: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          declared_unit?: string
          epd_declaration_number?: string
          epd_program_operator?: string
          epd_verifier?: string
          geography?: string
          gwp_a1_a3_per_unit?: number
          id?: string
          manufacturer?: string
          material_code?: string
          pcr_reference?: string
          product_name?: string
          project_id?: string
          source_file_id?: string
          source_sha256?: string
          source_type?: string
          standard?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_carbon_factor_source_identity_fkey"
            columns: ["source_file_id", "project_id", "source_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
          {
            foreignKeyName: "lukas_qto_carbon_factors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lukas_qto_download_events: {
        Row: {
          downloaded_at: string
          id: number
          release_sha256: string
          release_version: string
          user_id: string
        }
        Insert: {
          downloaded_at?: string
          id?: never
          release_sha256: string
          release_version: string
          user_id: string
        }
        Update: {
          downloaded_at?: string
          id?: never
          release_sha256?: string
          release_version?: string
          user_id?: string
        }
        Relationships: []
      }
      lukas_qto_element_identity_links: {
        Row: {
          classification_code: string
          classification_label: string
          classification_namespace: string
          classification_version: string
          confirmed_by: string
          created_at: string
          element_ledger_file_id: string
          element_ledger_sha256: string
          id: string
          ifc_file_id: string
          ifc_global_id: string
          ifc_sha256: string
          project_id: string
          revit_element_id: string
        }
        Insert: {
          classification_code: string
          classification_label?: string
          classification_namespace: string
          classification_version: string
          confirmed_by: string
          created_at?: string
          element_ledger_file_id: string
          element_ledger_sha256: string
          id?: string
          ifc_file_id: string
          ifc_global_id: string
          ifc_sha256: string
          project_id: string
          revit_element_id: string
        }
        Update: {
          classification_code?: string
          classification_label?: string
          classification_namespace?: string
          classification_version?: string
          confirmed_by?: string
          created_at?: string
          element_ledger_file_id?: string
          element_ledger_sha256?: string
          id?: string
          ifc_file_id?: string
          ifc_global_id?: string
          ifc_sha256?: string
          project_id?: string
          revit_element_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_element_identity_li_element_ledger_file_id_proje_fkey"
            columns: [
              "element_ledger_file_id",
              "project_id",
              "element_ledger_sha256",
            ]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
          {
            foreignKeyName: "lukas_qto_element_identity_li_ifc_file_id_project_id_ifc_s_fkey"
            columns: ["ifc_file_id", "project_id", "ifc_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
          {
            foreignKeyName: "lukas_qto_element_identity_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lukas_qto_file_revisions: {
        Row: {
          created_at: string
          created_by: string
          current_file_id: string
          current_sha256: string
          id: string
          previous_file_id: string
          previous_sha256: string
          project_id: string
          relation_kind: string
        }
        Insert: {
          created_at?: string
          created_by: string
          current_file_id: string
          current_sha256: string
          id?: string
          previous_file_id: string
          previous_sha256: string
          project_id: string
          relation_kind: string
        }
        Update: {
          created_at?: string
          created_by?: string
          current_file_id?: string
          current_sha256?: string
          id?: string
          previous_file_id?: string
          previous_sha256?: string
          project_id?: string
          relation_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_file_revisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lukas_qto_revision_current_identity_fkey"
            columns: ["current_file_id", "project_id", "current_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
          {
            foreignKeyName: "lukas_qto_revision_previous_identity_fkey"
            columns: ["previous_file_id", "project_id", "previous_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
        ]
      }
      lukas_qto_files: {
        Row: {
          byte_size: number
          content_type: string | null
          created_at: string
          id: string
          immutable: boolean
          kind: string
          original_filename: string
          project_id: string
          sha256: string
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          byte_size: number
          content_type?: string | null
          created_at?: string
          id?: string
          immutable?: boolean
          kind: string
          original_filename: string
          project_id: string
          sha256: string
          storage_path: string
          uploaded_by: string
        }
        Update: {
          byte_size?: number
          content_type?: string | null
          created_at?: string
          id?: string
          immutable?: boolean
          kind?: string
          original_filename?: string
          project_id?: string
          sha256?: string
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lukas_qto_license_entitlements: {
        Row: {
          granted_at: string
          plan: string
          status: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          plan?: string
          status?: string
          user_id: string
        }
        Update: {
          granted_at?: string
          plan?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      lukas_qto_material_plans: {
        Row: {
          allowance_rate: number
          baseline_factor_id: string | null
          created_at: string
          created_by: string
          design_quantity: number
          id: string
          material_code: string
          material_name: string
          project_id: string
          required_by: string | null
          required_quantity: number
          rule_id: string
          source_artifact_id: string | null
          source_file_id: string
          source_group_key: string | null
          source_sha256: string
          specification: string
          unit: string
        }
        Insert: {
          allowance_rate?: number
          baseline_factor_id?: string | null
          created_at?: string
          created_by: string
          design_quantity: number
          id?: string
          material_code: string
          material_name: string
          project_id: string
          required_by?: string | null
          required_quantity: number
          rule_id: string
          source_artifact_id?: string | null
          source_file_id: string
          source_group_key?: string | null
          source_sha256: string
          specification: string
          unit: string
        }
        Update: {
          allowance_rate?: number
          baseline_factor_id?: string | null
          created_at?: string
          created_by?: string
          design_quantity?: number
          id?: string
          material_code?: string
          material_name?: string
          project_id?: string
          required_by?: string | null
          required_quantity?: number
          rule_id?: string
          source_artifact_id?: string | null
          source_file_id?: string
          source_group_key?: string | null
          source_sha256?: string
          specification?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_material_plan_baseline_factor_fkey"
            columns: ["baseline_factor_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_carbon_factors"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "lukas_qto_material_plan_source_identity_fkey"
            columns: ["source_file_id", "project_id", "source_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
          {
            foreignKeyName: "lukas_qto_material_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lukas_qto_material_plans_source_artifact_fkey"
            columns: ["source_artifact_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_takeoff_artifacts"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      lukas_qto_material_transactions: {
        Row: {
          amount_krw: number | null
          carbon_factor_id: string | null
          created_at: string
          created_by: string
          document_number: string
          event_location: string
          evidence_file_id: string | null
          evidence_sha256: string | null
          id: string
          material_plan_id: string
          note: string
          occurred_on: string
          project_id: string
          quantity: number
          received_by_name: string
          related_order_id: string | null
          site_acknowledgement: boolean
          supplier_name: string
          transaction_type: string
          unit_price_krw: number | null
        }
        Insert: {
          amount_krw?: number | null
          carbon_factor_id?: string | null
          created_at?: string
          created_by: string
          document_number: string
          event_location?: string
          evidence_file_id?: string | null
          evidence_sha256?: string | null
          id?: string
          material_plan_id: string
          note?: string
          occurred_on: string
          project_id: string
          quantity: number
          received_by_name?: string
          related_order_id?: string | null
          site_acknowledgement?: boolean
          supplier_name: string
          transaction_type: string
          unit_price_krw?: number | null
        }
        Update: {
          amount_krw?: number | null
          carbon_factor_id?: string | null
          created_at?: string
          created_by?: string
          document_number?: string
          event_location?: string
          evidence_file_id?: string | null
          evidence_sha256?: string | null
          id?: string
          material_plan_id?: string
          note?: string
          occurred_on?: string
          project_id?: string
          quantity?: number
          received_by_name?: string
          related_order_id?: string | null
          site_acknowledgement?: boolean
          supplier_name?: string
          transaction_type?: string
          unit_price_krw?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_material_transaction_evidence_identity_fkey"
            columns: ["evidence_file_id", "project_id", "evidence_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
          {
            foreignKeyName: "lukas_qto_material_transaction_factor_fkey"
            columns: ["carbon_factor_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_carbon_factors"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "lukas_qto_material_transaction_order_fkey"
            columns: ["related_order_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_material_transactions"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "lukas_qto_material_transaction_plan_fkey"
            columns: ["material_plan_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_material_plans"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "lukas_qto_material_transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lukas_qto_organization_members: {
        Row: {
          created_at: string
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lukas_qto_organizations: {
        Row: {
          created_at: string
          id: string
          is_personal: boolean
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_personal?: boolean
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_personal?: boolean
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      lukas_qto_preflight_approvals: {
        Row: {
          artifact_id: string
          created_at: string
          decided_by: string
          decision: string
          id: string
          note: string
        }
        Insert: {
          artifact_id: string
          created_at?: string
          decided_by: string
          decision: string
          id?: string
          note?: string
        }
        Update: {
          artifact_id?: string
          created_at?: string
          decided_by?: string
          decision?: string
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_preflight_approvals_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_preflight_artifacts"
            referencedColumns: ["id"]
          },
        ]
      }
      lukas_qto_preflight_artifacts: {
        Row: {
          created_at: string
          created_by: string
          format_version: string
          id: string
          krw_tolerance: string
          manifest_file_id: string
          manifest_sha256: string
          project_id: string
          quantity_tolerance: string
          report_file_id: string
          report_sha256: string
          row_count: number
          ruleset_version: string
          scope_id: string
          status_counts: Json
        }
        Insert: {
          created_at?: string
          created_by: string
          format_version: string
          id?: string
          krw_tolerance: string
          manifest_file_id: string
          manifest_sha256: string
          project_id: string
          quantity_tolerance: string
          report_file_id: string
          report_sha256: string
          row_count: number
          ruleset_version: string
          scope_id: string
          status_counts: Json
        }
        Update: {
          created_at?: string
          created_by?: string
          format_version?: string
          id?: string
          krw_tolerance?: string
          manifest_file_id?: string
          manifest_sha256?: string
          project_id?: string
          quantity_tolerance?: string
          report_file_id?: string
          report_sha256?: string
          row_count?: number
          ruleset_version?: string
          scope_id?: string
          status_counts?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_preflight_artifacts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lukas_qto_preflight_manifest_identity_fkey"
            columns: ["manifest_file_id", "project_id", "manifest_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
          {
            foreignKeyName: "lukas_qto_preflight_report_identity_fkey"
            columns: ["report_file_id", "project_id", "report_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
        ]
      }
      lukas_qto_preflight_inputs: {
        Row: {
          artifact_id: string
          file_id: string
          id: string
          input_role: string
          project_id: string
          source_id: string
          source_sha256: string
        }
        Insert: {
          artifact_id: string
          file_id: string
          id?: string
          input_role: string
          project_id: string
          source_id: string
          source_sha256: string
        }
        Update: {
          artifact_id?: string
          file_id?: string
          id?: string
          input_role?: string
          project_id?: string
          source_id?: string
          source_sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_preflight_inputs_artifact_fkey"
            columns: ["artifact_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_preflight_artifacts"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "lukas_qto_preflight_inputs_file_identity_fkey"
            columns: ["file_id", "project_id", "source_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
        ]
      }
      lukas_qto_price_books: {
        Row: {
          created_at: string
          created_by: string
          currency: string
          effective_date: string
          id: string
          license_note: string
          name: string
          project_id: string
          rights_basis: string
          source_file_id: string
          source_sha256: string
          version_label: string
        }
        Insert: {
          created_at?: string
          created_by: string
          currency?: string
          effective_date: string
          id?: string
          license_note: string
          name: string
          project_id: string
          rights_basis: string
          source_file_id: string
          source_sha256: string
          version_label: string
        }
        Update: {
          created_at?: string
          created_by?: string
          currency?: string
          effective_date?: string
          id?: string
          license_note?: string
          name?: string
          project_id?: string
          rights_basis?: string
          source_file_id?: string
          source_sha256?: string
          version_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_price_books_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lukas_qto_price_books_source_identity_fkey"
            columns: ["source_file_id", "project_id", "source_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
        ]
      }
      lukas_qto_price_resources: {
        Row: {
          created_at: string
          created_by: string
          id: string
          price_book_id: string
          project_id: string
          resource_code: string
          resource_name: string
          resource_type: string
          specification: string
          unit: string
          unit_price_krw: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          price_book_id: string
          project_id: string
          resource_code: string
          resource_name: string
          resource_type: string
          specification?: string
          unit: string
          unit_price_krw: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          price_book_id?: string
          project_id?: string
          resource_code?: string
          resource_name?: string
          resource_type?: string
          specification?: string
          unit?: string
          unit_price_krw?: number
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_price_resources_book_fkey"
            columns: ["price_book_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_price_books"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "lukas_qto_price_resources_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lukas_qto_project_members: {
        Row: {
          created_at: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          project_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lukas_qto_projects: {
        Row: {
          contact_name: string
          contact_phone: string
          created_at: string
          description: string
          id: string
          name: string
          organization_id: string
          owner_id: string
          updated_at: string
          workflow_status: string
        }
        Insert: {
          contact_name?: string
          contact_phone?: string
          created_at?: string
          description?: string
          id?: string
          name: string
          organization_id: string
          owner_id: string
          updated_at?: string
          workflow_status?: string
        }
        Update: {
          contact_name?: string
          contact_phone?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          organization_id?: string
          owner_id?: string
          updated_at?: string
          workflow_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lukas_qto_reviews: {
        Row: {
          author_id: string | null
          created_at: string
          file_id: string | null
          id: string
          note: string
          project_id: string
          status: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          created_at?: string
          file_id?: string | null
          id?: string
          note?: string
          project_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          created_at?: string
          file_id?: string | null
          id?: string
          note?: string
          project_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_reviews_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lukas_qto_reviews_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lukas_qto_shares: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          permission: string
          project_id: string
          token: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          permission: string
          project_id: string
          token?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          permission?: string
          project_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_shares_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      lukas_qto_suggestion_decisions: {
        Row: {
          created_at: string
          decided_by: string
          decision: string
          decision_sequence: number
          id: string
          note: string
          suggestion_id: string
        }
        Insert: {
          created_at?: string
          decided_by: string
          decision: string
          decision_sequence?: never
          id?: string
          note?: string
          suggestion_id: string
        }
        Update: {
          created_at?: string
          decided_by?: string
          decision?: string
          decision_sequence?: never
          id?: string
          note?: string
          suggestion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_suggestion_decisions_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      lukas_qto_suggestions: {
        Row: {
          batch_id: string
          confidence: number | null
          created_at: string
          created_by: string
          detail: string
          evidence: Json
          file_id: string
          id: string
          payload_file_id: string | null
          payload_sha256: string | null
          producer_kind: string
          producer_version: string
          project_id: string
          source_sha256: string
          subject_key: string
          suggestion_kind: string
          title: string
        }
        Insert: {
          batch_id: string
          confidence?: number | null
          created_at?: string
          created_by: string
          detail: string
          evidence?: Json
          file_id: string
          id?: string
          payload_file_id?: string | null
          payload_sha256?: string | null
          producer_kind: string
          producer_version: string
          project_id: string
          source_sha256: string
          subject_key: string
          suggestion_kind: string
          title: string
        }
        Update: {
          batch_id?: string
          confidence?: number | null
          created_at?: string
          created_by?: string
          detail?: string
          evidence?: Json
          file_id?: string
          id?: string
          payload_file_id?: string | null
          payload_sha256?: string | null
          producer_kind?: string
          producer_version?: string
          project_id?: string
          source_sha256?: string
          subject_key?: string
          suggestion_kind?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_suggestions_payload_identity_fkey"
            columns: ["payload_file_id", "project_id", "payload_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
          {
            foreignKeyName: "lukas_qto_suggestions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lukas_qto_suggestions_source_identity_fkey"
            columns: ["file_id", "project_id", "source_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
        ]
      }
      lukas_qto_takeoff_approvals: {
        Row: {
          artifact_id: string
          created_at: string
          decided_by: string
          decision: string
          decision_sequence: number
          id: string
          note: string
        }
        Insert: {
          artifact_id: string
          created_at?: string
          decided_by: string
          decision: string
          decision_sequence?: never
          id?: string
          note?: string
        }
        Update: {
          artifact_id?: string
          created_at?: string
          decided_by?: string
          decision?: string
          decision_sequence?: never
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_takeoff_approvals_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_takeoff_artifacts"
            referencedColumns: ["id"]
          },
        ]
      }
      lukas_qto_takeoff_artifacts: {
        Row: {
          artifact_kind: string
          created_at: string
          created_by: string
          format_version: string
          id: string
          input_sha256: Json
          manifest_file_id: string
          manifest_sha256: string
          project_id: string
          report_file_id: string
          report_sha256: string
          row_count: number
          status_counts: Json
        }
        Insert: {
          artifact_kind: string
          created_at?: string
          created_by: string
          format_version: string
          id?: string
          input_sha256: Json
          manifest_file_id: string
          manifest_sha256: string
          project_id: string
          report_file_id: string
          report_sha256: string
          row_count: number
          status_counts: Json
        }
        Update: {
          artifact_kind?: string
          created_at?: string
          created_by?: string
          format_version?: string
          id?: string
          input_sha256?: Json
          manifest_file_id?: string
          manifest_sha256?: string
          project_id?: string
          report_file_id?: string
          report_sha256?: string
          row_count?: number
          status_counts?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_takeoff_artifacts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lukas_qto_takeoff_manifest_identity_fkey"
            columns: ["manifest_file_id", "project_id", "manifest_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
          {
            foreignKeyName: "lukas_qto_takeoff_report_identity_fkey"
            columns: ["report_file_id", "project_id", "report_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
        ]
      }
      lukas_qto_takeoff_inputs: {
        Row: {
          artifact_id: string
          file_id: string
          id: string
          input_role: string
          project_id: string
          source_sha256: string
        }
        Insert: {
          artifact_id: string
          file_id: string
          id?: string
          input_role: string
          project_id: string
          source_sha256: string
        }
        Update: {
          artifact_id?: string
          file_id?: string
          id?: string
          input_role?: string
          project_id?: string
          source_sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "lukas_qto_takeoff_inputs_artifact_fkey"
            columns: ["artifact_id", "project_id"]
            isOneToOne: false
            referencedRelation: "lukas_qto_takeoff_artifacts"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "lukas_qto_takeoff_inputs_file_identity_fkey"
            columns: ["file_id", "project_id", "source_sha256"]
            isOneToOne: false
            referencedRelation: "lukas_qto_files"
            referencedColumns: ["id", "project_id", "sha256"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      lukas_drawing_relink_issue_anchor: {
        Args: {
          p_previous_anchor_id: string
          p_new_anchor_id: string
          p_current_file_id: string
          p_anchor: Json
          p_note: string
        }
        Returns: Json
      }
      lukas_qto_decide_boq: {
        Args: { p_decision: string; p_note?: string; p_version_id: string }
        Returns: undefined
      }
      lukas_qto_import_boq_structure: {
        Args: { p_payload: Json; p_version_id: string }
        Returns: undefined
      }
      lukas_qto_shared_project: {
        Args: { p_token: string }
        Returns: {
          expires_at: string
          permission: string
          project_id: string
          project_name: string
        }[]
      }
      lukas_qto_submit_share_review: {
        Args: {
          p_file_id?: string
          p_note: string
          p_status: string
          p_token: string
        }
        Returns: string
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
