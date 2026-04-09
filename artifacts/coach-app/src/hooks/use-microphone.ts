import { useCallback, useRef, useState } from "react";

export type MicPermission = "idle" | "requesting" | "granted" | "denied" | "unavailable";

export function useMicrophone() {
  const [permission, setPermission] = useState<MicPermission>("idle");
  const requestingRef = useRef(false);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermission("unavailable");
      return false;
    }
    if (requestingRef.current) return false;
    requestingRef.current = true;
    setPermission("requesting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      s.getTracks().forEach(t => t.stop());
      setPermission("granted");
      return true;
    } catch {
      setPermission("denied");
      return false;
    } finally {
      requestingRef.current = false;
    }
  }, []);

  const openStream = useCallback(async (): Promise<MediaStream | null> => {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      setPermission("granted");
      return s;
    } catch {
      setPermission("denied");
      return null;
    }
  }, []);

  return { permission, requestPermission, openStream };
}
