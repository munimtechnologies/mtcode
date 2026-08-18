import { useState } from "react";

import { APP_DISPLAY_NAME } from "../branding";

export function SplashScreen() {
  const [wordmarkFailed, setWordmarkFailed] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="flex items-center justify-center"
        aria-label={`${APP_DISPLAY_NAME} splash screen`}
      >
        {wordmarkFailed ? (
          <img alt="" className="size-16 object-contain" src="/apple-touch-icon.png" />
        ) : (
          <img
            alt=""
            className="h-auto w-[min(32.5rem,52vw)] object-contain dark:invert"
            src="/boot-wordmark.png"
            onError={() => setWordmarkFailed(true)}
          />
        )}
      </div>
    </div>
  );
}
