import { Contact360 } from "@/components/contacts/contact-360";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Contact360 id={id} />;
}
