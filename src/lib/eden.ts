import { treaty } from "@elysiajs/eden";
import type { App } from "@/server";

const API_URL =
  typeof window !== "undefined"
    ? window.location.origin
    : process.env.NEXT_PUBLIC_API_URL ||
      process.env.API_URL ||
      `http://localhost:${process.env.PORT || 3000}`;

export const app = treaty<App>(API_URL);
export const api = app.api;

export type { App };
