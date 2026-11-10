"use client";

import { UserButton } from "@clerk/nextjs";
import Vapi from "@vapi-ai/web";
import {
  Check,
  ChefHat,
  Clock,
  Copy,
  Loader2,
  Mic,
  MicOff,
  Minus,
  Plus,
  Receipt,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Trash2,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import RestaurantChatbot from "@/components/RestaurantChatbot";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useUserRole } from "@/lib/auth";
import { app } from "@/lib/eden";

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl?: string;
}

export interface CartItem {
  id: string;
  cartId: string;
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
  category: string;
  imageUrl?: string;
}

export interface CartData {
  cartId: string;
  status: string;
  totalItems: number;
  totalAmount: number;
  items: CartItem[];
  voiceSummary?: string;
}

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface Order {
  id: string;
  cartId: string | null;
  customerName: string;
  status: string;
  totalAmount: number;
  createdAt: number;
  items: OrderItem[];
}

const CATEGORIES = ["All", "Burgers", "Pizzas", "Sides", "Drinks"];

export default function CustomerOrderPage() {
  const { isLoaded, isSignedIn, isAdmin, user } = useUserRole();
  const router = useRouter();

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [cartId, setCartId] = useState<string>("");
  const [cart, setCart] = useState<CartData | null>(null);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Vapi Voice state
  const [vapiConfig, setVapiConfig] = useState<{
    publicKey: string;
    assistantId: string;
  }>({
    publicKey: "",
    assistantId: "",
  });
  const [isCallActive, setIsCallActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const vapiRef = useRef<any>(null);

  const notify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  // 1. Fetch menu (uses GET /api/getMenu)
  const fetchMenu = async () => {
    try {
      const { data, error } = await app.api.getMenu.get();
      if (!error && data?.items) {
        setMenu(data.items as MenuItem[]);
      }
    } catch (err) {
      console.error("Failed to load menu:", err);
    }
  };

  // 2. Fetch cart details (uses GET /api/getCart)
  const fetchCart = async (id: string) => {
    try {
      const { data, error, status } = await app.api.getCart.get({
        query: { cartId: id },
      });
      if (!error && data && "finalCart" in data && data.finalCart) {
        setCart(data.finalCart as CartData);
      } else if (status === 404) {
        localStorage.removeItem("vapi_cart_id");
        initCart();
      }
    } catch (err) {
      console.error("Failed to fetch cart:", err);
    }
  };

  // 3. Init or load cart (uses POST /api/createCart)
  const initCart = useCallback(
    async (forcedId?: string) => {
      try {
        const storedId = forcedId || localStorage.getItem("vapi_cart_id");
        if (storedId) {
          setCartId(storedId);
          fetchCart(storedId);
        } else {
          const customerName =
            user?.fullName || user?.firstName || "Web Customer";
          const { data, error } = await app.api.createCart.post({
            customerName,
          });
          if (!error && data && "cartId" in data && data.cartId) {
            setCartId(data.cartId);
            localStorage.setItem("vapi_cart_id", data.cartId);
            fetchCart(data.cartId);
          }
        }
      } catch (err) {
        console.error("Failed to init cart:", err);
      }
    },
    [user],
  );

  // 4. Fetch placed orders
  const fetchOrders = async () => {
    try {
      const { data, error } = await app.api.orders.get();
      if (!error && data?.success && data.orders) {
        setOrders(data.orders as Order[]);
      }
    } catch (err) {
      console.error("Failed to fetch orders:", err);
    }
  };

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in");
    }
  }, [isLoaded, isSignedIn, router]);

  // Initial load
  useEffect(() => {
    if (!isSignedIn) return;

    fetchMenu();
    initCart();
    fetchOrders();

    // Fetch Vapi config
    app.api.vapi.config
      .get()
      .then(({ data, error }) => {
        if (!error && data?.publicKey && data.assistantId) {
          setVapiConfig(data);
        }
      })
      .catch((err) => console.error("Failed to load Vapi config:", err));

    const interval = setInterval(() => {
      fetchOrders();
      const currentCartId = localStorage.getItem("vapi_cart_id");
      if (currentCartId) {
        fetchCart(currentCartId);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [isSignedIn, initCart]);

  const createNewSession = async () => {
    try {
      setLoading(true);
      const customerName = user?.fullName || user?.firstName || "Web Customer";
      const { data, error } = await app.api.createCart.post({ customerName });
      if (!error && data && "cartId" in data && data.cartId) {
        setCartId(data.cartId);
        localStorage.setItem("vapi_cart_id", data.cartId);
        await fetchCart(data.cartId);
        notify(`Created new cart session: ${data.cartId}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = async (itemId: string, quantity = 1) => {
    if (!cartId) return;
    try {
      setLoading(true);
      const { data, error } = await app.api.updateCart.post({
        cartId,
        actions: [{ operation: "addItem", itemId, quantity }],
      });
      if (
        !error &&
        data &&
        "status" in data &&
        data.status === "success" &&
        data.finalCart
      ) {
        setCart(data.finalCart as CartData);
        notify(data.message || "Added to cart");
      }
    } catch (err) {
      console.error("Failed to add item:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveItem = async (itemId: string, quantity?: number) => {
    if (!cartId) return;
    try {
      setLoading(true);
      const { data, error } = await app.api.updateCart.post({
        cartId,
        actions: [{ operation: "removeItem", itemId, quantity }],
      });
      if (
        !error &&
        data &&
        "status" in data &&
        data.status === "success" &&
        data.finalCart
      ) {
        setCart(data.finalCart as CartData);
        notify(data.message || "Updated cart");
      }
    } catch (err) {
      console.error("Failed to remove item:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleClearCart = async () => {
    if (!cartId) return;
    try {
      setLoading(true);
      const { data, error } = await app.api.updateCart.post({
        cartId,
        actions: [{ operation: "clearCart" }],
      });
      if (
        !error &&
        data &&
        "status" in data &&
        data.status === "success" &&
        data.finalCart
      ) {
        setCart(data.finalCart as CartData);
        notify("Cart cleared");
      }
    } catch (err) {
      console.error("Failed to clear cart:", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePlaceOrder = async () => {
    if (!cartId || !cart || cart.items.length === 0) return;
    try {
      setLoading(true);
      const customerName =
        user?.fullName || user?.firstName || "Voice & Web Customer";
      const { data, error } = await app.api.placeOrder.post({
        cartId,
        customerName,
      });
      if (
        !error &&
        data &&
        "status" in data &&
        data.status === "success" &&
        "orderId" in data
      ) {
        notify(`🎉 Order #${data.orderId} placed successfully!`);
        setIsCartOpen(false);
        await fetchOrders();
        await createNewSession();
      }
    } catch (err) {
      console.error("Failed to place order:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleVoiceCall = async () => {
    if (isCallActive) {
      if (vapiRef.current) {
        vapiRef.current.stop();
      }
      setIsCallActive(false);
      setIsConnecting(false);
      return;
    }

    if (!vapiConfig.publicKey || !vapiConfig.assistantId) {
      notify("VAPI_PUBLIC_KEY or VAPI_ASSISTANT_ID is not configured in .env");
      return;
    }

    try {
      setIsConnecting(true);
      const VapiConstructor: any =
        typeof Vapi === "function"
          ? Vapi
          : (Vapi as any).default?.default || (Vapi as any).default || Vapi;

      const vapi = new VapiConstructor(vapiConfig.publicKey);
      vapiRef.current = vapi;

      vapi.on("call-start", () => {
        setIsCallActive(true);
        setIsConnecting(false);
        notify("🎙️ Voice call connected! Start speaking.");
      });

      vapi.on("speech-start", () => setIsSpeaking(true));
      vapi.on("speech-end", () => setIsSpeaking(false));

      vapi.on("call-end", () => {
        setIsCallActive(false);
        setIsConnecting(false);
        setIsSpeaking(false);
        notify("Voice call ended.");
      });

      vapi.on("error", (err: any) => {
        console.error("Vapi client error:", err);
        setIsCallActive(false);
        setIsConnecting(false);
        notify(`Voice call error: ${err.message || "Connection failed"}`);
      });

      await vapi.start(vapiConfig.assistantId, {
        variableValues: {
          cartId: cartId || "web_guest",
        },
      });
    } catch (err: any) {
      console.error("Failed to start call:", err);
      setIsConnecting(false);
      setIsCallActive(false);
      notify(`Could not connect: ${err.message || "Microphone error"}`);
    }
  };

  const copyCartId = () => {
    if (!cartId) return;
    navigator.clipboard.writeText(cartId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <Loader2 className="size-8 text-primary animate-spin" />
        <span className="text-sm text-muted-foreground">
          Loading menu & restaurant data...
        </span>
      </div>
    );
  }

  const filteredMenu =
    activeCategory === "All"
      ? menu
      : menu.filter((item) => item.category === activeCategory);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {/* Toast notification banner */}
      {notification && (
        <div className="fixed top-5 right-5 z-50 bg-primary text-primary-foreground px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium animate-in fade-in slide-in-from-top-2">
          <Sparkles className="size-4 shrink-0" />
          <span>{notification}</span>
        </div>
      )}

      {/* Navigation Header */}
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/">
              <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary cursor-pointer hover:bg-primary/20 transition">
                <ChefHat className="size-6" />
              </div>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-lg leading-tight">
                  Gourmet Voice
                </h1>
                <Badge variant="secondary" className="text-xs">
                  Ordering Portal
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Interactive Food Ordering with ElysiaJS & Turso
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Active Cart Session Indicator */}
            <div className="hidden md:flex items-center gap-2 bg-muted/60 px-3 py-1.5 rounded-lg border text-xs">
              <span className="text-muted-foreground">Session ID:</span>
              <code className="font-mono font-medium text-foreground">
                {cartId || "Loading..."}
              </code>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={copyCartId}
                title="Copy cartId for VAPI testing"
              >
                {copied ? (
                  <Check className="size-3.5 text-green-500" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={createNewSession}
                title="New Session"
                disabled={loading}
              >
                <RefreshCw
                  className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                />
              </Button>
            </div>

            {/* VAPI Tools Guide Modal */}
            <Dialog>
              <DialogTrigger
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: "gap-1.5 cursor-pointer",
                })}
              >
                <Mic className="size-4 text-primary" />
                <span className="hidden sm:inline">VAPI Tools Guide</span>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Mic className="size-5 text-primary" />
                    Connecting to VAPI Voice Agent
                  </DialogTitle>
                  <DialogDescription>
                    These REST endpoints are designed as tool calls for your
                    VAPI Assistant.
                  </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 text-xs">
                  <div className="p-3 bg-muted rounded-lg space-y-1">
                    <p className="font-semibold text-foreground">
                      API Base URL
                    </p>
                    <code className="block bg-background p-2 rounded border font-mono">
                      http://localhost:3000/api
                    </code>
                    <p className="text-muted-foreground text-[11px] mt-1">
                      Configure your Vapi assistant tools to point to your
                      hosted/ngrok API URL.
                    </p>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* In-Browser Vapi Voice Call Button */}
            <Button
              variant={isCallActive ? "destructive" : "default"}
              size="sm"
              onClick={toggleVoiceCall}
              disabled={isConnecting}
              className="gap-2 cursor-pointer shadow-sm relative overflow-hidden"
            >
              {isConnecting ? (
                <>
                  <RefreshCw className="size-4 animate-spin" />
                  <span className="hidden sm:inline">Connecting...</span>
                </>
              ) : isCallActive ? (
                <>
                  {isSpeaking ? (
                    <Volume2 className="size-4 animate-bounce text-green-400" />
                  ) : (
                    <MicOff className="size-4 animate-pulse" />
                  )}
                  <span>{isSpeaking ? "Speaking..." : "End Voice"}</span>
                </>
              ) : (
                <>
                  <Mic className="size-4" />
                  <span className="hidden sm:inline">Talk to Order</span>
                  <span className="sm:hidden">Voice</span>
                </>
              )}
            </Button>

            {/* Shopping Cart Sheet Trigger */}
            <Sheet open={isCartOpen} onOpenChange={setIsCartOpen}>
              <SheetTrigger
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: "gap-2 relative cursor-pointer",
                })}
              >
                <ShoppingBag className="size-4 text-primary" />
                <span className="font-bold text-xs">
                  {cart ? cart.totalItems : 0}
                </span>
                {cart && cart.totalItems > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {cart.totalItems}
                  </span>
                )}
              </SheetTrigger>

              <SheetContent className="flex flex-col w-full sm:max-w-md">
                <SheetHeader>
                  <div className="flex items-center justify-between">
                    <SheetTitle className="flex items-center gap-2">
                      <ShoppingBag className="size-5 text-primary" />
                      Your Cart
                    </SheetTitle>
                    <Badge variant="outline" className="font-mono text-xs">
                      #{cartId.slice(0, 8)}
                    </Badge>
                  </div>
                  <SheetDescription>
                    {cart?.voiceSummary || "Review your items and place order"}
                  </SheetDescription>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto py-4">
                  {!cart || cart.items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
                      <ShoppingBag className="size-10 stroke-1" />
                      <p className="text-sm">Your cart is empty.</p>
                      <p className="text-xs">Add items or speak to order!</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {cart.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-3 rounded-lg border bg-card/60 text-xs gap-2"
                        >
                          <div className="flex-1">
                            <h4 className="font-semibold text-sm">
                              {item.name}
                            </h4>
                            <p className="text-muted-foreground">
                              ${item.price.toFixed(2)} each &middot; Total: $
                              {item.subtotal.toFixed(2)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="outline"
                              size="icon-xs"
                              onClick={() =>
                                handleRemoveItem(item.menuItemId, 1)
                              }
                              disabled={loading}
                            >
                              <Minus className="size-3" />
                            </Button>
                            <span className="w-6 text-center font-bold text-sm">
                              {item.quantity}
                            </span>
                            <Button
                              variant="outline"
                              size="icon-xs"
                              onClick={() => handleAddItem(item.menuItemId, 1)}
                              disabled={loading}
                            >
                              <Plus className="size-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => handleRemoveItem(item.menuItemId)}
                              disabled={loading}
                              className="text-destructive hover:bg-destructive/10 ml-1"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <SheetFooter className="border-t pt-4 flex flex-col gap-3">
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between font-bold text-base">
                      <span>Total</span>
                      <span className="text-primary font-mono">
                        ${cart ? cart.totalAmount.toFixed(2) : "0.00"}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClearCart}
                      disabled={loading || !cart || cart.items.length === 0}
                      className="gap-1.5"
                    >
                      <Trash2 className="size-3.5" />
                      Clear
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 gap-2 cursor-pointer"
                      onClick={handlePlaceOrder}
                      disabled={loading || !cart || cart.items.length === 0}
                    >
                      <Receipt className="size-4" />
                      Place Order
                    </Button>
                  </div>
                </SheetFooter>
              </SheetContent>
            </Sheet>

            {/* Switch to Admin if user is admin */}
            {isAdmin && (
              <Link href="/admin">
                <Button variant="outline" size="sm" className="gap-1 text-xs">
                  <ShieldCheck className="size-3.5 text-primary" />
                  <span className="hidden sm:inline">Admin</span>
                </Button>
              </Link>
            )}

            {/* Clerk User Button */}
            <UserButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 flex-1 flex flex-col gap-8">
        {/* Banner Section */}
        <div className="rounded-2xl bg-gradient-to-r from-primary/10 via-primary/5 to-muted p-6 sm:p-8 border flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <Badge variant="secondary" className="gap-1.5">
              <Sparkles className="size-3 text-primary" />
              Interactive Voice Order Demo
            </Badge>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Order delicious food via Web or VAPI Voice
            </h2>
            <p className="text-sm text-muted-foreground">
              Add items directly below, or connect your VAPI assistant to
              manipulate this active cart in real time using the API tools.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={createNewSession}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className="size-3.5" />
              Reset Cart Session
            </Button>
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat}
              variant={activeCategory === cat ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveCategory(cat)}
              className="rounded-full text-xs cursor-pointer"
            >
              {cat}
            </Button>
          ))}
        </div>

        {/* Menu Items Grid */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold">
              {activeCategory === "All" ? "All Dishes" : activeCategory}
            </h3>
            <span className="text-xs text-muted-foreground">
              Showing {filteredMenu.length} items
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredMenu.map((item) => (
              <Card
                key={item.id}
                className="flex flex-col justify-between overflow-hidden hover:shadow-md transition"
              >
                <div>
                  {item.imageUrl && (
                    <div className="h-44 w-full overflow-hidden bg-muted relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="w-full h-full object-cover hover:scale-105 transition duration-300"
                        loading="lazy"
                      />
                      <Badge className="absolute top-2.5 right-2.5 backdrop-blur bg-background/80 text-foreground font-mono text-[10px]">
                        {item.category}
                      </Badge>
                    </div>
                  )}
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base font-bold leading-tight">
                        {item.name}
                      </CardTitle>
                      <span className="font-bold text-primary shrink-0">
                        ${item.price.toFixed(2)}
                      </span>
                    </div>
                    <CardDescription className="text-xs line-clamp-2 mt-1">
                      {item.description}
                    </CardDescription>
                  </CardHeader>
                </div>

                <CardContent className="p-4 pt-0">
                  <div className="bg-muted/50 rounded px-2 py-1 text-[11px] text-muted-foreground flex items-center justify-between">
                    <span>Tool itemId:</span>
                    <code className="font-mono text-foreground font-medium">
                      {item.id}
                    </code>
                  </div>
                </CardContent>

                <CardFooter className="p-4 pt-0">
                  <Button
                    className="w-full gap-1.5 text-xs cursor-pointer"
                    size="sm"
                    onClick={() => handleAddItem(item.id, 1)}
                    disabled={loading}
                  >
                    <Plus className="size-3.5" />
                    Add to Cart
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </section>

        <Separator className="my-4" />

        {/* Live Orders Feed */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold flex items-center gap-2">
                <Receipt className="size-5 text-primary" />
                Live Placed Orders
              </h3>
              <p className="text-xs text-muted-foreground">
                Orders saved permanently to SQLite/Turso.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchOrders}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
          </div>

          {orders.length === 0 ? (
            <div className="border border-dashed rounded-xl p-8 text-center text-muted-foreground text-sm">
              No orders placed yet. Add items and place an order, or tell your
              VAPI agent to checkout!
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {orders.map((ord) => (
                <Card key={ord.id} className="border shadow-xs">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center justify-between">
                      <code className="font-mono text-xs font-bold text-primary">
                        #{ord.id}
                      </code>
                      <Badge
                        variant="secondary"
                        className="capitalize text-[11px]"
                      >
                        {ord.status}
                      </Badge>
                    </div>
                    <CardDescription className="text-[11px] flex items-center gap-1 mt-1">
                      <Clock className="size-3" />
                      {new Date(ord.createdAt).toLocaleTimeString()} &middot;{" "}
                      {ord.customerName}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-2">
                    <div className="space-y-1 text-xs">
                      {ord.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex justify-between text-muted-foreground"
                        >
                          <span>
                            {item.quantity}x {item.name}
                          </span>
                          <span className="font-mono">
                            ${item.totalPrice.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                  <CardFooter className="p-4 pt-2 border-t flex justify-between items-center text-xs font-bold">
                    <span>Total Paid</span>
                    <span className="text-sm text-primary font-mono">
                      ${ord.totalAmount.toFixed(2)}
                    </span>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        <p>
          Gourmet Voice &middot; Next.js + ElysiaJS + Turso + shadcn UI + Clerk
          Auth
        </p>
      </footer>

      {/* Assistant UI AI Chatbot Modal */}
      {cartId && (
        <RestaurantChatbot
          cartId={cartId}
          customerName={user?.fullName || user?.firstName || "Customer"}
          onCartUpdated={() => {
            fetchCart(cartId);
            fetchOrders();
          }}
        />
      )}
    </div>
  );
}
