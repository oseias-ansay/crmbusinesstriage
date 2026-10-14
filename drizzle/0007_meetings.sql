CREATE TABLE "meeting_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"contact_id" uuid,
	"user_id" uuid,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text,
	"mime_type" text,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"duration_sec" integer,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"error" text,
	"transcript" text,
	"summary" jsonb,
	"tasks_created" integer DEFAULT 0 NOT NULL,
	"consent" boolean DEFAULT false NOT NULL,
	"retain_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_records" ADD CONSTRAINT "meeting_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_records" ADD CONSTRAINT "meeting_records_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_records" ADD CONSTRAINT "meeting_records_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_records" ADD CONSTRAINT "meeting_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_records_tenant_id_deal_id_created_at_index" ON "meeting_records" USING btree ("tenant_id","deal_id","created_at");--> statement-breakpoint
CREATE INDEX "meeting_records_status_index" ON "meeting_records" USING btree ("status");