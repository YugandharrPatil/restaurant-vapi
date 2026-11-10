import { useUser } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { app } from "@/lib/eden";

export type UserRole = "admin" | "user" | null;

/**
 * Extracts the user's role from publicMetadata (or falls back to 'user' for authenticated non-admins).
 */
export function getUserRole(
  user: ReturnType<typeof useUser>["user"],
): UserRole {
  if (!user) return null;
  const publicRole = user.publicMetadata?.role as string | undefined;
  if (publicRole === "admin") return "admin";
  if (publicRole === "user") return "user";
  // If authenticated but no publicMetadata is set yet, default role is 'user'
  return "user";
}

/**
 * Hook to manage user role and automatically sync the 'user' role on signup
 */
export function useUserRole() {
  const { user, isLoaded, isSignedIn } = useUser();
  const [isSyncing, setIsSyncing] = useState(false);
  const syncAttempted = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;

    const rawRole = user.publicMetadata?.role as string | undefined;

    // If role already explicitly assigned in publicMetadata, no sync needed
    if (rawRole === "admin" || rawRole === "user") {
      return;
    }

    // Avoid multiple simultaneous calls for the same user id
    if (syncAttempted.current === user.id) {
      return;
    }

    syncAttempted.current = user.id;
    setIsSyncing(true);

    // Call backend to persist public_metadata: { role: 'user' } in Clerk
    app.api.auth["set-user-role"]
      .post({ userId: user.id })
      .then(async ({ data, error }) => {
        if (!error && data && "success" in data && data.success) {
          // Reload user session to fetch updated publicMetadata
          await user.reload();
        }
      })
      .catch((err) => {
        console.warn("[useUserRole] Failed to sync user role:", err);
      })
      .finally(() => {
        setIsSyncing(false);
      });
  }, [isLoaded, isSignedIn, user]);

  const role = getUserRole(user);
  const isAdmin = role === "admin";
  const isUser = isSignedIn && !isAdmin;

  return {
    isLoaded,
    isSignedIn,
    user,
    role,
    isAdmin,
    isUser,
    isSyncing,
  };
}
