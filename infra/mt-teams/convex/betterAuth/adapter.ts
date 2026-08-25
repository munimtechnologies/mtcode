import { createApi } from "@convex-dev/better-auth";

import { options } from "./authOptions";
import schema from "./schema";

export const { create, findOne, findMany, updateOne, updateMany, deleteOne, deleteMany } =
  createApi(schema, () => options);
