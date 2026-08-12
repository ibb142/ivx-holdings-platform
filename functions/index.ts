// IVX Twilio API Key verification + SMS send — reads credentials from Rork platform private env
// Supports both Auth Token and API Key auth. No credentials are written to files or git.

interface Env {
  IVX_TWILIO_ACCOUNT_SID?: string;
  IVX_TWILIO_AUTH_TOKEN?: string;
  IVX_TWILIO_API_KEY_SID?: string;
  IVX_TWILIO_API_KEY_SECRET?: string;
  IVX_TWILIO_MESSAGING_SERVICE_SID?: string;
  IVX_TWILIO_FROM_PHONE?: string;
}

const OWNER_PHONE = "+15616443503";

function mask(val: string | undefined): string {
  if (!val) return "NOT_SET";
  if (val.length <= 8) return "***";
  return val.slice(0, 4) + "..." + val.slice(-4);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ping") {
      return Response.json({ ok: true, now: new Date().toISOString() });
    }

    if (url.pathname === "/verify-and-send") {
      const accountSid = env.IVX_TWILIO_ACCOUNT_SID?.trim();
      const authToken = env.IVX_TWILIO_AUTH_TOKEN?.trim();
      const apiKeySid = env.IVX_TWILIO_API_KEY_SID?.trim();
      const apiKeySecret = env.IVX_TWILIO_API_KEY_SECRET?.trim();
      const messagingServiceSid = env.IVX_TWILIO_MESSAGING_SERVICE_SID?.trim();
      const fromPhone = env.IVX_TWILIO_FROM_PHONE?.trim();

      const usingApiKey = Boolean(accountSid && apiKeySid && apiKeySecret);
      const usingAuthToken = Boolean(accountSid && authToken && !usingApiKey);

      if (!accountSid || (!usingApiKey && !usingAuthToken)) {
        return Response.json({
          ok: false,
          step: "credential_check",
          error: "Need Account SID + either Auth Token or API Key SID + Secret",
          accountSid: mask(accountSid),
          authToken: mask(authToken),
          apiKeySid: mask(apiKeySid),
          apiKeySecret: mask(apiKeySecret),
          mode: usingApiKey ? "api_key" : usingAuthToken ? "auth_token" : "none",
        }, { status: 400 });
      }

      const username = usingApiKey ? apiKeySid! : accountSid!;
      const password = usingApiKey ? apiKeySecret! : authToken!;
      const authHeader = "Basic " + btoa(`${username}:${password}`);

      // 1) Verify auth (fetch account info, but using API key auth style)
      const acctRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
        { headers: { Authorization: authHeader } }
      );

      const acctText = await acctRes.text();
      let accountInfo: any = null;
      if (acctRes.ok) {
        accountInfo = JSON.parse(acctText);
      }

      if (!acctRes.ok) {
        return Response.json({
          ok: false,
          step: "auth_verification",
          httpStatus: acctRes.status,
          mode: usingApiKey ? "api_key" : "auth_token",
          accountSid: mask(accountSid),
          username: mask(username),
          passwordLength: password.length,
          error: acctText.slice(0, 300),
          message: usingAuthToken
            ? "Twilio rejected this auth token. It may be stale or rotated. Create an API Key instead."
            : "Twilio rejected this API Key. Check that the SID and secret are correct and the key is not deleted.",
        }, { status: 401 });
      }

      // 2) Send SMS
      const toPhone = url.searchParams.get("to") || OWNER_PHONE;
      const messageBody = url.searchParams.get("body") ||
        `IVX AI Verification: Autonomous work report SMS system is LIVE. Twilio integration confirmed end-to-end. ${new Date().toISOString()}`;

      const params = new URLSearchParams();
      params.append("To", toPhone);
      if (messagingServiceSid) {
        params.append("MessagingServiceSid", messagingServiceSid);
      } else if (fromPhone) {
        params.append("From", fromPhone);
      } else {
        return Response.json({
          ok: false,
          step: "from_check",
          error: "No MessagingServiceSid or FromPhone configured",
        }, { status: 400 });
      }
      params.append("Body", messageBody);

      const smsRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        }
      );

      const smsText = await smsRes.text();

      if (smsRes.ok) {
        const data = JSON.parse(smsText);
        return Response.json({
          ok: true,
          step: "sms_sent",
          mode: usingApiKey ? "api_key" : "auth_token",
          messageSid: data.sid,
          status: data.status,
          to: data.to,
          from: data.from || messagingServiceSid,
          body: messageBody,
          timestamp: new Date().toISOString(),
        });
      }

      return Response.json({
        ok: false,
        step: "sms_send",
        mode: usingApiKey ? "api_key" : "auth_token",
        httpStatus: smsRes.status,
        error: smsText.slice(0, 500),
      }, { status: smsRes.status });
    }

    return Response.json({ ok: true, message: "IVX Twilio Worker ready. Use /verify-and-send?to=+15616443503 to test." });
  },
};
