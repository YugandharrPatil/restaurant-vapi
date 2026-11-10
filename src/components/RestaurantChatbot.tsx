"use client";

import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { AssistantModal } from "@/components/assistant-ui/elements/assistant-modal.aui";
import { DefaultChatTransport } from "ai";
import { useMemo } from "react";

interface RestaurantChatbotProps {
  cartId: string;
  customerName?: string;
  onCartUpdated?: () => void;
}

export default function RestaurantChatbot({
  cartId,
  customerName = "Chat Guest",
  onCartUpdated,
}: RestaurantChatbotProps) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: {
          cartId,
          customerName,
        },
      }),
    [cartId, customerName],
  );

  const runtime = useChatRuntime({
    transport,
    onFinish: () => {
      onCartUpdated?.();
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantModal />
    </AssistantRuntimeProvider>
  );
}
