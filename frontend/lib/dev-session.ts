import { auth as clerkAuth, clerkClient } from "@clerk/nextjs/server";
import { auth } from "@/app/(auth)/auth";
import { isClerkConfigured } from "./auth/config";
import type { AppSession } from "./auth/types";
import { isLocalAuthBypassed } from "./constants";
import { createUser, getOrCreateClerkUser, getUser } from "./db/queries";

const LOCAL_USER_EMAIL = "local@medix.dev";

function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  );
}

/**
 * Return the authenticated session, with an explicit opt-in bypass for local
 * development. Production can never use the bypass.
 */
export async function getAppSession(): Promise<AppSession | null> {
  if (!isLocalAuthBypassed && isClerkConfigured()) {
    const { userId } = await clerkAuth();

    if (userId) {
      const client = await clerkClient();
      let clerkUser: Awaited<ReturnType<typeof client.users.getUser>>;
      try {
        clerkUser = await client.users.getUser(userId);
      } catch (error) {
        // Clerk can expose the deleted session cookie for one final request
        // while client-side sign-out completes. Treat only that 404 as a
        // signed-out state; surface every other Clerk failure normally.
        if (isNotFoundError(error)) {
          return null;
        }
        throw error;
      }
      const email = clerkUser.primaryEmailAddress?.emailAddress;

      if (!email) {
        throw new Error("Clerk user is missing a primary email address");
      }

      const medixUser = await getOrCreateClerkUser({
        clerkUserId: userId,
        email,
        image: clerkUser.imageUrl,
        name:
          typeof clerkUser.unsafeMetadata.medixDisplayName === "string"
            ? clerkUser.unsafeMetadata.medixDisplayName
            : clerkUser.fullName,
      });

      return {
        user: {
          email: medixUser.email,
          id: medixUser.id,
          image: medixUser.image,
          name: medixUser.name,
          type: "regular",
        },
      };
    }

    // Registered users are handled by Clerk; Auth.js remains only as the
    // existing anonymous-chat session so logged-out functionality is intact.
    const guestSession = await auth();
    return guestSession?.user?.type === "guest"
      ? {
          user: {
            email: guestSession.user.email ?? null,
            id: guestSession.user.id,
            image: guestSession.user.image ?? null,
            name: guestSession.user.name ?? null,
            type: guestSession.user.type,
          },
        }
      : null;
  }

  if (!isLocalAuthBypassed) {
    const session = await auth();
    return session?.user
      ? {
          user: {
            email: session.user.email ?? null,
            id: session.user.id,
            image: session.user.image ?? null,
            name: session.user.name ?? null,
            type: session.user.type,
          },
        }
      : null;
  }

  let [localUser] = await getUser(LOCAL_USER_EMAIL);
  if (!localUser) {
    await createUser(LOCAL_USER_EMAIL, crypto.randomUUID());
    [localUser] = await getUser(LOCAL_USER_EMAIL);
  }

  if (!localUser) {
    throw new Error("Could not create the local development user");
  }

  return {
    user: {
      email: localUser.email,
      id: localUser.id,
      name: localUser.name ?? "Local Developer",
      type: "regular",
    },
  };
}
