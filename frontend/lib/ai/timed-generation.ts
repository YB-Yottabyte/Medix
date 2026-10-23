import { generateText } from "ai";
import { measureAsync } from "../performance";
/** Preserve SDK overloads while giving every generation/repair attempt its own span. */
export function timedText(stage: string): typeof generateText {
  return ((options) =>
    measureAsync(stage, () => generateText(options))) as typeof generateText;
}
