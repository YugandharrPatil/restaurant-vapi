"use client";

import { SignUp } from "@clerk/nextjs";
import { ArrowLeft, Loader2, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";

export default function UserSignUpPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Bar */}
      <header className="border-b bg-card/60 backdrop-blur-sm">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2 text-xs">
              <ArrowLeft className="size-4" />
              Back to Home
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="size-4 text-primary" />
            <span className="font-semibold text-sm">Customer Registration</span>
          </div>
        </div>
      </header>

      {/* Center Sign Up Component */}
      <main className="flex-1 flex items-center justify-center p-4 py-12">
        <Suspense
          fallback={
            <div className="flex items-center justify-center p-12">
              <Loader2 className="size-8 text-primary animate-spin" />
            </div>
          }
        >
          <SignUp
            routing="path"
            path="/sign-up"
            signInUrl="/sign-in"
            forceRedirectUrl="/customer"
            fallbackRedirectUrl="/customer"
            appearance={{
              elements: {
                rootBox: "mx-auto",
                card: "shadow-lg border rounded-2xl",
              },
            }}
          />
        </Suspense>
      </main>
    </div>
  );
}
