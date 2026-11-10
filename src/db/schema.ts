import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const menuItems = sqliteTable("menu_items", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  price: real("price").notNull(),
  category: text("category").notNull(),
  imageUrl: text("image_url"),
});

export const carts = sqliteTable("carts", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("active"), // 'active' | 'completed' | 'abandoned'
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const cartItems = sqliteTable("cart_items", {
  id: text("id").primaryKey(),
  cartId: text("cart_id")
    .notNull()
    .references(() => carts.id),
  menuItemId: text("menu_item_id")
    .notNull()
    .references(() => menuItems.id),
  quantity: integer("quantity").notNull().default(1),
});

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  cartId: text("cart_id"),
  customerName: text("customer_name").default("Voice Guest"),
  customerPhone: text("customer_phone"),
  notes: text("notes"),
  status: text("status").notNull().default("confirmed"), // 'confirmed' | 'preparing' | 'completed'
  totalAmount: real("total_amount").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const orderItems = sqliteTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  menuItemId: text("menu_item_id").notNull(),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: real("unit_price").notNull(),
  totalPrice: real("total_price").notNull(),
});

export type MenuItem = typeof menuItems.$inferSelect;
export type Cart = typeof carts.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
