/** Conservative current-turn escalation, including when a previous bundle was safe.
 * Mirrors the backend's emergency policy without requiring another retrieval.
 */
export function urgentTurnResponse(question: string): string | null {
  const text = question.toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ");
  if (
    /\b(?:not breathing|stopped breathing|won't wake(?: up)?|unconscious|severe bleeding|bleeding (?:will not|won't) stop|chest pain|overdose|choking)\b/.test(
      text
    )
  ) {
    return "This may be an emergency. Contact your local emergency services now and follow the dispatcher's instructions.";
  }
  return null;
}
