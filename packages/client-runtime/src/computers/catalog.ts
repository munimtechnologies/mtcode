import type {
  ComputerKind,
  ComputerPeer,
  ExecutionEnvironmentPlatformOs,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { SshConnectionProfile, type ConnectionCatalogEntry } from "../connection/catalog.ts";
import type { EnvironmentPresentation } from "../connection/presentation.ts";

const isSshConnectionProfile = Schema.is(SshConnectionProfile);

function kindOf(entry: ConnectionCatalogEntry): ComputerKind {
  switch (entry.target._tag) {
    case "PrimaryConnectionTarget":
      return "local";
    case "SshConnectionTarget":
      return "ssh";
    case "RelayConnectionTarget":
      return "connect";
    case "BearerConnectionTarget":
      return "paired";
  }
}

function sshTargetOf(entry: ConnectionCatalogEntry): string | undefined {
  const profile = Option.getOrUndefined(entry.profile);
  if (!profile || !isSshConnectionProfile(profile)) return undefined;
  const username = profile.target.username?.trim();
  const host = profile.target.alias || profile.target.hostname;
  return username && username.length > 0 ? `${username}@${host}` : host;
}

export function computerPeerFromPresentation(presentation: EnvironmentPresentation): ComputerPeer {
  const descriptor = presentation.serverConfig?.environment;
  const os: ExecutionEnvironmentPlatformOs = descriptor?.platform.os ?? "unknown";
  const sshTarget = sshTargetOf(presentation.entry);
  return {
    environmentId: presentation.entry.target.environmentId,
    label: descriptor?.label ?? presentation.entry.target.label,
    kind: kindOf(presentation.entry),
    os,
    connected: presentation.connection.phase === "connected",
    ...(sshTarget === undefined ? {} : { sshTarget }),
  };
}
