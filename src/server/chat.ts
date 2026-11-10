import { createOpenAI } from "@ai-sdk/openai";
import { tool } from "ai";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { cartItems, carts, menuItems, orderItems, orders } from "../db/schema";
import { broadcastLiveEvent } from "./events";

const generateId = (prefix: string) =>
  `${prefix}_${crypto.randomBytes(4).toString("hex")}`;

// Helper to resolve model dynamically based on provided environment keys (NVIDIA NIM or OpenRouter)
export function getChatModel() {
  const provider = process.env.CHAT_PROVIDER?.toLowerCase();

  // 1. NVIDIA NIM
  if (provider === "nvidia" || (!provider && process.env.NVIDIA_NIM_API_KEY)) {
    const nvidia = createOpenAI({
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: process.env.NVIDIA_NIM_API_KEY,
    });
    const modelId =
      process.env.NVIDIA_NIM_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b";
    return nvidia.chat(modelId);
  }

  // 2. OpenRouter
  if (
    provider === "openrouter" ||
    (!provider && process.env.OPENROUTER_API_KEY)
  ) {
    const openrouter = createOpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      headers: {
        "HTTP-Referer": "http://localhost:5000",
        "X-Title": "Restaurant Voice & Chat Assistant",
      },
    });
    const modelId =
      process.env.OPENROUTER_MODEL || "nvidia/nemotron-3.5-lightning:free";
    return openrouter.chat(modelId);
  }

  // Fallback to OpenAI if configured
  if (process.env.OPENAI_API_KEY) {
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    return openai.chat("gpt-4o-mini");
  }

  throw new Error(
    "No LLM API key configured. Please set NVIDIA_NIM_API_KEY or OPENROUTER_API_KEY in .env",
  );
}

// Helpers from index.ts adapted for clean tool execution
async function resolveMenuItem(itemIdOrName: string) {
  const rawNormalized = itemIdOrName.trim().toLowerCase();
  const normalized = rawNormalized.replace(/[-_]/g, " ");
  const allItems = await db.select().from(menuItems).all();

  const exact = allItems.find(
    (i) =>
      i.id.toLowerCase() === rawNormalized ||
      i.name.toLowerCase() === rawNormalized,
  );
  if (exact) return exact;

  const contains = allItems.find(
    (i) =>
      i.name.toLowerCase().includes(normalized) ||
      normalized.includes(i.name.toLowerCase()) ||
      i.id.toLowerCase().includes(rawNormalized),
  );
  if (contains) return contains;

  const tokens = normalized
    .split(/\s+/)
    .filter((t) => t.length > 2 && t !== "the" && t !== "and");
  const matched = allItems.find((i) => {
    const itemNameLower = i.name.toLowerCase();
    const itemIdLower = i.id.toLowerCase();
    return tokens.some(
      (token) => itemNameLower.includes(token) || itemIdLower.includes(token),
    );
  });
  if (matched) return matched;

  return null;
}

