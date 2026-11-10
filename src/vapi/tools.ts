import type { Vapi } from "@vapi-ai/server-sdk";

const ngrokUrl =
  process.env.NGROK_URL ||
  process.env.NROK_URL ||
  "https://waffle-justice-gem.ngrok-free.dev";

const ngrokHeaders: Vapi.JsonSchema = {
  type: "object",
  properties: {
    "ngrok-skip-browser-warning": {
      type: "string",
      description: "Header to skip ngrok browser interstitial warning",
    },
  },
};
export const TOOL_DEFINITIONS: Vapi.CreateToolsRequest.ApiRequest[] = [
  {
    type: "apiRequest",
    name: "get_menu",
    description:
      "Get the full restaurant menu including all available dishes, prices, and IDs.",
    url: `${ngrokUrl}/api/getMenu`,
    method: "GET",
    headers: ngrokHeaders,
  },
  {
    type: "apiRequest",
    name: "create_cart",
    description:
      "Create a new order cart session when asking the customer's name.",
    url: `${ngrokUrl}/api/createCart`,
    method: "POST",
    headers: ngrokHeaders,
    body: {
      type: "object",
      properties: {
        cartId: {
          type: "string",
          description: "Optional existing cartId if already established",
        },
        customerName: {
          type: "string",
          description: "Name of the customer for the order",
        },
      },
    },
  },
  {
    type: "apiRequest",
    name: "update_cart",
    description:
      "Surgically add items, remove items, or clear cart in a single batch request. Supports complex multi-item instructions.",
    url: `${ngrokUrl}/api/updateCart`,
    method: "POST",
    headers: ngrokHeaders,
    body: {
      type: "object",
      required: ["actions"],
      properties: {
        cartId: {
          type: "string",
          description: "The cart ID for this session",
        },
        actions: {
          type: "array",
          description: "List of operations to execute atomically on the cart",
          items: {
            type: "object",
            required: ["operation"],
            properties: {
              operation: {
                type: "string",
                enum: ["addItem", "removeItem", "clearCart"],
                description:
                  "addItem to add/increment, removeItem to decrement/remove, clearCart to empty the cart",
              },
              itemId: {
                type: "string",
                description:
                  "The menu item ID (e.g. classic-cheeseburger, crispy-fries, classic-coke)",
              },
              quantity: {
                type: "number",
                description:
                  "Quantity of this item to add or remove (defaults to 1)",
              },
            },
          },
        },
      },
    },
  },
  {
    type: "apiRequest",
    name: "get_cart",
    description: "Retrieve the current items and total amount in the cart.",
    url: `${ngrokUrl}/api/getCart`,
    method: "POST",
    headers: ngrokHeaders,
    body: {
      type: "object",
      properties: {
        cartId: {
          type: "string",
          description: "The cart ID to retrieve",
        },
      },
    },
  },
  {
    type: "apiRequest",
    name: "place_order",
    description:
      "Finalize and place the order once the customer confirms their cart.",
    url: `${ngrokUrl}/api/placeOrder`,
    method: "POST",
    headers: ngrokHeaders,
    body: {
      type: "object",
      properties: {
        cartId: {
          type: "string",
          description: "The cart ID to place the order for",
        },
        customerName: {
          type: "string",
          description: "Customer name for the order receipt",
        },
      },
    },
  },
];
