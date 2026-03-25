import { createContext, useContext, useState, ReactNode } from "react";
import type { Client } from "@workspace/api-client-react";

const STORAGE_KEY = "coach_ai_selected_client";

interface ClientContextValue {
  client: Client | null;
  selectClient: (c: Client) => void;
  clearClient: () => void;
}

const ClientContext = createContext<ClientContextValue>({
  client: null,
  selectClient: () => {},
  clearClient: () => {},
});

export function ClientProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<Client | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Client) : null;
    } catch {
      return null;
    }
  });

  const selectClient = (c: Client) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    setClient(c);
  };

  const clearClient = () => {
    localStorage.removeItem(STORAGE_KEY);
    setClient(null);
  };

  return (
    <ClientContext.Provider value={{ client, selectClient, clearClient }}>
      {children}
    </ClientContext.Provider>
  );
}

export const useClientContext = () => useContext(ClientContext);
