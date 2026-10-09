/** GET — calendários em que a conta conectada pode criar eventos. */
import { ApiError, route } from "@/lib/api";
import { getGoogle, listCalendars } from "@/lib/google/calendar";

export const GET = route(async (_req, { auth }) => {
  const g = await getGoogle(auth.tenantId);
  if (!g) throw new ApiError(422, "Google Agenda não conectado");
  return listCalendars(auth.tenantId, g);
}, { minRole: "ADMIN" });
