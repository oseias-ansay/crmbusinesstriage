ALTER TABLE "channel_connections" ADD COLUMN "routing" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "bot_flow_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "pipeline_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_bot_flow_id_bot_flows_id_fk" FOREIGN KEY ("bot_flow_id") REFERENCES "public"."bot_flows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD CONSTRAINT "knowledge_docs_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE set null ON UPDATE no action;