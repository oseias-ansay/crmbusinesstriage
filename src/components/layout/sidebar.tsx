"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, Briefcase, Building2, CalendarCheck, KanbanSquare, MessagesSquare, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3, module: "reports" },
  { href: "/pipeline", label: "Funil", icon: KanbanSquare, module: "pipeline" },
  { href: "/inbox", label: "Inbox", icon: MessagesSquare, module: "inbox" },
  { href: "/contacts", label: "Contatos", icon: Users, module: "contacts" },
  { href: "/clients", label: "Clientes", icon: Briefcase, module: "pipeline" },
  { href: "/tasks", label: "Tarefas", icon: CalendarCheck, module: "tasks" },
  { href: "/automations", label: "Automações", icon: Bot, module: "automations" },
];

export function Sidebar({ tenant, isSuperAdmin, canManage }: { tenant: { name: string; logoUrl: string | null; modules: string[] }; isSuperAdmin: boolean; canManage: boolean }) {
  const path = usePathname();
  const item = (href: string, label: string, Icon: typeof Users) => (
    <Link
      key={href}
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        path.startsWith(href) ? "bg-white/15 font-medium text-white" : "text-white/70 hover:bg-white/10 hover:text-white",
      )}
    >
      <Icon size={18} />
      <span className="hidden lg:inline">{label}</span>
    </Link>
  );

  return (
    <aside className="flex w-16 shrink-0 flex-col bg-primary p-3 lg:w-60">
      <div className="mb-6 flex min-h-10 items-center px-1">
        {tenant.logoUrl ? (
          <img src={tenant.logoUrl} alt={tenant.name} className="h-auto max-h-14 w-full object-contain object-left" />
        ) : (
          <span className="truncate text-lg font-bold text-white">{tenant.name}</span>
        )}
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {NAV.filter((n) => tenant.modules.includes(n.module) || (n.module === "automations" && tenant.modules.includes("bots"))).map((n) => item(n.href, n.label, n.icon))}
      </nav>
      <div className="flex flex-col gap-1 border-t border-white/10 pt-3">
        {canManage && item("/settings", "Configurações", Settings)}
        {isSuperAdmin && item("/admin/tenants", "Admin Global", Building2)}
      </div>
    </aside>
  );
}
