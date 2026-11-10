import { desc, eq } from "drizzle-orm";
import { EventEmitter } from "events";
import { db } from "../db";
import { cartItems, carts, menuItems, orderItems, orders } from "../db/schema";

export interface LiveOrderEvent {
  type:
    | "cart_created"
    | "cart_updated"
    | "order_placed"
    | "order_status_changed";
  payload: any;
  timestamp: number;
}

// In-memory event emitter for SSE
export const liveOrderEvents = new EventEmitter();
liveOrderEvents.setMaxListeners(100);

// Map to store customer name associated with active cart sessions
const cartCustomerNames = new Map<string, string>();

export function setCartCustomer(cartId: string, name: string) {
  if (name && name.trim()) {
    cartCustomerNames.set(cartId, name.trim());
  }
}

export function getCartCustomer(cartId: string): string {
  return cartCustomerNames.get(cartId) || "Guest";
}

export function broadcastLiveEvent(type: LiveOrderEvent["type"], payload: any) {
  const event: LiveOrderEvent = {
    type,
    payload,
    timestamp: Date.now(),
  };
  liveOrderEvents.emit("live_order_event", event);
}

// Helper to fetch details for all active carts (currently in-progress)
export async function getActiveCartsSnapshot() {
  const activeCarts = await db
    .select()
    .from(carts)
    .where(eq(carts.status, "active"))
    .orderBy(desc(carts.updatedAt))
    .limit(20)
    .all();

  const snapshot = [];

  for (const cart of activeCarts) {
    const items = await db
      .select({
        id: cartItems.id,
        menuItemId: cartItems.menuItemId,
        name: menuItems.name,
        price: menuItems.price,
        quantity: cartItems.quantity,
        category: menuItems.category,
      })
      .from(cartItems)
      .innerJoin(menuItems, eq(cartItems.menuItemId, menuItems.id))
      .where(eq(cartItems.cartId, cart.id))
      .all();

    const itemsWithSubtotal = items.map((i) => ({
      ...i,
      subtotal: Math.round(i.price * i.quantity * 100) / 100,
    }));

    const totalAmount =
      Math.round(
        itemsWithSubtotal.reduce((acc, i) => acc + i.subtotal, 0) * 100,
      ) / 100;
    const totalItems = itemsWithSubtotal.reduce(
      (acc, i) => acc + i.quantity,
      0,
    );

    snapshot.push({
      cartId: cart.id,
      customerName: getCartCustomer(cart.id),
      status: cart.status,
      createdAt: cart.createdAt,
      updatedAt: cart.updatedAt,
      totalItems,
      totalAmount,
      items: itemsWithSubtotal,
    });
  }

  return snapshot;
}

// Helper to fetch recent placed orders
export async function getRecentOrdersSnapshot() {
  const allOrders = await db
    .select()
    .from(orders)
    .orderBy(desc(orders.createdAt))
    .limit(25)
    .all();

  const result = [];

  for (const ord of allOrders) {
    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, ord.id))
      .all();

    result.push({
      ...ord,
      items,
    });
  }

  return result;
}
