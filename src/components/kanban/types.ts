export type KanbanDeal = {
  id: string;
  title: string;
  value: string;
  recurring: boolean;
  status: "OPEN" | "WON" | "LOST";
  stageId: string;
  position: number;
  stageEnteredAt: string;
  expectedCloseAt: string | null;
  createdAt: string;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  userId: string | null;
  userName: string | null;
  userAvatar: string | null;
  overdueTasks: number;
  openTasks: number;
  tags: { name: string; color: string }[];
};

export type StageDef = { id: string; name: string; color: string; order: number; probability: number; rottingDays: number | null; isWon: boolean; isLost: boolean };
export type PipelineDef = { id: string; name: string; isDefault: boolean; stages: StageDef[] };
export type TeamUser = { id: string; name: string; avatarUrl: string | null; role: string };
