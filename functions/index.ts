// IVX Twilio verification + SMS send — reads credentials from Rork platform private env
// No credentials are written to files, git, or logs.

interface Env {
  IVX_TWILIO_ACCOUNT_SID?: string;
  IVX_TWILIO_AUTH_TOKEN?: string;
  IVX_TWILIO_MESSAGING_SERVICE_SID?: string;
  IVX_TWILIO_FROM_PHONE?: string;
}

const OWNER_PHONE = "+15616443503";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ping") {
      return Response.json({ ok: true, now: new Date().toISOString() });
    }

    // ── Step 1: Verify Twilio auth by fetching account ──
    if (url.pathname === "/verify-and-send") {
      const accountSid = env.IVX_TWILIO_ACCOUNT_SID?.trim();
      const authToken = env.IVX_TWILIO_AUTH_TOKEN?.trim();
      const messagingServiceSid = env.IVX_TWILIO_MESSAGING_SERVICE_SID?.trim();
      const fromPhone = env.IVX_TWILIO_FROM_PHONE?.trim();

      if (!accountSid || !authToken) {
        return Response.json({
          ok: false,
          step: "credential_check",
          error: "Twilio Account SID or Auth Token not found in platform env",
        }, { status: 400 });
      }

      const authHeader = "Basic " + btoa(`${accountSid}:${authToken}`);

      // 1) Verify auth
      const acctRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
        { headers: { Authorization: authHeader } }
      );

      if (!acctRes.ok) {
        const errText = await acctRes.text();
        return Response.json({
          ok: false,
          step: "auth_verification",
          httpStatus: acctRes.status,
          accountSidPrefix: accountSid.slice(0, 6),
          authTokenLength: authToken.length,
          error: errText.slice(0, 300),
          message: "Twilio rejected this auth token. It may be stale or revoked. Please generate a fresh Auth Token in Twilio Console > Settings > API keys & tokens.",
        }, { status: 401 });
      }

      const account = await acctRes.json();

      // 2) Send SMS to owner
      const smsBody = "IVX AI Verification: Autonomous work report SMS system is LIVE. " +
        "Twilio integration confirmed end-to-end. " +
        `Account: ${account.friendly_name || account.status}. ` +
        `Timestamp: ${new Date().toISOString()}`;

      const params = new URLSearchParams();
      params.append("To", OWNER_PHONE);
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
      params.append("Body", smsBody);

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
        const sms = JSON.parse(smsText);
        return Response.json({
          ok: true,
          step: "sms_sent",
          accountStatus: account.status,
          accountFriendlyName: account.friendly_name,
          messageSid: sms.sid,
          messageStatus: sms.status,
          to: sms.to,
          from: sms.from || messagingServiceSid?.slice(0, 6) + "...",
          body: smsBody,
          timestamp: new Date().toISOString(),
        });
      }

      return Response.json({
        ok: false,
        step: "sms_send",
        accountStatus: account.status,
        httpStatus: smsRes.status,
        error: smsText.slice(0, 500),
      }, { status: smsRes.status });
    }

    return Response.json({ ok: true });
  },
};
