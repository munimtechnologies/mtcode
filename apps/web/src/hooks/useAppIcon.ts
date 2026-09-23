import { useEffect } from "react";

import { usePrimarySettings } from "./useSettings";
import { useSidebarStageBackdropVariant } from "../components/SidebarStageBackdrop";
import { isLocalSky, SKY_OPTIONS } from "../artwork/skyArtwork";
import {
  BLUEPRINT_ICON_BACKGROUND,
  renderArtworkAppIcon,
  renderSkyAppIcon,
} from "../artwork/appIconArtwork";

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
  const artworkMode =
    selection === "match-artwork" ||
    isLocalSky(selection) ||
    SKY_OPTIONS.some((option) => option.value === selection);
  const artwork = useSidebarStageBackdropVariant(
    true,
    selection === "match-artwork" ? undefined : artworkMode ? selection : "none",
  );
  const sky = artwork?.kind === "custom" ? artwork.sky : undefined;
  // The Nightly scene is the shipped tile itself, so it wears the shipped icon.
  // It is also where a local sky lands before it has a location or a forecast,
  // and redrawing it from the raw layers loses the tile's glass and shape.
  const background =
    artwork?.kind === "custom"
      ? artwork.image
      : artwork?.kind === "dev"
        ? BLUEPRINT_ICON_BACKGROUND
        : null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const setIcon = window.desktopBridge?.setAppIcon;
    if (setIcon === undefined) return;
    let cancelled = false;
    if (artworkMode) {
      if (background === null) {
        void setIcon({ id: "default" }).catch(() => undefined);
      } else {
        // A sky recolours the shipped tile; anything else is cropped artwork.
        void (sky ? renderSkyAppIcon(sky.phase, sky.weather) : renderArtworkAppIcon(background))
          .then((image) => {
            if (!cancelled) return setIcon({ id: "artwork", image });
          })
          .catch(() => {
            if (!cancelled) void setIcon({ id: "default" }).catch(() => undefined);
          });
      }
      return () => {
        cancelled = true;
      };
    }
    const own = custom.find((icon) => icon.id === selection);
    void setIcon(own ? { id: own.id, image: own.image } : { id: selection }).catch(() => undefined);
  }, [custom, selection, artworkMode, background, sky]);
}
