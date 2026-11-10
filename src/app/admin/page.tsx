"use client";

import { UserButton, useClerk } from "@clerk/nextjs";
import {
  Loader2,
  ShieldAlert,
  ShieldCheck,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import AdminMenu from "@/components/AdminMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useUserRole } from "@/lib/auth";

export default function AdminDashboardPage() {
  const { isLoaded, isSignedIn, isAdmin, user } = useUserRole();
  const { signOut } = useClerk();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/admin/login");
    }
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <Loader2 className="size-8 text-primary animate-spin" />
        <span className="text-sm text-muted-foreground">
          Verifying administrator credentials...
        </span>
      </div>
    );
  }

  // Signed in but not an admin -> Access Denied
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <Card className="max-w-md w-full border-destructive/30 shadow-lg">
          <CardHeader className="text-center space-y-2">
            <div className="size-12 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
              <ShieldAlert className="size-6" />
            </div>
            <CardTitle className="text-xl font-bold">Access Denied</CardTitle>
            <CardDescription>
              Your account (
              <span className="font-semibold text-foreground">
                {user?.primaryEmailAddress?.emailAddress}
              </span>
              ) does not have administrator privileges.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground text-center space-y-2">
            <p>
              To access the Admin Portal, sign in with an account having{" "}
              <code className="px-1.5 py-0.5 rounded bg-muted text-foreground">
                role: &quot;admin&quot;
              </code>{" "}
              in public metadata.
            </p>
          </CardContent>
          <CardFooter className="flex flex-col gap-2 pt-2">
            <Link href="/customer" className="w-full">
              <Button className="w-full gap-2">
                <UtensilsCrossed className="size-4" />
                Go to Customer Ordering
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => signOut()}
              className="w-full text-xs"
            >
              Sign Out & Switch Account
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Admin Top Navigation */}
      <header className="border-b bg-card/70 backdrop-blur-sm sticky top-0 z-20">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <div className="size-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary cursor-pointer hover:bg-primary/20 transition">
                <UtensilsCrossed className="size-4" />
              </div>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base leading-tight">
                  Admin Portal
                </span>
                <Badge
                  variant="secondary"
                  className="gap-1 text-[10px] px-1.5 py-0"
                >
                  <ShieldCheck className="size-3 text-primary" />
                  Admin
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground hidden sm:block">
                Menu Management & Live Kitchen Orders
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/customer">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <UtensilsCrossed className="size-3.5" />
                <span className="hidden sm:inline">Customer Menu</span>
              </Button>
            </Link>
            <UserButton />
          </div>
        </div>
      </header>

      {/* Main Admin Content */}
      <main className="container mx-auto px-4 py-8 flex-1 flex flex-col gap-6">
        <AdminMenu />
      </main>
    </div>
  );
}
