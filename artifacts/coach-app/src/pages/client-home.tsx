import ClientArea from "./client-area";
import { useClientContext } from "@/contexts/client-context";

export default function ClientHome() {
  const { client } = useClientContext();
  if (!client) return null;
  return <ClientArea clientIdOverride={client.id} mode="client" />;
}
