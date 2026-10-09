import { z } from "zod";
export const stageFields = z.object({
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#94A3B8"),
  probability: z.coerce.number().int().min(0).max(100).default(0),
  rottingDays: z.coerce.number().int().min(1).max(365).nullish(),
  isWon: z.boolean().default(false),
  isLost: z.boolean().default(false),
  // Jornada automática
  autoMessage: z.string().max(2000).nullish(),
  autoMessageDelayMin: z.coerce.number().int().min(0).max(10080).default(0),
  aiCriteria: z.string().max(500).nullish(),
  metaEvent: z.string().max(40).regex(/^[A-Za-z]+$/).nullish().or(z.literal("").transform(() => null)),
});
