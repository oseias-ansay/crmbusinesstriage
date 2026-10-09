CREATE TABLE "ai_usage" (
	"tenant_id" uuid NOT NULL,
	"day" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_tenant_id_day_pk" PRIMARY KEY("tenant_id","day")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"deal_id" uuid,
	"status" text DEFAULT 'ONBOARDING' NOT NULL,
	"razao_social" text NOT NULL,
	"nome_fantasia" text,
	"cnpj" text,
	"inscricao_estadual" text,
	"endereco" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"representante" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"email_financeiro" text,
	"telefone" text,
	"servico" text,
	"valor" numeric(14, 2) DEFAULT '0' NOT NULL,
	"recorrente" boolean DEFAULT true NOT NULL,
	"forma_pagamento" text,
	"dia_vencimento" integer,
	"inicio_em" timestamp with time zone,
	"vigencia_meses" integer,
	"indice_reajuste" text,
	"observacoes" text,
	"extras" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"responsavel_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"template_id" uuid,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"file_path" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by_id" uuid,
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversion_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid,
	"contact_id" uuid,
	"event_name" text NOT NULL,
	"event_time" timestamp with time zone DEFAULT now() NOT NULL,
	"value" numeric(14, 2),
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"payload" jsonb,
	"response" jsonb,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "attribution" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "ai_auto_move" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "auto_message" text;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "auto_message_delay_min" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "ai_criteria" text;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN "meta_event" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_responsavel_id_users_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_id_contract_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."contract_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_tenant_id_status_index" ON "clients" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_deal_id_index" ON "clients" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "contract_templates_tenant_id_index" ON "contract_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "contracts_tenant_id_client_id_index" ON "contracts" USING btree ("tenant_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversion_events_deal_id_event_name_index" ON "conversion_events" USING btree ("deal_id","event_name");--> statement-breakpoint
CREATE INDEX "conversion_events_tenant_id_status_created_at_index" ON "conversion_events" USING btree ("tenant_id","status","created_at");