export function canSubmitSshPassword(input: {
  readonly password: string;
  readonly isResponding: boolean;
  readonly isExpired: boolean;
}): boolean {
  return input.password.length > 0 && !input.isResponding && !input.isExpired;
}
