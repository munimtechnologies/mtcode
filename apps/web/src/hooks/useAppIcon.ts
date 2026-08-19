import { useEffect } from "react";

import { usePrimarySettings } from "./useSettings";

/**
 * Keeps the running app's icon in step with the account's choice.
 *
 * The installed bundle keeps its own icon on disk — rewriting that would break
 * the code signature, and with it every macOS permission grant — so the pick is
 * applied to the live Dock tile (or window icon off macOS) on load and on every
 * change. Browsers have no local API and simply skip this.
 */
export function useAppIcon(): void {
  const { selection, custom } = usePrimarySettings((settings) => ({
    selection: settings.appIcon,
    custom: settings.customAppIcons,
  }));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const setIcon = window.desktopBridge?.setAppIcon;
    if (setIcon === undefined) return;
    const own = custom.find((icon) => icon.id === selection);
    void setIcon(own ? { id: own.id, image: own.image } : { id: selection }).catch(
      () => undefined,
    );
  }, [custom, selection]);
}
