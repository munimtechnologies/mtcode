import { createComputerViewEnvironmentAtoms } from "@t3tools/client-runtime/state/computerView";

import { connectionAtomRuntime } from "../connection/runtime";

export const computerViewEnvironment = createComputerViewEnvironmentAtoms(connectionAtomRuntime);
