import { cors } from "@elysiajs/cors";
import { node } from "@elysiajs/node";
import { swagger } from "@elysiajs/swagger";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
} from "ai";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db";
import { cartItems, carts, menuItems, orderItems, orders } from "../db/schema";
import { adminApp } from "./admin";
import { createChatTools, getChatModel } from "./chat";
import { broadcastLiveEvent, getCartCustomer, setCartCustomer } from "./events";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;

// Helper to generate IDs
const generateId = (prefix: string) =>
  `${prefix}_${crypto.randomBytes(4).toString("hex")}`;

// Helper to find menu item by ID or case-insensitive fuzzy name/keywords
async function resolveMenuItem(itemIdOrName: string) {
  const rawNormalized = itemIdOrName.trim().toLowerCase();
  const normalized = rawNormalized.replace(/[-_]/g, " ");
  const allItems = await db.select().from(menuItems).all();

  // 1. Exact ID or exact Name match
  const exact = allItems.find(
    (i) =>
      i.id.toLowerCase() === rawNormalized ||
      i.name.toLowerCase() === rawNormalized,
  );
  if (exact) return exact;

  // 2. Substring match
  const contains = allItems.find(
    (i) =>
      i.name.toLowerCase().includes(normalized) ||
      normalized.includes(i.name.toLowerCase()) ||
      i.id.toLowerCase().includes(rawNormalized),
  );
  if (contains) return contains;

  // 3. Significant word / token intersection (e.g. "fries" in "french-fries" matches "Crispy Seasoned Fries")
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

// Helper to calculate cart summary
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

// Helper to ensure a cart exists
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

// Helper to resolve cartId even if template variable or missing from voice agent
async function resolveCartId(rawId?: string) {
  if (
    rawId &&
    rawId.trim() !== "" &&
    !rawId.includes("{{") &&
    rawId !== "undefined" &&
    rawId !== "null"
  ) {
    return rawId;
  }
  // Find the most recently active cart (e.g. the one active in the web UI)
  const allActive = await db
    .select()
    .from(carts)
    .where(eq(carts.status, "active"))
    .all();
  if (allActive.length > 0) {
    allActive.sort((a, b) => b.updatedAt - a.updatedAt);
    return allActive[0].id;
  }
  const newCart = await ensureCart();
  return newCart.id;
}

export interface CartAction {
  operation: "addItem" | "removeItem" | "clearCart" | string;
  itemId?: string;
  quantity?: number | string;
}

// Core helper for applying multiple cart actions atomically
async function applyCartActions(cartId: string, actions: CartAction[]) {
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

    if (!act.itemId) {
      continue;
    }

    const item = await resolveMenuItem(act.itemId);
    if (!item) {
      messages.push(`Item "${act.itemId}" not found`);
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
        messages.push(`${item.name} not in cart`);
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

export const app = new Elysia({ adapter: node(), prefix: "/api" })
  .use(cors())
  .use(
    swagger({
      path: "/swagger",
      documentation: {
        info: {
          title: "Restaurant API",
          version: "2.1.0",
          description: `
### Architecture & Consumer Matrix

Endpoints are consumed by three distinct clients:
1. **[Admin Panel]**: Real-time kitchen display system (KDS) and menu management.
2. **[Client App]**: Customer web interface for browsing and placing orders.
3. **[VAPI Voice Agent]**: AI voice order-taking agent via discrete tools or webhook server.

Each route specifies its **Consumer** tag and **Response Type** (\`Unary (JSON)\` or \`Streaming (SSE)\`).
					`,
        },
        tags: [
          {
            name: "VAPI / Core Orders",
            description:
              "Endpoints designed for VAPI voice agent tools & client order flows",
          },
          {
            name: "Client App",
            description: "Customer-facing web application endpoints",
          },
          {
            name: "Admin (Live KDS & Menu)",
            description: "Kitchen management and menu CRUD endpoints",
          },
          {
            name: "Auth",
            description: "Authentication and role management via Clerk",
          },
          {
            name: "Legacy Aliases",
            description: "Backward-compatible routes for older tools",
          },
        ],
      },
    }),
  )

  // Mount Admin Menu CRUD routes under /api/admin/*
  .use(adminApp)

  // ==========================================
  // Auth: Assign role to user on signup
  // ==========================================
  .post(
    "/auth/set-user-role",
    async ({ body, set }) => {
      const { userId } = (body || {}) as { userId?: string };
      if (!userId) {
        set.status = 400;
        return { error: "userId is required" };
      }

      const clerkSecretKey =
        process.env.CLERK_SECRET_KEY || process.env.CLERK_API_KEY;

      try {
        // Fetch user from Clerk to ensure we do not overwrite an existing admin
        const userRes = await fetch(
          `https://api.clerk.com/v1/users/${userId}`,
          {
            headers: {
              Authorization: `Bearer ${clerkSecretKey}`,
            },
          },
        );

        if (!userRes.ok) {
          set.status = userRes.status;
          return { error: "Failed to fetch user from Clerk" };
        }

        const userData = (await userRes.json()) as {
          public_metadata?: { role?: string };
        };

        if (userData.public_metadata?.role === "admin") {
          return {
            success: true,
            role: "admin",
            message: "User is already an admin",
          };
        }

        // Set public_metadata.role to user
        const patchRes = await fetch(
          `https://api.clerk.com/v1/users/${userId}/metadata`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${clerkSecretKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              public_metadata: {
                ...userData.public_metadata,
                role: "user",
              },
            }),
          },
        );

        if (!patchRes.ok) {
          set.status = patchRes.status;
          return { error: "Failed to update metadata in Clerk" };
        }

        return { success: true, role: "user" };
      } catch (err) {
        set.status = 500;
        return { error: (err as Error).message };
      }
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "[Auth] Assign user role on signup",
        description:
          "**Consumer**: Auth Service / Webhook (Clerk)\n**Response Type**: Unary (JSON)\n\nSets public_metadata.role = 'user' in Clerk if not already assigned.",
      },
    },
  )

  // ==========================================
  // 1. GET /api/getMenu - Get entire menu
  // ==========================================
  .get(
    "/getMenu",
    async () => {
      const items = await db.select().from(menuItems).all();
      return {
        status: "success",
        count: items.length,
        items,
      };
    },
    {
      detail: {
        tags: ["VAPI / Core Orders"],
        summary: "[VAPI Tool / Client] 1. Get entire menu",
        description:
          "**Consumer**: VAPI Voice Agent (`get_menu` tool) & Customer Web App\n**Response Type**: Unary (JSON)\n\nReturns all available menu items with prices, descriptions, categories, and IDs. Used by the agent to prevent hallucinating dishes.",
      },
    },
  )
  .get(
    "/menu",
    async () => {
      const items = await db.select().from(menuItems).all();
      return { success: true, count: items.length, items };
    },
    {
      detail: {
        tags: ["Legacy Aliases"],
        summary: "[Legacy] Get entire menu",
        description:
          "**Consumer**: Backward compatibility\n**Response Type**: Unary (JSON)\n\nLegacy alias for `/api/getMenu`.",
      },
    },
  )

  // ==========================================
  // 2. POST /api/createCart - Create new cart
  // ==========================================
  .post(
    "/createCart",
    async ({ body }) => {
      const rawCartId =
        body?.cartId && body.cartId.trim() !== "" ? body.cartId : undefined;
      const targetId = rawCartId || generateId("cart");
      const cart = await ensureCart(targetId);
      const customerName = body?.customerName?.trim() || "Guest";

      setCartCustomer(cart.id, customerName);
      broadcastLiveEvent("cart_created", {
        cartId: cart.id,
        customerName,
        status: cart.status,
        createdAt: cart.createdAt,
        updatedAt: cart.updatedAt,
        totalItems: 0,
        totalAmount: 0,
        items: [],
      });

      return {
        status: "success",
        cartId: cart.id,
        customerName,
        message: `Cart ${cart.id} created successfully for ${customerName}.`,
      };
    },
    {
      body: t.Optional(
        t.Object({
          cartId: t.Optional(
            t.String({ description: "Optional custom cartId" }),
          ),
          customerName: t.Optional(
            t.String({ description: "Customer's name" }),
          ),
        }),
      ),
      detail: {
        tags: ["VAPI / Core Orders"],
        summary: "[VAPI Tool / Client] 2. Create cart",
        description:
          "**Consumer**: VAPI Voice Agent (`create_cart` tool) & Customer Web App\n**Response Type**: Unary (JSON)\n\nInitializes a new order cart session in the database with customer name. Triggers a live `cart_created` event on the Admin KDS stream.",
      },
    },
  )
  .post(
    "/cart",
    async ({ body }: { body: any }) => {
      const targetId = body?.cartId || generateId("cart");
      const cart = await ensureCart(targetId);
      return {
        success: true,
        cartId: cart.id,
        status: cart.status,
        message: `Cart ${cart.id} created successfully.`,
      };
    },
    {
      detail: {
        tags: ["Legacy Aliases"],
        summary: "[Legacy] Create cart alias",
        description:
          "**Consumer**: Backward compatibility\n**Response Type**: Unary (JSON)\n\nLegacy alias for `/api/createCart`.",
      },
    },
  )

  // ==========================================
  // 3. POST /api/updateCart - Smart Batch Actions
  // ==========================================
  .post(
    "/updateCart",
    async ({ body, set }) => {
      const targetCartId = await resolveCartId(body?.cartId);

      // Normalize actions array: can accept body.actions, body.items, or single action shorthand
      let actionsList: CartAction[] = [];

      if (Array.isArray(body?.actions) && body.actions.length > 0) {
        actionsList = body.actions;
      } else if (
        Array.isArray((body as any)?.items) &&
        (body as any).items.length > 0
      ) {
        actionsList = (body as any).items;
      } else if (body?.operation) {
        actionsList = [
          {
            operation: body.operation,
            itemId: body.itemId,
            quantity: body.quantity,
          },
        ];
      } else {
        set.status = 400;
        return {
          status: "failure",
          error:
            'No valid action provided. Pass an "actions" array or "operation".',
        };
      }

      const { message, finalCart } = await applyCartActions(
        targetCartId,
        actionsList,
      );

      broadcastLiveEvent("cart_updated", {
        cartId: targetCartId,
        customerName: getCartCustomer(targetCartId),
        finalCart,
      });

      return {
        status: "success",
        message,
        finalCart,
      };
    },
    {
      body: t.Object({
        cartId: t.Optional(t.String({ description: "The unique cart ID" })),
        actions: t.Optional(
          t.Array(
            t.Object({
              operation: t.String({
                description: "addItem | removeItem | clearCart",
              }),
              itemId: t.Optional(
                t.String({ description: "Slug ID or name of the dish" }),
              ),
              quantity: t.Optional(
                t.Any({ description: "Number of units (number or string)" }),
              ),
            }),
          ),
        ),
        // Optional top-level shorthand for single action
        operation: t.Optional(t.String()),
        itemId: t.Optional(t.String()),
        quantity: t.Optional(t.Any()),
      }),
      detail: {
        tags: ["VAPI / Core Orders"],
        summary: "[VAPI Tool / Client] 3. Update cart (Batch Operations)",
        description:
          "**Consumer**: VAPI Voice Agent (`update_cart` tool) & Customer Web App\n**Response Type**: Unary (JSON)\n\nSmart atomic batch modifier. Executes multiple additions, removals, and clears in a single turn. Returns `finalCart` with conversational `voiceSummary` and streams a `cart_updated` event to Admin KDS.",
      },
    },
  )

  // ==========================================
  // 4. GET & POST /api/getCart - Get entire cart
  // ==========================================
  .get(
    "/getCart",
    async ({ query, set }) => {
      const targetCartId = await resolveCartId(query?.cartId);
      const details = await getCartDetails(targetCartId);
      if (!details) {
        set.status = 404;
        return {
          status: "failure",
          error: `Cart "${targetCartId}" not found.`,
        };
      }
      return {
        status: "success",
        finalCart: details,
      };
    },
    {
      query: t.Optional(t.Object({ cartId: t.Optional(t.String()) })),
      detail: {
        tags: ["VAPI / Core Orders"],
        summary: "[Client App] 4. Get cart details (GET query)",
        description:
          "**Consumer**: Customer Web App\n**Response Type**: Unary (JSON)\n\nRetrieves full cart items, totals, and voice summary using URL query parameters (`?cartId=...`).",
      },
    },
  )
  .post(
    "/getCart",
    async ({ body, set }) => {
      const targetCartId = await resolveCartId(body?.cartId);
      const details = await getCartDetails(targetCartId);
      if (!details) {
        set.status = 404;
        return {
          status: "failure",
          error: `Cart "${targetCartId}" not found.`,
        };
      }
      return {
        status: "success",
        finalCart: details,
      };
    },
    {
      body: t.Optional(t.Object({ cartId: t.Optional(t.String()) })),
      detail: {
        tags: ["VAPI / Core Orders"],
        summary: "[VAPI Tool] 4. Get cart details (POST body)",
        description:
          "**Consumer**: VAPI Voice Agent (`get_cart` tool)\n**Response Type**: Unary (JSON)\n\nRetrieves cart items and total amounts via JSON body `{ cartId }`. VAPI functions send arguments exclusively in POST request bodies.",
      },
    },
  )
  .get(
    "/cart/:cartId",
    async ({ params: { cartId }, set }) => {
      const details = await getCartDetails(cartId);
      if (!details) {
        set.status = 404;
        return { success: false, error: "Cart not found" };
      }
      return { success: true, ...details };
    },
    {
      detail: {
        tags: ["Legacy Aliases"],
        summary: "[Legacy] Get cart by path param",
        description:
          "**Consumer**: Backward compatibility\n**Response Type**: Unary (JSON)\n\nLegacy route for `/api/cart/:cartId`.",
      },
    },
  )
  .post(
    "/cart/get",
    async ({ body, set }: { body: any; set: any }) => {
      const targetCartId = await resolveCartId(body?.cartId);
      const details = await getCartDetails(targetCartId);
      if (!details) {
        set.status = 404;
        return { success: false, error: "Cart not found" };
      }
      return { success: true, ...details };
    },
    {
      detail: {
        tags: ["Legacy Aliases"],
        summary: "[Legacy] Get cart alias",
        description:
          "**Consumer**: Backward compatibility\n**Response Type**: Unary (JSON)\n\nLegacy alias for `/api/getCart`.",
      },
    },
  )

  // ==========================================
  // 5. POST /api/placeOrder - Place order
  // ==========================================
  .post(
    "/placeOrder",
    async ({ body, set }) => {
      const targetCartId = await resolveCartId(body?.cartId);
      const customerName =
        body?.customerName || (body as any)?.customer_name || "Voice Guest";
      const customerPhone =
        body?.customerPhone || (body as any)?.customer_phone || null;
      const notes = body?.notes || null;

      const cartDetails = await getCartDetails(targetCartId);
      if (!cartDetails) {
        set.status = 404;
        return { status: "failure", error: "Cart not found" };
      }

      if (cartDetails.items.length === 0) {
        set.status = 400;
        return {
          status: "failure",
          error: "Cart is empty. Cannot place an empty order.",
          message:
            "Your cart is empty. Please add items before placing an order.",
        };
      }

      const orderId = generateId("ord");
      const now = Date.now();

      await db.insert(orders).values({
        id: orderId,
        cartId: targetCartId,
        customerName,
        customerPhone,
        notes,
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
        .where(eq(carts.id, targetCartId));

      broadcastLiveEvent("order_placed", {
        id: orderId,
        orderId,
        cartId: targetCartId,
        customerName,
        customerPhone,
        notes,
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
        totalItems: cartDetails.totalItems,
        items: cartDetails.items,
        message: `Order #${orderId} for $${cartDetails.totalAmount.toFixed(2)} has been placed successfully for ${customerName}. It is now being prepared!`,
        finalCart: {
          ...cartDetails,
          status: "completed",
        },
      };
    },
    {
      body: t.Optional(
        t.Object({
          cartId: t.Optional(t.String()),
          customerName: t.Optional(t.String()),
          customer_name: t.Optional(t.String()),
          customerPhone: t.Optional(t.String()),
          notes: t.Optional(t.String()),
        }),
      ),
      detail: {
        tags: ["VAPI / Core Orders"],
        summary: "[VAPI Tool / Client] 5. Place order",
        description:
          "**Consumer**: VAPI Voice Agent (`place_order` tool) & Customer Web App\n**Response Type**: Unary (JSON)\n\nFinalizes the cart, marks it as `completed`, creates database rows in `orders` and `order_items`, and broadcasts an `order_placed` event to the Admin Kitchen Queue.",
      },
    },
  )
  .post(
    "/cart/order",
    async ({ body, set }: { body: any; set: any }) => {
      const targetCartId = await resolveCartId(body?.cartId);
      const customerName =
        body?.customerName || (body as any)?.customer_name || "Voice Guest";
      const cartDetails = await getCartDetails(targetCartId);
      if (!cartDetails || cartDetails.items.length === 0) {
        set.status = 400;
        return { success: false, error: "Cart is empty" };
      }
      const orderId = generateId("ord");
      const now = Date.now();
      await db.insert(orders).values({
        id: orderId,
        cartId: targetCartId,
        customerName,
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
        .where(eq(carts.id, targetCartId));

      broadcastLiveEvent("order_placed", {
        id: orderId,
        orderId,
        cartId: targetCartId,
        customerName,
        status: "confirmed",
        totalAmount: cartDetails.totalAmount,
        totalItems: cartDetails.items.reduce(
          (s: number, i: any) => s + i.quantity,
          0,
        ),
        items: cartDetails.items,
        createdAt: now,
      });

      return {
        success: true,
        orderId,
        status: "confirmed",
        totalAmount: cartDetails.totalAmount,
        items: cartDetails.items,
        message: `Order #${orderId} placed successfully.`,
      };
    },
    {
      detail: {
        tags: ["Legacy Aliases"],
        summary: "[Legacy] Place order alias",
        description:
          "**Consumer**: Backward compatibility\n**Response Type**: Unary (JSON)\n\nLegacy alias for `/api/placeOrder`.",
      },
    },
  )

  // ==========================================
  // 6. POST /api/chat - AI Chatbot with Vercel AI SDK
  // ==========================================
  .post(
    "/chat",
    async ({ body }) => {
      const {
        messages,
        cartId,
        customerName = "Chat Guest",
      } = (body || {}) as {
        messages?: any[];
        cartId?: string;
        customerName?: string;
      };

      const targetCartId = await resolveCartId(cartId);
      setCartCustomer(targetCartId, customerName);

      const model = getChatModel();
      const tools = createChatTools(targetCartId, customerName);

      // Convert incoming UIMessages to ModelMessages
      const modelMessages = await convertToModelMessages(messages || []);

      const result = streamText({
        model,
        system: `You are Harvey's friendly, efficient restaurant AI ordering assistant.

You have access to tools to manage the customer's cart and browse the menu:
- "getMenu": Check items, prices, and availability. NEVER recommend or confirm dishes not in the menu.
- "getCart": Inspect the user's active cart.
- "updateCart": Add, remove, or clear items. Supports single or batch operations. Call this whenever the user wants food!
- "placeOrder": Place and confirm the order when the customer confirms they want to checkout.

RULES:
- Keep answers concise, appetizing, and friendly (1-3 sentences).
- If the customer asks what you have, call getMenu.
- When an item is added or removed, inform them of their new subtotal and ask if they'd like anything else (sides, drinks).
- Current Active Cart ID: ${targetCartId}
- Customer Name: ${customerName}`,
        messages: modelMessages,
        tools,
        stopWhen: stepCountIs(5),
      });

      return createUIMessageStreamResponse({
        stream: result.toUIMessageStream({ sendStart: false }),
      });
    },
    {
      detail: {
        tags: ["Client App"],
        summary: "[Client App] AI Chatbot streaming endpoint",
        description:
          "**Consumer**: Customer Web App (`AssistantModal` via Vercel AI SDK)\n**Response Type**: Streaming (SSE UIMessage Stream)\n\nInteractive AI chatbot that browses the menu, manages the cart via tool calling, and places orders.",
      },
    },
  )

  // Backwards-compatible aliases for older tools/endpoints
  .post(
    "/cart/items",
    async ({ body }: { body: any }) => {
      const targetCartId = await resolveCartId(body?.cartId);
      const { finalCart, message } = await applyCartActions(targetCartId, [
        {
          operation: "addItem",
          itemId: body.itemId,
          quantity: body.quantity || 1,
        },
      ]);
      return { success: true, cartId: targetCartId, message, cart: finalCart };
    },
    {
      detail: {
        tags: ["Legacy Aliases"],
        summary: "[Legacy] Add item to cart",
        description:
          "**Consumer**: Backward compatibility\n**Response Type**: Unary (JSON)\n\nReplaced by modular `/api/updateCart`.",
      },
    },
  )
  .post(
    "/cart/items/remove",
    async ({ body }: { body: any }) => {
      const targetCartId = await resolveCartId(body?.cartId);
      const { finalCart, message } = await applyCartActions(targetCartId, [
        {
          operation: "removeItem",
          itemId: body.itemId,
          quantity: body.quantity,
        },
      ]);
      return { success: true, cartId: targetCartId, message, cart: finalCart };
    },
    {
      detail: {
        tags: ["Legacy Aliases"],
        summary: "[Legacy] Remove item from cart",
        description:
          "**Consumer**: Backward compatibility\n**Response Type**: Unary (JSON)\n\nReplaced by modular `/api/updateCart`.",
      },
    },
  )
  .post(
    "/cart/clear",
    async ({ body }: { body: any }) => {
      const targetCartId = await resolveCartId(body?.cartId);
      const { finalCart, message } = await applyCartActions(targetCartId, [
        { operation: "clearCart" },
      ]);
      return { success: true, cartId: targetCartId, message, cart: finalCart };
    },
    {
      detail: {
        tags: ["Legacy Aliases"],
        summary: "[Legacy] Clear cart",
        description:
          "**Consumer**: Backward compatibility\n**Response Type**: Unary (JSON)\n\nReplaced by modular `/api/updateCart`.",
      },
    },
  )

  // ==========================================
  // Public config & orders list for frontend
  // ==========================================
  .get(
    "/vapi/config",
    () => ({
      publicKey: process.env.VAPI_PUBLIC_KEY || "",
      assistantId: process.env.VAPI_ASSISTANT_ID || "",
    }),
    {
      detail: {
        tags: ["Client App"],
        summary: "[Client App] Get VAPI web call credentials",
        description:
          "**Consumer**: Customer Web App (`@vapi-ai/web` browser SDK)\n**Response Type**: Unary (JSON)\n\nReturns public keys (`VAPI_PUBLIC_KEY`, `VAPI_ASSISTANT_ID`) to initiate in-browser WebRTC voice calls.",
      },
    },
  )

  .get(
    "/orders",
    async () => {
      const allOrders = await db.select().from(orders).all();
      const allOrderItems = await db.select().from(orderItems).all();

      const ordersWithItems = allOrders
        .map((ord) => ({
          ...ord,
          items: allOrderItems.filter((i) => i.orderId === ord.id),
        }))
        .sort((a, b) => b.createdAt - a.createdAt);

      return {
        success: true,
        count: ordersWithItems.length,
        orders: ordersWithItems,
      };
    },
    {
      detail: {
        tags: ["Client App"],
        summary: "[Client App] List orders history",
        description:
          "**Consumer**: Customer Web App\n**Response Type**: Unary (JSON)\n\nRetrieves placed orders and line items ordered newest first.",
      },
    },
  )

  // ==========================================
  // VAPI Webhook Handler
  // ==========================================
  .post(
    "/vapi/webhook",
    async ({ body }: { body: any }) => {
      const message = body?.message;
      if (message?.type !== "tool-calls") {
        return { success: true };
      }

      const callId = message.call?.id || "vapi_session";
      const results: Array<{ toolCallId: string; result: string }> = [];

      for (const toolCall of message.toolCalls || []) {
        const { id: toolCallId, function: fn } = toolCall;
        const name = fn?.name;
        const args =
          typeof fn?.arguments === "string"
            ? JSON.parse(fn.arguments)
            : fn?.arguments || {};
        const targetCartId = await resolveCartId(
          args.cartId || `cart_${callId.slice(-8)}`,
        );

        try {
          if (name === "get_menu" || name === "getMenu") {
            const items = await db.select().from(menuItems).all();
            const menuText = items
              .map((i) => `${i.name} ($${i.price.toFixed(2)})`)
              .join(", ");
            results.push({ toolCallId, result: `Menu items: ${menuText}` });
          } else if (name === "create_cart" || name === "createCart") {
            const cart = await ensureCart(targetCartId);
            const customerName = args.customerName || "Customer";
            results.push({
              toolCallId,
              result: `Created cart ${cart.id} for ${customerName}.`,
            });
          } else if (name === "update_cart" || name === "updateCart") {
            const actions = Array.isArray(args.actions)
              ? args.actions
              : [
                  {
                    operation: args.operation || "addItem",
                    itemId: args.itemId,
                    quantity: args.quantity,
                  },
                ];
            const { message, finalCart } = await applyCartActions(
              targetCartId,
              actions,
            );
            results.push({
              toolCallId,
              result: `${message}. ${finalCart?.voiceSummary || ""}`,
            });
          } else if (name === "get_cart" || name === "getCart") {
            const details = await getCartDetails(targetCartId);
            results.push({
              toolCallId,
              result: details?.voiceSummary || "Your cart is currently empty.",
            });
          } else if (name === "place_order" || name === "placeOrder") {
            const cartDetails = await getCartDetails(targetCartId);
            if (!cartDetails || cartDetails.items.length === 0) {
              results.push({
                toolCallId,
                result: "Cannot place order because cart is empty.",
              });
            } else {
              const orderId = generateId("ord");
              const now = Date.now();
              await db.insert(orders).values({
                id: orderId,
                cartId: targetCartId,
                customerName:
                  args.customerName || args.customer_name || "Voice Caller",
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
                .where(eq(carts.id, targetCartId));
              results.push({
                toolCallId,
                result: `Order #${orderId} for $${cartDetails.totalAmount.toFixed(2)} has been placed successfully and is being prepared!`,
              });
            }
          } else {
            results.push({ toolCallId, result: `Executed ${name}` });
          }
        } catch (err) {
          results.push({
            toolCallId,
            result: `Error executing ${name}: ${(err as Error).message}`,
          });
        }
      }

      return { results };
    },
    {
      detail: {
        tags: ["VAPI / Core Orders"],
        summary: "[VAPI Server Webhook] Multi-tool dispatcher",
        description:
          "**Consumer**: VAPI Server Webhook (`Server URL` configuration in VAPI Assistant)\n**Response Type**: Unary (JSON in `{ results: [...] }` format)\n\nAlternative to discrete tools. Handles any tool call (`get_menu`, `create_cart`, `update_cart`, `get_cart`, `place_order`) through a single centralized webhook.",
      },
    },
  );

function start() {
  try {
    app.listen(PORT);
    console.log(`[API Server] Running on http://localhost:${PORT}`);
    console.log(
      `[API Docs] Swagger available at http://localhost:${PORT}/swagger`,
    );
  } catch (err) {
    console.error("[API Server] Failed to start:", err);
  }
}

const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("server/index.ts") ||
    process.argv[1].endsWith("server/index.js"));

if (isMainModule || process.env.RUN_STANDALONE === "true") {
  start();
}

export type App = typeof app;
export type AppAPI = typeof app;
