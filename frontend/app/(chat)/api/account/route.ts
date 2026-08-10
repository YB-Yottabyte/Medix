import { auth as clerkAuth, clerkClient } from "@clerk/nextjs/server";
import { isClerkConfigured } from "@/lib/auth/config";
import { deleteUserAccount } from "@/lib/db/queries";
import { getAppSession } from "@/lib/dev-session";
import { ChatbotError } from "@/lib/errors";

export async function DELETE() {
  if (!isClerkConfigured()) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const { userId: clerkUserId } = await clerkAuth();
  const session = await getAppSession();

  if (!clerkUserId || !session?.user || session.user.type !== "regular") {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  try {
    const client = await clerkClient();
    await client.users.deleteUser(clerkUserId);
    await deleteUserAccount({ userId: session.user.id });
    return Response.json({ deleted: true });
  } catch (_error) {
    return new ChatbotError(
      "bad_request:api",
      "Account could not be deleted"
    ).toResponse();
  }
}
