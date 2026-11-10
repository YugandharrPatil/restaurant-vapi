"use client";

import { Show, UserButton } from "@clerk/nextjs";
import {
  ArrowRight,
  ShieldCheck,
  User as UserIcon,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useUserRole } from "@/lib/auth";

export default function HomePage() {
  const { isAdmin } = useUserRole();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Minimal Header */}
      <header className="border-b bg-card/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <UtensilsCrossed className="size-5" />
            </div>
            <div>
              <span className="font-bold text-lg leading-tight tracking-tight block">
                Gourmet Voice
              </span>
              <span className="text-xs text-muted-foreground block">
                Restaurant & Operations
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Show when="signed-in">
              <div className="flex items-center gap-3">
                <Link href={isAdmin ? "/admin" : "/customer"}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                  >
                    {isAdmin ? "Admin Dashboard" : "Order Menu"}
                    <ArrowRight className="size-3.5" />
                  </Button>
                </Link>
                <UserButton />
              </div>
            </Show>
          </div>
        </div>
      </header>

      {/* Simple Hero Section */}
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="max-w-2xl w-full text-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-foreground">
              Welcome to Gourmet Voice
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Order delicious food effortlessly with interactive voice
              assistance, or manage kitchen operations as an administrator.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <Show when="signed-out">
              <Link href="/sign-in" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  className="w-full sm:w-auto gap-2 text-base px-8 h-12 cursor-pointer shadow-sm"
                >
                  <UserIcon className="size-5" />
                  Login as User
                </Button>
              </Link>
              <Link href="/admin/login" className="w-full sm:w-auto">
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full sm:w-auto gap-2 text-base px-8 h-12 cursor-pointer"
                >
                  <ShieldCheck className="size-5" />
                  Login as Admin
                </Button>
              </Link>
            </Show>

            <Show when="signed-in">
              {isAdmin ? (
                <Link href="/admin" className="w-full sm:w-auto">
                  <Button
                    size="lg"
                    className="w-full sm:w-auto gap-2 text-base px-8 h-12 cursor-pointer"
                  >
                    <ShieldCheck className="size-5" />
                    Go to Admin Dashboard
                    <ArrowRight className="size-4" />
                  </Button>
                </Link>
              ) : (
                <Link href="/customer" className="w-full sm:w-auto">
                  <Button
                    size="lg"
                    className="w-full sm:w-auto gap-2 text-base px-8 h-12 cursor-pointer"
                  >
                    <UtensilsCrossed className="size-5" />
                    Go to Order Menu
                    <ArrowRight className="size-4" />
                  </Button>
                </Link>
              )}
            </Show>
          </div>
        </div>
      </main>
    </div>
  );
}
