"use client";

import {
  Activity,
  CheckCircle2,
  ChefHat,
  Clock,
  Mic,
  PackageCheck,
  Radio,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  User,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { app } from "@/lib/eden";

export interface LiveCartItem {
  id: string;
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  category?: string;
  subtotal: number;
}

export interface LiveCart {
  cartId: string;
  customerName: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  totalItems: number;
  totalAmount: number;
  items: LiveCartItem[];
  voiceSummary?: string;
}

export interface LiveOrderItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface LiveOrder {
  id: string;
  cartId: string | null;
  customerName: string;
  customerPhone?: string | null;
  notes?: string | null;
  status: "confirmed" | "preparing" | "completed" | "cancelled" | string;
  totalAmount: number;
  createdAt: number;
  items: LiveOrderItem[];
}

export default function AdminLiveOrders() {
  const [activeCarts, setActiveCarts] = useState<LiveCart[]>([]);
  const [recentOrders, setRecentOrders] = useState<LiveOrder[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [lastEventTime, setLastEventTime] = useState<number | null>(null);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Format relative time helper
  const formatRelativeTime = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  // Connect to SSE stream
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setConnectionStatus("connecting");
    const es = new EventSource("/api/admin/live-orders");
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnectionStatus("connected");
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLastEventTime(Date.now());

        if (data.type === "init") {
          setActiveCarts(data.payload.activeCarts || []);
          setRecentOrders(data.payload.recentOrders || []);
        } else if (data.type === "cart_created") {
          const newCart: LiveCart = {
            cartId: data.payload.cartId,
            customerName: data.payload.customerName || "Guest",
            status: data.payload.status || "active",
            createdAt: data.payload.createdAt || Date.now(),
            updatedAt: data.payload.updatedAt || Date.now(),
            totalItems: 0,
            totalAmount: 0,
            items: [],
          };
          setActiveCarts((prev) => {
            const exists = prev.find((c) => c.cartId === newCart.cartId);
            if (exists) return prev;
            return [newCart, ...prev];
          });
          toast.info(`🎙️ New customer started order: ${newCart.customerName}`);
        } else if (data.type === "cart_updated") {
          const finalCart = data.payload.finalCart;
          const cartId = data.payload.cartId;
          const customerName = data.payload.customerName || "Guest";

          setActiveCarts((prev) => {
            const index = prev.findIndex((c) => c.cartId === cartId);
            const updated: LiveCart = {
              cartId,
              customerName,
              status: finalCart?.status || "active",
              createdAt: finalCart?.createdAt || Date.now(),
              updatedAt: Date.now(),
              totalItems: finalCart?.totalItems || 0,
              totalAmount: finalCart?.totalAmount || 0,
              items: finalCart?.items || [],
              voiceSummary: finalCart?.voiceSummary,
            };

            if (index >= 0) {
              const copy = [...prev];
              copy[index] = updated;
              return copy;
            }
            return [updated, ...prev];
          });
        } else if (data.type === "order_placed") {
          const newOrder: LiveOrder = {
            id: data.payload.id || data.payload.orderId,
            cartId: data.payload.cartId,
            customerName: data.payload.customerName || "Guest",
            customerPhone: data.payload.customerPhone,
            notes: data.payload.notes,
            status: data.payload.status || "confirmed",
            totalAmount: data.payload.totalAmount || 0,
            createdAt: data.payload.createdAt || Date.now(),
            items: data.payload.items || [],
          };

          // Prepend new order to list
          setRecentOrders((prev) => [newOrder, ...prev]);

          // Remove the corresponding active cart
          if (newOrder.cartId) {
            setActiveCarts((prev) =>
              prev.filter((c) => c.cartId !== newOrder.cartId),
            );
          }

          toast.success(
            `🎉 New Order #${newOrder.id} placed for $${newOrder.totalAmount.toFixed(2)}!`,
          );
        } else if (data.type === "order_status_changed") {
          const { orderId, status } = data.payload;
          setRecentOrders((prev) =>
            prev.map((o) => (o.id === orderId ? { ...o, status } : o)),
          );
        }
      } catch (err) {
        console.error("Failed to parse SSE payload:", err);
      }
    };

    es.onerror = () => {
      setConnectionStatus("disconnected");
    };
  }, []);

  useEffect(() => {
    connectSSE();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connectSSE]);

  // Update order status in kitchen flow
  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    try {
      setUpdatingOrderId(orderId);
      const { data, error } = await app.api.admin
        .orders({ id: orderId })
        .status.patch({ status: newStatus });

      if (error || !data?.success) {
        const errMsg =
          error && typeof error === "object" && "value" in error
            ? (error.value as any)?.error || JSON.stringify(error.value)
            : (data as any)?.error || "Failed to update order status";
        throw new Error(errMsg);
      }

      setRecentOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)),
      );
      toast.success(`Order #${orderId} marked as ${newStatus}`);
    } catch (err: any) {
      toast.error(err.message || "Error updating status");
    } finally {
      setUpdatingOrderId(null);
    }
  };

  // Active carts with at least 1 item or active within the last 10 minutes
  const visibleCarts = activeCarts.filter(
    (c) => c.items.length > 0 || Date.now() - c.updatedAt < 1000 * 60 * 10,
  );

  return (
    <div className="space-y-6">
      {/* Top Status & Controls Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border bg-card/60 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center">
            <Radio
              className={`size-5 ${
                connectionStatus === "connected"
                  ? "text-green-500 animate-pulse"
                  : connectionStatus === "connecting"
                    ? "text-yellow-500 animate-spin"
                    : "text-destructive"
              }`}
            />
            {connectionStatus === "connected" && (
              <span className="absolute size-2 bg-green-500 rounded-full animate-ping opacity-75" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-foreground text-sm sm:text-base">
                Real-Time Kitchen Display & Live Carts
              </h2>
              <Badge
                variant={
                  connectionStatus === "connected" ? "secondary" : "outline"
                }
                className="text-xs font-normal"
              >
                {connectionStatus === "connected"
                  ? "Live Stream Connected"
                  : connectionStatus === "connecting"
                    ? "Connecting..."
                    : "Disconnected"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {lastEventTime
                ? `Last sync: ${formatRelativeTime(lastEventTime)}`
                : "Listening for live voice & web order updates..."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <Button
            variant="outline"
            size="sm"
            onClick={connectSSE}
            className="gap-1.5 text-xs h-8"
          >
            <RefreshCw className="size-3.5" />
            Reconnect
          </Button>
        </div>
      </div>

      {/* Main Grid: Left = In-Progress Carts, Right = Confirmed Orders Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* ========================================================= */}
        {/* LEFT COLUMN: LIVE IN-PROGRESS CARTS (VOICE / WEB)        */}
        {/* ========================================================= */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-amber-500" />
              <h3 className="font-bold text-foreground text-base">
                In-Progress Orders
              </h3>
              <Badge variant="outline" className="text-xs">
                {visibleCarts.length} Active
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Mic className="size-3 text-primary animate-pulse" /> Live Voice
              Sessions
            </span>
          </div>

          {visibleCarts.length === 0 ? (
            <Card className="border-dashed py-12 text-center text-muted-foreground">
              <CardContent className="flex flex-col items-center justify-center gap-2">
                <ShoppingBag className="size-8 opacity-40" />
                <p className="text-sm font-medium">
                  No customers currently ordering
                </p>
                <p className="text-xs max-w-xs">
                  When a customer speaks to Harvey&apos;s Voice AI or browses
                  the menu, their cart items will show here in real time.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {visibleCarts.map((cart) => {
                const isRecentlyActive = Date.now() - cart.updatedAt < 25000;
                return (
                  <Card
                    key={cart.cartId}
                    className={`transition-all duration-300 ${
                      isRecentlyActive
                        ? "border-amber-500/50 shadow-md ring-1 ring-amber-500/30"
                        : "border-border"
                    }`}
                  >
                    <CardHeader className="pb-2 pt-3.5 px-4 flex flex-row items-center justify-between gap-2 border-b">
                      <div className="flex items-center gap-2">
                        <div className="size-7 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                          <User className="size-3.5" />
                        </div>
                        <div>
                          <CardTitle className="text-sm font-bold flex items-center gap-1.5">
                            {cart.customerName}
                            {isRecentlyActive && (
                              <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[10px] h-4 gap-1 px-1.5 font-normal">
                                <Sparkles className="size-2.5 animate-spin" />{" "}
                                Live Now
                              </Badge>
                            )}
                          </CardTitle>
                          <CardDescription className="text-[11px] font-mono">
                            {cart.cartId}
                          </CardDescription>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-xs font-semibold text-primary block">
                          ${cart.totalAmount.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1 justify-end">
                          <Clock className="size-2.5" />
                          {formatRelativeTime(cart.updatedAt)}
                        </span>
                      </div>
                    </CardHeader>

                    <CardContent className="p-4 space-y-3">
                      {/* Items list */}
                      {cart.items.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">
                          Session started. Waiting for items...
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {cart.items.map((item) => (
                            <div
                              key={item.id || item.menuItemId}
                              className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/40"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-primary font-mono">
                                  {item.quantity}x
                                </span>
                                <span className="font-medium text-foreground">
                                  {item.name}
                                </span>
                              </div>
                              <span className="text-muted-foreground font-mono">
                                ${item.subtotal.toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Live Voice Summary */}
                      {cart.voiceSummary && (
                        <div className="text-[11px] bg-primary/5 text-muted-foreground p-2 rounded border border-primary/10 flex items-start gap-1.5">
                          <Mic className="size-3 text-primary shrink-0 mt-0.5" />
                          <span>{cart.voiceSummary}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* ========================================================= */}
        {/* RIGHT COLUMN: KITCHEN QUEUE (PLACED ORDERS)               */}
        {/* ========================================================= */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ChefHat className="size-4 text-primary" />
              <h3 className="font-bold text-foreground text-base">
                Kitchen Orders Queue
              </h3>
              <Badge variant="secondary" className="text-xs">
                {recentOrders.length} Placed
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              Ordered by newest first
            </span>
          </div>

          {recentOrders.length === 0 ? (
            <Card className="border-dashed py-12 text-center text-muted-foreground">
              <CardContent className="flex flex-col items-center justify-center gap-2">
                <ChefHat className="size-8 opacity-40" />
                <p className="text-sm font-medium">No placed orders yet</p>
                <p className="text-xs max-w-xs">
                  When a customer confirms their order through voice or web, it
                  instantly transitions to the kitchen queue.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {recentOrders.map((order) => {
                const isConfirmed = order.status === "confirmed";
                const isPreparing = order.status === "preparing";
                const isCompleted = order.status === "completed";
                const isCancelled = order.status === "cancelled";

                return (
                  <Card
                    key={order.id}
                    className={`transition-all ${
                      isConfirmed
                        ? "border-blue-500/40 bg-blue-500/5"
                        : isPreparing
                          ? "border-purple-500/40 bg-purple-500/5"
                          : isCompleted
                            ? "border-green-500/30 opacity-80"
                            : "border-border"
                    }`}
                  >
                    <CardHeader className="pb-2 pt-3.5 px-4 flex flex-row items-center justify-between gap-2 border-b">
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-sm font-bold font-mono">
                            #{order.id}
                          </CardTitle>
                          <Badge
                            variant={
                              isConfirmed
                                ? "default"
                                : isPreparing
                                  ? "secondary"
                                  : isCompleted
                                    ? "outline"
                                    : "destructive"
                            }
                            className="text-[10px] h-4 font-medium capitalize"
                          >
                            {order.status}
                          </Badge>
                        </div>
                        <CardDescription className="text-xs font-medium text-foreground mt-0.5">
                          {order.customerName}
                          {order.customerPhone && (
                            <span className="text-muted-foreground ml-1.5 font-normal">
                              ({order.customerPhone})
                            </span>
                          )}
                        </CardDescription>
                      </div>

                      <div className="text-right">
                        <span className="text-sm font-bold text-foreground">
                          ${order.totalAmount.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1 justify-end">
                          <Clock className="size-2.5" />
                          {formatRelativeTime(order.createdAt)}
                        </span>
                      </div>
                    </CardHeader>

                    <CardContent className="p-4 space-y-3">
                      {/* Ordered Items List */}
                      <div className="space-y-1">
                        {order.items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between text-xs py-0.5"
                          >
                            <span className="text-foreground">
                              <strong className="text-primary font-mono mr-1.5">
                                {item.quantity}x
                              </strong>
                              {item.name}
                            </span>
                            <span className="text-muted-foreground font-mono">
                              ${item.totalPrice.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>

                      {order.notes && (
                        <p className="text-[11px] text-muted-foreground bg-muted p-1.5 rounded">
                          <strong>Note:</strong> {order.notes}
                        </p>
                      )}

                      {/* Kitchen Status Buttons */}
                      <div className="flex items-center justify-end gap-2 pt-2 border-t">
                        {isConfirmed && (
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                            disabled={updatingOrderId === order.id}
                            onClick={() =>
                              handleUpdateStatus(order.id, "preparing")
                            }
                          >
                            <ChefHat className="size-3" />
                            Start Preparing
                          </Button>
                        )}

                        {isPreparing && (
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1.5 bg-green-600 hover:bg-green-700 text-white cursor-pointer"
                            disabled={updatingOrderId === order.id}
                            onClick={() =>
                              handleUpdateStatus(order.id, "completed")
                            }
                          >
                            <PackageCheck className="size-3" />
                            Mark Ready / Complete
                          </Button>
                        )}

                        {isCompleted && (
                          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
                            <CheckCircle2 className="size-3.5" />
                            <span>Completed</span>
                          </div>
                        )}

                        {!isCompleted && !isCancelled && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive hover:bg-destructive/10 cursor-pointer"
                            disabled={updatingOrderId === order.id}
                            onClick={() =>
                              handleUpdateStatus(order.id, "cancelled")
                            }
                          >
                            <XCircle className="size-3" />
                            Cancel
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