async function ensureCart(cartId?: string) {
  const id = cartId || generateId("cart");
  const existing = await db.select().from(carts).where(eq(carts.id, id)).get();
  if (existing) {
    return existing;
  }
  const now = Date.now();
  await db.insert(carts).values({
    id,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return { id, status: "active", createdAt: now, updatedAt: now };
}

async function getCartDetails(cartId: string) {
  const cart = await db.select().from(carts).where(eq(carts.id, cartId)).get();
  if (!cart) return null;

  const items = await db
    .select({
      id: cartItems.id,
      cartId: cartItems.cartId,
      menuItemId: cartItems.menuItemId,
      quantity: cartItems.quantity,
      name: menuItems.name,
      price: menuItems.price,
      category: menuItems.category,
      imageUrl: menuItems.imageUrl,
    })
    .from(cartItems)
    .innerJoin(menuItems, eq(cartItems.menuItemId, menuItems.id))
    .where(eq(cartItems.cartId, cartId))
    .all();

  const itemsWithSubtotal = items.map((item) => ({
    ...item,
    subtotal: Math.round(item.price * item.quantity * 100) / 100,
  }));

  const totalAmount =
    Math.round(
      itemsWithSubtotal.reduce((sum, item) => sum + item.subtotal, 0) * 100,
    ) / 100;
  const totalQuantity = itemsWithSubtotal.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );

  const voiceSummary =
    itemsWithSubtotal.length === 0
      ? "Your cart is currently empty."
      : `Cart has ${totalQuantity} item${totalQuantity > 1 ? "s" : ""} (${itemsWithSubtotal
          .map((i) => `${i.quantity}x ${i.name}`)
          .join(", ")}) for a total of $${totalAmount.toFixed(2)}.`;

  return {
    cartId: cart.id,
    status: cart.status,
    totalItems: totalQuantity,
    totalAmount,
    items: itemsWithSubtotal,
    voiceSummary,
  };
}

async function applyCartActions(
  cartId: string,
  actions: Array<{
    operation: string;
    itemId?: string;
    quantity?: number | string;
  }>,
) {
  await ensureCart(cartId);
  const messages: string[] = [];

  for (const act of actions) {
    const op = act.operation?.trim();
    const rawQty = act.quantity !== undefined ? Number(act.quantity) : 1;
    const qty = isNaN(rawQty) || rawQty <= 0 ? 1 : Math.floor(rawQty);

    if (op === "clearCart") {
      await db.delete(cartItems).where(eq(cartItems.cartId, cartId));
      messages.push("Cleared cart");
      continue;
    }

    if (!act.itemId) continue;

    const item = await resolveMenuItem(act.itemId);
    if (!item) {
      messages.push(`Item "${act.itemId}" not found on menu`);
      continue;
    }

    const existing = await db
      .select()
      .from(cartItems)
      .where(
        and(eq(cartItems.cartId, cartId), eq(cartItems.menuItemId, item.id)),
      )
      .get();

    if (op === "addItem") {
      if (existing) {
        await db
          .update(cartItems)
          .set({ quantity: existing.quantity + qty })
          .where(eq(cartItems.id, existing.id));
      } else {
        await db.insert(cartItems).values({
          id: generateId("ci"),
          cartId,
          menuItemId: item.id,
          quantity: qty,
        });
      }
      messages.push(`Added ${qty}x ${item.name}`);
    } else if (op === "removeItem") {
      if (!existing) {
        messages.push(`${item.name} is not in the cart`);
      } else if (act.quantity !== undefined && qty < existing.quantity) {
        await db
          .update(cartItems)
          .set({ quantity: existing.quantity - qty })
          .where(eq(cartItems.id, existing.id));
        messages.push(`Removed ${qty}x ${item.name}`);
      } else {
        await db.delete(cartItems).where(eq(cartItems.id, existing.id));
        messages.push(`Removed all ${item.name}`);
      }
    }
  }

  await db
    .update(carts)
    .set({ updatedAt: Date.now() })
    .where(eq(carts.id, cartId));
  const finalCart = await getCartDetails(cartId);

  return {
    message: messages.join(", ") || "Cart updated",
    finalCart,
  };
}

// Tool definitions for Vercel AI SDK
export function createChatTools(sessionCartId: string, customerName: string) {
  return {
    getMenu: tool({
      description:
        "Get the entire restaurant menu with dish names, IDs, categories, descriptions, and prices. ALWAYS check this before confirming dish availability.",
      inputSchema: z.object({}),
      execute: async () => {
        const items = await db.select().from(menuItems).all();
        return {
          status: "success",
          count: items.length,
          items: items.map((i) => ({
            id: i.id,
            name: i.name,
            category: i.category,
            price: i.price,
            description: i.description,
          })),
        };
      },
    }),

    getCart: tool({
      description:
        "Retrieve the current contents and total of the customer's cart.",
      inputSchema: z.object({}),
      execute: async () => {
        const cart = await getCartDetails(sessionCartId);
        return {
          status: "success",
          cart: cart || { items: [], totalAmount: 0, totalItems: 0 },
        };
      },
    }),

    updateCart: tool({
      description:
        "Add, remove, or clear items in the cart. Supports batch operations. Always call this when customer wants to order or modify their dishes.",
      inputSchema: z.object({
        actions: z
          .array(
            z.object({
              operation: z
                .enum(["addItem", "removeItem", "clearCart"])
                .describe("The operation to execute"),
              itemId: z
                .string()
                .optional()
                .describe("Slug ID or dish name, e.g. classic-cheeseburger"),
              quantity: z
                .number()
                .optional()
                .default(1)
                .describe("Number of items to add or remove"),
            }),
          )
          .describe("List of cart actions to apply"),
      }),
      execute: async ({
        actions,
      }: {
        actions: Array<{
          operation: "addItem" | "removeItem" | "clearCart";
          itemId?: string;
          quantity?: number;
        }>;
      }) => {
        const { message, finalCart } = await applyCartActions(
          sessionCartId,
          actions,
        );
        broadcastLiveEvent("cart_updated", {
          cartId: sessionCartId,
          customerName,
          finalCart,
        });
        return {
          status: "success",
          message,
          finalCart,
        };
      },
    }),

    placeOrder: tool({
      description:
        "Place and confirm the order when the customer asks to checkout or finalize their purchase.",
      inputSchema: z.object({
        notes: z
          .string()
          .optional()
          .describe("Special dietary requests or instructions"),
      }),
      execute: async ({ notes }: { notes?: string }) => {
        const cartDetails = await getCartDetails(sessionCartId);
        if (!cartDetails || cartDetails.items.length === 0) {
          return {
            status: "failure",
            error: "Cart is empty. Please add items before placing an order.",
          };
        }

        const orderId = generateId("ord");
        const now = Date.now();

        await db.insert(orders).values({
          id: orderId,
          cartId: sessionCartId,
          customerName: customerName || "Chat Customer",
          notes: notes || null,
          status: "confirmed",
          totalAmount: cartDetails.totalAmount,
          createdAt: now,
        });

        for (const item of cartDetails.items) {
          await db.insert(orderItems).values({
            id: generateId("oi"),
            orderId,
            menuItemId: item.menuItemId,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.price,
            totalPrice: item.subtotal,
          });
        }

        await db
          .update(carts)
          .set({ status: "completed", updatedAt: now })
          .where(eq(carts.id, sessionCartId));

        broadcastLiveEvent("order_placed", {
          id: orderId,
          orderId,
          cartId: sessionCartId,
          customerName: customerName || "Chat Customer",
          notes: notes || null,
          status: "confirmed",
          totalAmount: cartDetails.totalAmount,
          totalItems: cartDetails.totalItems,
          items: cartDetails.items,
          createdAt: now,
        });

        return {
          status: "success",
          orderId,
          totalAmount: cartDetails.totalAmount,
          message: `Order #${orderId} placed successfully for $${cartDetails.totalAmount.toFixed(2)}! It is now being prepared.`,
        };
      },
    }),
  };
}
