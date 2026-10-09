import { ClientFicha } from "@/components/clients/client-ficha";
export const metadata = { title: "Cliente" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientFicha id={id} />;
}
