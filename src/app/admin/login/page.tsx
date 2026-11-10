"use client";

import { useClerk } from "@clerk/nextjs";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const adminLoginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type AdminLoginFormValues = z.infer<typeof adminLoginSchema>;

export default function AdminLoginPage() {
  const clerk = useClerk();
  const router = useRouter();
  const isLoaded = clerk.loaded;
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<AdminLoginFormValues>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: AdminLoginFormValues) {
    if (!clerk.loaded || !clerk.client) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      // 1. Authenticate with email & password via custom Clerk hook
      const result = await clerk.client.signIn.create({
        identifier: values.email,
        password: values.password,
      });

      if (result.status === "complete") {
        // Activate session
        await clerk.setActive({ session: result.createdSessionId });

        // Check if the user has role 'admin' in publicMetadata
        const activeUser =
          clerk.user ||
          clerk.client?.sessions?.find((s) => s.id === result.createdSessionId)
            ?.user;
        const role = activeUser?.publicMetadata?.role;

        if (role !== "admin") {
          // Reject non-admin users
          await clerk.signOut();
          setErrorMessage(
            "Access denied. This account does not have administrator privileges.",
          );
          return;
        }

        // Navigate to Admin dashboard
        router.push("/admin");
      } else {
        setErrorMessage(`Sign-in requires further action (${result.status}).`);
      }
    } catch (err: any) {
      console.error("Admin login error:", err);
      const message =
        err?.errors?.[0]?.longMessage ||
        err?.errors?.[0]?.message ||
        err?.message ||
        "Invalid credentials. Please verify your email and password.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

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
          <div className="flex items-center gap-2 text-primary font-semibold text-sm">
            <ShieldCheck className="size-4" />
            <span>Admin Control Panel</span>
          </div>
        </div>
      </header>

      {/* Login Card */}
      <main className="flex-1 flex items-center justify-center p-4 py-12">
        <Card className="w-full max-w-md shadow-lg border">
          <CardHeader className="space-y-1 text-center">
            <div className="size-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mx-auto mb-2">
              <ShieldCheck className="size-6" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              Admin Sign In
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Sign in with your administrative credentials to manage menus and
              kitchen orders
            </CardDescription>
          </CardHeader>

          <CardContent>
            {errorMessage && (
              <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive flex items-start gap-2.5">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{errorMessage}</span>
              </div>
            )}

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">
                        Admin Email
                      </FormLabel>
                      <FormControl>
                        <div className="relative flex items-center">
                          <Mail className="absolute left-3 size-4 text-muted-foreground pointer-events-none" />
                          <Input
                            {...field}
                            type="email"
                            placeholder="admin@restaurant.com"
                            autoComplete="email"
                            disabled={isLoading}
                            className="pl-9 text-sm h-10"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">
                        Password
                      </FormLabel>
                      <FormControl>
                        <div className="relative flex items-center">
                          <Lock className="absolute left-3 size-4 text-muted-foreground pointer-events-none" />
                          <Input
                            {...field}
                            type={showPassword ? "text" : "password"}
                            placeholder="••••••••"
                            autoComplete="current-password"
                            disabled={isLoading}
                            className="pl-9 pr-10 text-sm h-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 text-muted-foreground hover:text-foreground transition cursor-pointer"
                            tabIndex={-1}
                          >
                            {showPassword ? (
                              <EyeOff className="size-4" />
                            ) : (
                              <Eye className="size-4" />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  disabled={isLoading || !isLoaded}
                  className="w-full h-10 gap-2 cursor-pointer mt-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Authenticating...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="size-4" />
                      Sign In as Admin
                    </>
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>

          <CardFooter className="border-t pt-4 text-center">
            <div className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <ShieldAlert className="size-3.5 text-amber-500" />
              <span>
                Restricted area. Only authorized administrators may log in.
              </span>
            </div>
          </CardFooter>
        </Card>
      </main>
    </div>
  );
}
