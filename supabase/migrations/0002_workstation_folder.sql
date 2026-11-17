ALTER TABLE "projects" ADD COLUMN "workstation_folder" text;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workstation_folder_uq" ON "projects" USING btree ("workstation_folder");