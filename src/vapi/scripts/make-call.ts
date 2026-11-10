import { VapiClient } from "@vapi-ai/server-sdk";
import * as dotenv from "dotenv";

dotenv.config();

// Initialize Vapi client
// You can set VAPI_API_KEY in .env or replace the placeholder below
const apiKey = process.env.VAPI_API_KEY || "your-vapi-api-key";

const vapi = new VapiClient({
  token: apiKey,
});

async function makeCall() {
  console.log("Initiating outbound phone call via Vapi...");

  try {
    const call = await vapi.calls.create({
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || "your-phone-number-id",
      customer: {
        number: process.env.CUSTOMER_PHONE_NUMBER || "+15551234567",
      },
      // You can pass assistant object or assistantId directly
      assistantId: process.env.VAPI_ASSISTANT_ID || "your-assistant-id",
    } as any);

    console.log("Call dispatched successfully!");
    console.log("Call details:", call);
  } catch (error: any) {
    console.error("Failed to make phone call:");
    if (error.response?.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message || error);
    }
  }
}

makeCall();
