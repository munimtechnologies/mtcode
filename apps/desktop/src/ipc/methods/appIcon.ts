import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { applyAppIcon } from "../../appIcon/appIcon.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const setAppIcon = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_APP_ICON_CHANNEL,
  payload: Schema.Struct({
    id: Schema.String,
    image: Schema.optional(Schema.String),
  }),
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.appIcon.setAppIcon")(function* (input) {
    return applyAppIcon({
      id: input.id,
      ...(input.image === undefined ? {} : { image: input.image }),
    });
  }),
});
