"use client";

import {
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { app } from "@/lib/eden";
import AdminLiveOrders from "./AdminLiveOrders";

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl?: string | null;
}

interface AdminMenuProps {
  onMenuUpdated?: () => void;
}

const CATEGORY_OPTIONS = [
  "Burgers",
  "Pizzas",
  "Sides",
  "Drinks",
  "Desserts",
  "Other",
];

export default function AdminMenu({ onMenuUpdated }: AdminMenuProps) {
  const [adminView, setAdminView] = useState<"live-orders" | "menu">(
    "live-orders",
  );
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [notification, setNotification] = useState<string | null>(null);

  // Dialog states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    id: "",
    name: "",
    description: "",
    price: "",
    category: "Burgers",
    imageUrl: "",
  });

  const notify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  // Fetch admin menu items
  const fetchAdminMenu = async () => {
    try {
      setLoading(true);
      const { data, error } = await app.api.admin.menu.get();
      if (!error && data?.success && data.items) {
        setItems(data.items as MenuItem[]);
      }
    } catch (err) {
      console.error("Failed to load admin menu:", err);
      notify("Failed to load menu items");
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial mount fetch
  useEffect(() => {
    fetchAdminMenu();
  }, []);

  // Open Create Dialog
  const handleOpenCreate = () => {
    setFormData({
      id: "",
      name: "",
      description: "",
      price: "",
      category: "Burgers",
      imageUrl: "",
    });
    setIsCreateOpen(true);
  };

  // Open Edit Dialog
  const handleOpenEdit = (item: MenuItem) => {
    setEditingItem(item);
    setFormData({
      id: item.id,
      name: item.name,
      description: item.description || "",
      price: item.price.toString(),
      category: item.category || "Other",
      imageUrl: item.imageUrl || "",
    });
    setIsEditOpen(true);
  };

  // Save new dish
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.price) {
      notify("Name and Price are required");
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await app.api.admin.menu.post({
        id: formData.id.trim() || undefined,
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        price: parseFloat(formData.price),
        category: formData.category,
        imageUrl: formData.imageUrl.trim() || undefined,
      });

      if (!error && data?.success) {
        notify(`Added "${formData.name}"`);
        setIsCreateOpen(false);
        await fetchAdminMenu();
        onMenuUpdated?.();
      } else {
        const errMsg =
          error && typeof error === "object" && "value" in error
            ? (error.value as any)?.error || JSON.stringify(error.value)
            : (data as any)?.error || "Failed to create item";
        notify(errMsg);
      }
    } catch (err: any) {
      notify(err.message || "Error creating dish");
    } finally {
      setLoading(false);
    }
  };

  // Save edits
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;

    try {
      setLoading(true);
      const { data, error } = await app.api.admin
        .menu({ id: editingItem.id })
        .put({
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          price: parseFloat(formData.price),
          category: formData.category,
          imageUrl: formData.imageUrl.trim() || undefined,
        });

      if (!error && data?.success) {
        notify(`Updated "${formData.name}"`);
        setIsEditOpen(false);
        setEditingItem(null);
        await fetchAdminMenu();
        onMenuUpdated?.();
      } else {
        const errMsg =
          error && typeof error === "object" && "value" in error
            ? (error.value as any)?.error || JSON.stringify(error.value)
            : (data as any)?.error || "Failed to update item";
        notify(errMsg);
      }
    } catch (err: any) {
      notify(err.message || "Error updating dish");
    } finally {
      setLoading(false);
    }
  };

  // Delete dish
  const handleDelete = async (item: MenuItem) => {
    if (!confirm(`Are you sure you want to delete "${item.name}"?`)) return;

    try {
      setLoading(true);
      const { data, error } = await app.api.admin
        .menu({ id: item.id })
        .delete();
      if (!error && data?.success) {
        notify(`Deleted "${item.name}"`);
        await fetchAdminMenu();
        onMenuUpdated?.();
      } else {
        const errMsg =
          error && typeof error === "object" && "value" in error
            ? (error.value as any)?.error || JSON.stringify(error.value)
            : (data as any)?.error || "Failed to delete item";
        notify(errMsg);
      }
    } catch (err: any) {
      notify(err.message || "Error deleting dish");
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = items.filter(
    (item) =>
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.category.toLowerCase().includes(search.toLowerCase()) ||
      item.id.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-5 right-5 z-50 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium animate-in fade-in slide-in-from-top-2">
          <Sparkles className="size-4 shrink-0" />
          <span>{notification}</span>
        </div>
      )}

      {/* Admin Sub-navigation: Live Orders (KDS) vs Menu Items */}
      <div className="flex items-center gap-2 border-b pb-3">
        <button
          type="button"
          onClick={() => setAdminView("live-orders")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
            adminView === "live-orders"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="relative flex size-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full size-2 bg-green-500"></span>
          </span>
          <span>Live Orders & KDS</span>
        </button>

        <button
          type="button"
          onClick={() => setAdminView("menu")}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
            adminView === "menu"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          <UtensilsCrossed className="size-3.5" />
          <span>Menu Management ({items.length})</span>
        </button>
      </div>

      {adminView === "live-orders" ? (
        <AdminLiveOrders />
      ) : (
        <>
          {/* Header and Controls */}
          <Card className="border">
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <UtensilsCrossed className="size-5 text-primary" />
                  <CardTitle className="text-xl">
                    Menu Management (Admin)
                  </CardTitle>
                </div>
                <CardDescription className="text-xs mt-1">
                  Create, update, or remove dishes directly in the database.
                  Changes immediately reflect in the customer UI and Voice
                  Agent.
                </CardDescription>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchAdminMenu}
                  disabled={loading}
                  className="gap-1.5 text-xs"
                >
                  <RefreshCw
                    className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                  />
                  Refresh
                </Button>
                <Button
                  size="sm"
                  onClick={handleOpenCreate}
                  className="gap-1.5 text-xs"
                >
                  <Plus className="size-4" />
                  Add New Dish
                </Button>
              </div>
            </CardHeader>

            <CardContent className="pt-0">
              <div className="relative max-w-sm mb-4">
                <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by name, category, or ID..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 text-xs"
                />
              </div>

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Image</TableHead>
                      <TableHead>Dish Name & Slug</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Price</TableHead>
                      <TableHead className="max-w-xs">Description</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center py-8 text-muted-foreground text-xs"
                        >
                          No menu items found. Click &quot;Add New Dish&quot; to
                          create one.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="size-12 rounded-lg bg-muted overflow-hidden flex items-center justify-center">
                              {item.imageUrl ? (
                                <img
                                  src={item.imageUrl}
                                  alt={item.name}
                                  className="size-full object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display =
                                      "none";
                                  }}
                                />
                              ) : (
                                <UtensilsCrossed className="size-5 text-muted-foreground/50" />
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="font-semibold text-sm leading-tight">
                              {item.name}
                            </div>
                            <code className="text-[11px] font-mono text-muted-foreground">
                              {item.id}
                            </code>
                          </TableCell>

                          <TableCell>
                            <Badge variant="secondary" className="text-xs">
                              {item.category}
                            </Badge>
                          </TableCell>

                          <TableCell className="font-mono font-bold text-primary text-sm">
                            ${item.price.toFixed(2)}
                          </TableCell>

                          <TableCell className="max-w-xs text-xs text-muted-foreground truncate">
                            {item.description || "—"}
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => handleOpenEdit(item)}
                                title="Edit dish"
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="text-destructive hover:text-destructive"
                                onClick={() => handleDelete(item)}
                                title="Delete dish"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* CREATE DISH DIALOG */}
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Plus className="size-4 text-primary" />
                  Add New Menu Item
                </DialogTitle>
                <DialogDescription>
                  Create a dish entry in the database. Slug ID will
                  auto-generate from the name.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleCreateSubmit} className="space-y-3.5 py-2">
                <div>
                  <label
                    htmlFor="create-dish-name"
                    className="text-xs font-medium text-foreground block mb-1"
                  >
                    Dish Name *
                  </label>
                  <Input
                    id="create-dish-name"
                    placeholder="e.g. Smoky Truffle Burger"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="create-dish-price"
                      className="text-xs font-medium text-foreground block mb-1"
                    >
                      Price ($) *
                    </label>
                    <Input
                      id="create-dish-price"
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="12.99"
                      value={formData.price}
                      onChange={(e) =>
                        setFormData({ ...formData, price: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="create-dish-category"
                      className="text-xs font-medium text-foreground block mb-1"
                    >
                      Category
                    </label>
                    <select
                      id="create-dish-category"
                      value={formData.category}
                      onChange={(e) =>
                        setFormData({ ...formData, category: e.target.value })
                      }
                      className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="create-dish-desc"
                    className="text-xs font-medium text-foreground block mb-1"
                  >
                    Description
                  </label>
                  <Textarea
                    id="create-dish-desc"
                    placeholder="Ingredients, toppings, or preparation details..."
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    className="text-xs h-20"
                  />
                </div>

                <div>
                  <label
                    htmlFor="create-dish-image"
                    className="text-xs font-medium text-foreground block mb-1"
                  >
                    Image URL (optional)
                  </label>
                  <Input
                    id="create-dish-image"
                    placeholder="https://images.unsplash.com/..."
                    value={formData.imageUrl}
                    onChange={(e) =>
                      setFormData({ ...formData, imageUrl: e.target.value })
                    }
                  />
                </div>

                <div>
                  <label
                    htmlFor="create-dish-id"
                    className="text-xs font-medium text-muted-foreground block mb-1"
                  >
                    Custom Slug ID (optional)
                  </label>
                  <Input
                    id="create-dish-id"
                    placeholder="auto-generated from name if left empty"
                    value={formData.id}
                    onChange={(e) =>
                      setFormData({ ...formData, id: e.target.value })
                    }
                    className="font-mono text-xs"
                  />
                </div>

                <DialogFooter className="pt-2">
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => setIsCreateOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={loading}>
                    {loading ? "Creating..." : "Create Dish"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* EDIT DISH DIALOG */}
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Pencil className="size-4 text-primary" />
                  Edit Menu Item
                </DialogTitle>
                <DialogDescription>
                  Update details for item{" "}
                  <code className="font-mono font-bold text-foreground">
                    {editingItem?.id}
                  </code>
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleEditSubmit} className="space-y-3.5 py-2">
                <div>
                  <label
                    htmlFor="edit-dish-name"
                    className="text-xs font-medium text-foreground block mb-1"
                  >
                    Dish Name *
                  </label>
                  <Input
                    id="edit-dish-name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="edit-dish-price"
                      className="text-xs font-medium text-foreground block mb-1"
                    >
                      Price ($) *
                    </label>
                    <Input
                      id="edit-dish-price"
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={formData.price}
                      onChange={(e) =>
                        setFormData({ ...formData, price: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="edit-dish-category"
                      className="text-xs font-medium text-foreground block mb-1"
                    >
                      Category
                    </label>
                    <select
                      id="edit-dish-category"
                      value={formData.category}
                      onChange={(e) =>
                        setFormData({ ...formData, category: e.target.value })
                      }
                      className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="edit-dish-desc"
                    className="text-xs font-medium text-foreground block mb-1"
                  >
                    Description
                  </label>
                  <Textarea
                    id="edit-dish-desc"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    className="text-xs h-20"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-dish-image"
                    className="text-xs font-medium text-foreground block mb-1"
                  >
                    Image URL
                  </label>
                  <Input
                    id="edit-dish-image"
                    value={formData.imageUrl}
                    onChange={(e) =>
                      setFormData({ ...formData, imageUrl: e.target.value })
                    }
                  />
                </div>

                <DialogFooter className="pt-2">
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => setIsEditOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={loading}>
                    {loading ? "Saving..." : "Save Changes"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
