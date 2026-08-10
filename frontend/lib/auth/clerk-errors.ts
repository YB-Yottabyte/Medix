export function clerkErrorMessage(
  error: unknown,
  fallback = "Authentication could not be completed."
) {
  if (!error || typeof error !== "object") {
    return fallback;
  }

  const value = error as {
    message?: string;
    longMessage?: string;
    errors?: Array<{ longMessage?: string; message?: string }>;
  };
  return (
    value.errors?.[0]?.longMessage ??
    value.errors?.[0]?.message ??
    value.longMessage ??
    value.message ??
    fallback
  );
}
