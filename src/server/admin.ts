import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db";
import { menuItems, orders } from "../db/schema";
import {
  broadcastLiveEvent,
  getActiveCartsSnapshot,
  getRecentOrdersSnapshot,
  liveOrderEvents,
} from "./events";

export const adminApp = new Elysia({ prefix: "/admin" })
  // ==========================================
  // REAL-TIME SSE: Live orders & in-progress carts
  // ==========================================
  .get(
    "/live-orders",
    async () => {
      const activeCarts = await getActiveCartsSnapshot();
      const recentOrders = await getRecentOrdersSnapshot();

      let cleanup: () => void = () => {};

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          // Send initial snapshot immediately
          const initPayload = {
            type: "init",
            payload: {
              activeCarts,
              recentOrders,
            },
            timestamp: Date.now(),
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(initPayload)}\n\n`),
          );

          // Listener for all live events
          const onLiveEvent = (event: any) => {
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
              );
            } catch {
              cleanup();
            }
          };

          liveOrderEvents.on("live_order_event", onLiveEvent);

          // 15-second heartbeat ping to prevent proxy/idle timeouts
          const pingTimer = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              cleanup();
            }
          }, 15000);

          cleanup = () => {
            clearInterval(pingTimer);
            liveOrderEvents.off("live_order_event", onLiveEvent);
          };
        },
        cancel() {
          cleanup();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    },
    {
      detail: {
        tags: ["Admin (Live KDS & Menu)"],
        summary:
          "[Admin Panel] SSE Stream: Live in-progress carts & kitchen queue",
        description:
          "**Consumer**: Admin Panel (`AdminLiveOrders.tsx` via `EventSource`)\n**Response Type**: Streaming (SSE - `text/event-stream`)\n\nStreams initial active carts + orders snapshot upon connection, and subsequently broadcasts live events (`cart_created`, `cart_updated`, `order_placed`, `order_status_changed`) as customers interact with VAPI or the web client.",
      },
    },
  )

  // GET /api/admin/orders - Get orders list on-demand
  .get(
    "/orders",
    async () => {
      const recentOrders = await getRecentOrdersSnapshot();
      const activeCarts = await getActiveCartsSnapshot();
      return {
        success: true,
        activeCarts,
        recentOrders,
      };
    },
    {
      detail: {
        tags: ["Admin (Live KDS & Menu)"],
        summary: "[Admin Panel] Get active carts & recent orders snapshot",
        description:
          "**Consumer**: Admin Panel\n**Response Type**: Unary (JSON)\n\nReturns an on-demand snapshot of active in-progress carts and recent orders for kitchen overview.",
      },
    },
  )

  // PATCH /api/admin/orders/:id/status - Update order status (kitchen workflow)
  .patch(
    "/orders/:id/status",
    async ({ params: { id }, body, set }) => {
      const existing = await db
        .select()
        .from(orders)
        .where(eq(orders.id, id))
        .get();
      if (!existing) {
        set.status = 404;
        return { success: false, error: `Order with ID "${id}" not found.` };
      }

      await db
        .update(orders)
        .set({ status: body.status })
        .where(eq(orders.id, id));

      broadcastLiveEvent("order_status_changed", {
        orderId: id,
        status: body.status,
      });

      return {
        success: true,
        orderId: id,
        status: body.status,
        message: `Order #${id} status updated to "${body.status}".`,
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        status: t.String({
          description:
            "Order status: confirmed, preparing, completed, or cancelled",
        }),
      }),
      detail: {
        tags: ["Admin (Live KDS & Menu)"],
        summary: "[Admin Panel] Update order status in kitchen queue",
        description:
          "**Consumer**: Admin Panel (Kitchen Display buttons: Start Preparing / Complete / Cancel)\n**Response Type**: Unary (JSON)\n\nUpdates order status in the database and broadcasts an `order_status_changed` event across all connected admin screens.",
      },
    },
  )

  // GET /api/admin/menu - List all menu items
  .get(
    "/menu",
    async () => {
      const items = await db.select().from(menuItems).all();
      return {
        success: true,
        count: items.length,
        items,
      };
    },
    {
      detail: {
        tags: ["Admin (Live KDS & Menu)"],
        summary: "[Admin Panel] List all menu items for management",
        description:
          "**Consumer**: Admin Panel (`AdminMenu.tsx`)\n**Response Type**: Unary (JSON)\n\nReturns all dishes with their database IDs, categories, and prices for administrative editing.",
      },
    },
  )

  // POST /api/admin/menu - Create a new menu item
  .post(
    "/menu",
    async ({ body, set }) => {
      const {
        name,
        description = "",
        price,
        category = "Other",
        imageUrl,
      } = body;
      if (!name || name.trim() === "") {
        set.status = 400;
        return { success: false, error: "Item name is required." };
      }
      if (price === undefined || price === null || isNaN(Number(price))) {
        set.status = 400;
        return { success: false, error: "Valid item price is required." };
      }

      // Generate slug ID if not provided
      const rawId = body.id && body.id.trim() !== "" ? body.id.trim() : name;
      const slugId = rawId
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      // Check if ID already exists
      const existing = await db
        .select()
        .from(menuItems)
        .where(eq(menuItems.id, slugId))
        .get();
      if (existing) {
        set.status = 409;
        return {
          success: false,
          error: `An item with ID "${slugId}" already exists. Please choose a different name or ID.`,
        };
      }

      const numPrice = Math.round(Number(price) * 100) / 100;

      await db.insert(menuItems).values({
        id: slugId,
        name: name.trim(),
        description: description.trim(),
        price: numPrice,
        category: category.trim(),
        imageUrl: imageUrl?.trim() || null,
      });

      const created = await db
        .select()
        .from(menuItems)
        .where(eq(menuItems.id, slugId))
        .get();
      return {
        success: true,
        message: `Item "${name}" created successfully.`,
        item: created,
      };
    },
    {
      body: t.Object({
        id: t.Optional(t.String({ description: "Optional custom slug ID" })),
        name: t.String({ description: "Item title" }),
        description: t.Optional(t.String({ description: "Item description" })),
        price: t.Numeric({ description: "Price in dollars" }),
        category: t.Optional(
          t.String({
            description: "Category (Burgers, Pizzas, Sides, Drinks, etc.)",
          }),
        ),
        imageUrl: t.Optional(t.String({ description: "Optional image URL" })),
      }),
      detail: {
        tags: ["Admin (Live KDS & Menu)"],
        summary: "[Admin Panel] Create a new menu dish",
        description:
          "**Consumer**: Admin Panel (`AdminMenu.tsx`)\n**Response Type**: Unary (JSON)\n\nCreates a new menu item in Turso DB. The dish becomes immediately available to both web ordering and the VAPI voice agent.",
      },
    },
  )

  // PUT /api/admin/menu/:id - Edit an existing menu item
  .put(
    "/menu/:id",
    async ({ params: { id }, body, set }) => {
      const existing = await db
        .select()
        .from(menuItems)
        .where(eq(menuItems.id, id))
        .get();
      if (!existing) {
        set.status = 404;
        return {
          success: false,
          error: `Menu item with ID "${id}" not found.`,
        };
      }

      const updates: Partial<typeof menuItems.$inferInsert> = {};
      if (body.name !== undefined) updates.name = body.name.trim();
      if (body.description !== undefined)
        updates.description = body.description.trim();
      if (body.price !== undefined)
        updates.price = Math.round(Number(body.price) * 100) / 100;
      if (body.category !== undefined) updates.category = body.category.trim();
      if (body.imageUrl !== undefined)
        updates.imageUrl = body.imageUrl.trim() || null;

      await db.update(menuItems).set(updates).where(eq(menuItems.id, id));
      const updated = await db
        .select()
        .from(menuItems)
        .where(eq(menuItems.id, id))
        .get();

      return {
        success: true,
        message: `Item "${id}" updated successfully.`,
        item: updated,
      };
    },
    {
      params: t.Object({
        id: t.String({ description: "ID of the menu item to update" }),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        description: t.Optional(t.String()),
        price: t.Optional(t.Numeric()),
        category: t.Optional(t.String()),
        imageUrl: t.Optional(t.String()),
      }),
      detail: {
        tags: ["Admin (Live KDS & Menu)"],
        summary: "[Admin Panel] Update menu dish details",
        description:
          "**Consumer**: Admin Panel (`AdminMenu.tsx`)\n**Response Type**: Unary (JSON)\n\nUpdates dish name, price, category, description, or image in Turso DB.",
      },
    },
  )

  // DELETE /api/admin/menu/:id - Delete a menu item
  .delete(
    "/menu/:id",
    async ({ params: { id }, set }) => {
      const existing = await db
        .select()
        .from(menuItems)
        .where(eq(menuItems.id, id))
        .get();
      if (!existing) {
        set.status = 404;
        return {
          success: false,
          error: `Menu item with ID "${id}" not found.`,
        };
      }

      await db.delete(menuItems).where(eq(menuItems.id, id));

      return {
        success: true,
        message: `Item "${existing.name}" (${id}) deleted successfully.`,
        deletedId: id,
      };
    },
    {
      params: t.Object({
        id: t.String({ description: "ID of the menu item to delete" }),
      }),
      detail: {
        tags: ["Admin (Live KDS & Menu)"],
        summary: "[Admin Panel] Delete a menu dish",
        description:
          "**Consumer**: Admin Panel (`AdminMenu.tsx`)\n**Response Type**: Unary (JSON)\n\nPermanently removes a dish from the menu in Turso DB.",
      },
    },
  );

export type AdminAPI = typeof adminApp;
