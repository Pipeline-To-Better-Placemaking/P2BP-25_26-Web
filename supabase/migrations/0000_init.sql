CREATE TABLE "project_members" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"authz_version" integer DEFAULT 0 NOT NULL,
	"notify_on_own_scan" boolean DEFAULT false NOT NULL,
	"notify_on_others_scan" boolean DEFAULT false NOT NULL,
	"notify_on_scheduled_scan" boolean DEFAULT false NOT NULL,
	"notify_on_system_toggle" boolean DEFAULT false NOT NULL,
	"notify_on_health_alert" boolean DEFAULT false NOT NULL,
	"email_pdf_on_system_off" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"description" text,
	"location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"token_hash" text NOT NULL,
	"created_at_utc" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at_utc" timestamp with time zone NOT NULL,
	"revoked_at_utc" timestamp with time zone,
	"replaced_by_token_id" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "role_definitions_global" (
	"name" text PRIMARY KEY NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_system" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_definitions_project" (
	"name" text PRIMARY KEY NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_system" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_global_roles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text,
	"password" text,
	"role" text,
	"email_alerts" boolean,
	"email_verified" boolean DEFAULT false NOT NULL,
	"email_verification_token" text,
	"password_reset_token" text,
	"password_reset_token_expiry" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_library" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"nickname" text NOT NULL,
	"dictionary" text NOT NULL,
	"units" text NOT NULL,
	"cols" integer,
	"rows" integer,
	"marker_id" integer,
	"square_size" double precision,
	"marker_size" double precision NOT NULL,
	"square_size_mm" double precision,
	"marker_size_mm" double precision NOT NULL,
	"preview_svg" text NOT NULL,
	"created_at_utc" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floorplan_library" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"nickname" text,
	"image_path" text,
	"image_content_type" text,
	"image_size_bytes" integer NOT NULL,
	"image_width" integer NOT NULL,
	"image_height" integer NOT NULL,
	"calibration" jsonb,
	"created_at_utc" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at_utc" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fusion_config" (
	"id" text PRIMARY KEY NOT NULL,
	"scheduled_hour_utc" integer NOT NULL,
	"scheduled_minute_utc" integer NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at_unix" double precision,
	"project_id" text
);
--> statement-breakpoint
CREATE TABLE "fusion_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text,
	"triggered_by" text,
	"from_date_unix" double precision,
	"to_date_unix" double precision,
	"started_at_unix" double precision,
	"completed_at_unix" double precision,
	"records_fused" integer,
	"error_message" text,
	"output_gcs_path" text,
	"project_id" text
);
--> statement-breakpoint
CREATE TABLE "scan_calibration_records" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"device_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"obj_url" text,
	"error" text,
	"is_uploaded_calibration_scan" boolean DEFAULT false NOT NULL,
	"is_combined_calibration_scan" boolean DEFAULT false NOT NULL,
	"original_file_name" text,
	"output_name" text,
	"scalar_mm_per_pixel" double precision,
	"source_scan_ids" text[],
	"combine_transforms" jsonb
);
--> statement-breakpoint
CREATE TABLE "visualizer_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"point_count" integer DEFAULT 0 NOT NULL,
	"points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mesh" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aruco_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"aruco_dict" text,
	"status" text NOT NULL,
	"cameras_checked_in" text[] DEFAULT '{}' NOT NULL,
	"cameras_total" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aruco_sightings" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"device_id" text,
	"camera_mac" text,
	"aruco_dict" text,
	"captured_at" text,
	"markers" jsonb,
	"local_homography_hash" text
);
--> statement-breakpoint
CREATE TABLE "camera_intrinsics" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text,
	"device_id" text,
	"camera_mac" text,
	"is_per_unit" boolean DEFAULT false NOT NULL,
	"camera_matrix_flat" jsonb,
	"distortion_coefficients" jsonb,
	"reprojection_error" double precision,
	"sightings_used" integer,
	"computed_at_unix" double precision
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"name" text,
	"config" jsonb,
	"health_report" jsonb,
	"api_key_hash" text
);
--> statement-breakpoint
CREATE TABLE "global_homographies" (
	"project_id" text PRIMARY KEY NOT NULL,
	"floorplan_id" text,
	"mm_per_fp_px" double precision NOT NULL,
	"origin_fp" jsonb,
	"floorplan_size" jsonb,
	"placements" jsonb,
	"locked_groups" jsonb,
	"saved_by_user_id" text,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intrinsics_sightings" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text,
	"device_id" text,
	"camera_mac" text,
	"is_per_unit" boolean DEFAULT false NOT NULL,
	"captured_at" text,
	"image_points" jsonb,
	"corner_ids" jsonb,
	"frame_size" jsonb,
	"rmse" double precision
);
--> statement-breakpoint
CREATE TABLE "local_homographies" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text,
	"camera_mac" text,
	"matrix_flat" jsonb,
	"frame_size" jsonb,
	"inliers" double precision,
	"rmse_board" double precision,
	"corners_used" integer,
	"markers_detected" integer,
	"aruco_dict" text,
	"squares_x" integer,
	"squares_y" integer,
	"square_length" double precision,
	"marker_length" double precision,
	"timestamp_unix" double precision,
	"snapshot_path" text,
	"camera_matrix_flat" jsonb,
	"distortion_coefficients" jsonb,
	"used_undistorted_image" boolean
);
--> statement-breakpoint
CREATE TABLE "locked_homographies" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text,
	"camera_mac" text,
	"matrix_flat" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "puzzle_pieces" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"device_id" text,
	"camera_mac" text,
	"local_homography_id" text,
	"local_homography_hash" text,
	"local_homography_matrix_flat" jsonb,
	"h_local_canvas_flat" jsonb,
	"source_frame_size" jsonb,
	"puzzle_piece_size" jsonb,
	"source_snapshot_path" text,
	"used_undistorted_image" boolean DEFAULT false NOT NULL,
	"undistort_mode" text,
	"bbox_trim_pct" double precision DEFAULT 0 NOT NULL,
	"homography_file" text,
	"puzzle_piece_path" text,
	"metadata_path" text,
	"generation_version" integer DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"start_date" text,
	"start_time" text,
	"frequency" text,
	"end_date" text,
	"end_time" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"last_run_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"device_id" text NOT NULL,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"obj_url" text,
	"error" text,
	"initiated_by_user_id" text,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_global_roles" ADD CONSTRAINT "user_global_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_homographies" ADD CONSTRAINT "global_homographies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puzzle_pieces" ADD CONSTRAINT "puzzle_pieces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_schedules" ADD CONSTRAINT "scan_schedules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_project_user_uq" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_members_user_id_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_token_hash_uq" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_email_verification_token_idx" ON "users" USING btree ("email_verification_token");--> statement-breakpoint
CREATE INDEX "board_library_user_idx" ON "board_library" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "floorplan_library_user_idx" ON "floorplan_library" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "fusion_runs_project_id_idx" ON "fusion_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "fusion_runs_status_idx" ON "fusion_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scan_calibration_records_proj_dev_idx" ON "scan_calibration_records" USING btree ("project_id","device_id");--> statement-breakpoint
CREATE INDEX "devices_project_id_idx" ON "devices" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "devices_api_key_hash_idx" ON "devices" USING btree ("api_key_hash");--> statement-breakpoint
CREATE INDEX "intrinsics_sightings_device_idx" ON "intrinsics_sightings" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "local_homographies_device_id_idx" ON "local_homographies" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "puzzle_pieces_project_id_idx" ON "puzzle_pieces" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "scan_schedules_project_id_idx" ON "scan_schedules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "scans_project_device_idx" ON "scans" USING btree ("project_id","device_id");