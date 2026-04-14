import { useState } from "react";
import ClientArea from "./client-area";
import { useClientContext } from "@/contexts/client-context";
import { OnboardingFlow } from "@/components/onboarding-flow";

export default function ClientHome() {
  const { client } = useClientContext();
  const [onboardingDone, setOnboardingDone] = useState(false);

  if (!client) return null;

  const skipKey = `onboarding_skip_${client.id}`;
  const skipped = localStorage.getItem(skipKey) === "1";
  const needsOnboarding =
    !onboardingDone &&
    !skipped &&
    !(client as any).onboardingCompleted;

  if (needsOnboarding) {
    return (
      <OnboardingFlow
        clientId={client.id}
        clientName={client.name ?? ""}
        onComplete={() => setOnboardingDone(true)}
      />
    );
  }

  return <ClientArea clientIdOverride={client.id} mode="client" />;
}
