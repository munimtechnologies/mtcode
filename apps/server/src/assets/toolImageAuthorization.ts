import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import { Predicate } from "effect";

const IMAGE_PATH_KEYS = new Set(["path", "filePath", "file_path", "relativePath", "filename"]);

export function activityPayloadContainsImagePath(
  payload: unknown,
  requestedPath: string,
  depth = 0,
): boolean {
  if (depth > 6 || !isWorkspaceImagePreviewPath(requestedPath)) {
    return false;
  }
  if (Array.isArray(payload)) {
    return payload.some((value) =>
      activityPayloadContainsImagePath(value, requestedPath, depth + 1),
    );
  }
  if (!Predicate.isObject(payload)) {
    return false;
  }
  for (const [key, value] of Object.entries(payload)) {
    if (IMAGE_PATH_KEYS.has(key) && value === requestedPath) {
      return true;
    }
    if (activityPayloadContainsImagePath(value, requestedPath, depth + 1)) {
      return true;
    }
  }
  return false;
}
