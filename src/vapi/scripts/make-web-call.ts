import * as dotenv from "dotenv";

dotenv.config();

// Vapi requires the PUBLIC key for web calls (POST https://api.vapi.ai/call/web)
// You can find your Public Key in Vapi Dashboard -> Account -> API Keys
const publicKey = process.env.VAPI_PUBLIC_KEY || process.env.VAPI_API_KEY;
const assistantId = process.env.VAPI_ASSISTANT_ID;

async function makeWebCall() {
  console.log("Initiating web call via Vapi...");
  console.log(`Using Assistant ID: ${assistantId}`);

  if (!assistantId) {
    console.error("Error: VAPI_ASSISTANT_ID is not set in .env");
    return;
  }

  try {
    const res = await fetch("https://api.vapi.ai/call/web", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${publicKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistantId,
      }),
    });

    const data: any = await res.json();

    if (!res.ok) {
      if (
        data.message?.includes("private key instead of the public key") ||
        res.status === 401
      ) {
        console.error("\n⚠️ Vapi Error: Invalid Key Type");
        console.error(
          "Web calls require your Vapi PUBLIC KEY (not private key).",
        );
        console.error(
          "👉 Grab your Public Key from: https://dashboard.vapi.ai/account",
        );
        console.error(
          '👉 Add it to .env as: VAPI_PUBLIC_KEY="your-public-key"\n',
        );
      } else {
        console.error("Vapi Error:", data);
      }
      return;
    }

    console.log("\n✅ Web call created successfully!");
    console.log(`Call ID: ${data.id}`);

    if (data.webCallUrl) {
      console.log("\n🔗 Open this URL in your browser to talk to your agent:");
      console.log(`\x1b[36m${data.webCallUrl}\x1b[0m\n`);
    } else {
      console.log("Response:", data);
    }
  } catch (error: any) {
    console.error("Failed to create web call:", error.message || error);
  }
}

makeWebCall();
