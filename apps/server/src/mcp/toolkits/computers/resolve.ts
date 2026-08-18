import type { ComputerListEntry } from "@t3tools/contracts";
import { ComputerTaskError } from "@t3tools/contracts";

const THIS_ALIASES = new Set(["this", "here", "this machine", "this computer", "local"]);

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveComputer(
  query: string,
  computers: ReadonlyArray<ComputerListEntry>,
): ComputerListEntry | ComputerTaskError {
  const needle = normalize(query);
  if (needle.length === 0) {
    return new ComputerTaskError({
      code: "computer_not_found",
      detail: "Pass a computer id, label, SSH host, or 'this'.",
    });
  }

  const thisMachine = computers.find((computer) => computer.thisMachine);
  if (THIS_ALIASES.has(needle) && thisMachine) return thisMachine;

  const exactId = computers.find((computer) => computer.environmentId === query.trim());
  if (exactId) return exactId;

  const exactLabel = computers.filter((computer) => normalize(computer.label) === needle);
  if (exactLabel.length === 1) return exactLabel[0]!;
  if (exactLabel.length > 1) {
    return new ComputerTaskError({
      code: "computer_not_found",
      detail: `Multiple computers are named '${query}'. Use an environment id from computer_list.`,
    });
  }

  const sshMatches = computers.filter((computer) => {
    const ssh = computer.sshTarget;
    return ssh !== undefined && (normalize(ssh) === needle || ssh.toLowerCase().includes(needle));
  });
  if (sshMatches.length === 1) return sshMatches[0]!;

  const prefix = computers.filter(
    (computer) =>
      normalize(computer.label).startsWith(needle) ||
      computer.environmentId.toLowerCase().startsWith(needle),
  );
  if (prefix.length === 1) return prefix[0]!;

  const available = computers
    .map(
      (computer) =>
        `${computer.label} (${computer.kind}${computer.connected ? "" : ", offline"}${computer.thisMachine ? ", this machine" : ""})`,
    )
    .join("; ");
  return new ComputerTaskError({
    code: "computer_not_found",
    detail: `No computer matches '${query}'. Available: ${available || "only this machine"}.`,
  });
}
