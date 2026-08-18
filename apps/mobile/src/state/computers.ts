import { createComputerEnvironmentAtoms } from "@t3tools/client-runtime/state/computers";

import { connectionAtomRuntime } from "../connection/runtime";

export const computerEnvironment = createComputerEnvironmentAtoms(connectionAtomRuntime);
