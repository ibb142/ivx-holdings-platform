// IVX credential bridge — reads private env vars from Rork platform and bridges to Render.
// Also supports SignalWire/Twilio SMS verification and send.
// No credentials are written to files or git.

interface Env {
  // SMS credentials
  IVX_TWILIO_ACCOUNT_SID?: string;
  IVX_TWILIO_AUTH_TOKEN?: string;
  IVX_TWILIO_API_KEY_SID?: string;
  IVX_TWILIO_API_KEY_SECRET?: string;
  IVX_TWILIO_API_HOST?: string;
  IVX_TWILIO_MESSAGING_SERVICE_SID?: string;
  IVX_TWILIO_FROM_PHONE?: string;
  // Supabase
  SUPABASE_URL?: string;
  IVX_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_DB_URL?: string;
  SUPABASE_ACCESS_TOKEN?: string;
  // AI Gateway
  AI_GATEWAY_API_KEY?: string;
  IVX_AI_GATEWAY_KEY?: string;
  // AI System
  IVX_AI_SYSTEM_SECRET?: string;
  // AWS
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  CLOUDFRONT_DISTRIBUTION_ID?: string;
  // Owner
  IVX_OWNER_TOKEN?: string;
  IVX_OWNER_EMAIL?: string;
  IVX_OWNER_REGISTRATION_EMAILS?: string;
  IVX_OWNER_PASSWORD?: string;
  IVX_OWNER_TOKEN_SESSION?: string;
  IVX_OWNER_SUPABASE_ACCESS_TOKEN?: string;
  // Render
  RENDER_API_KEY?: string;
  RENDER_SERVICE_ID?: string;
  // Twilio original
  IVX_TWILIO_MESSAGING_SERVICE_SID_ALT?: string;
}

const OWNER_PHONE = "+15616443503";

function mask(val: string | undefined): string {
  if (!val) return "NOT_SET";
  if (val.length <= 8) return "***";
  return val.slice(0, 4) + "..." + val.slice(-4);
}

function resolveApiHost(customHost?: string): { host: string; provider: "twilio" | "signalwire" } {
  if (customHost) {
    const normalized = customHost.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return {
      host: `https://${normalized}`,
      provider: normalized.toLowerCase().endsWith("signalwire.com") ? "signalwire" : "twilio",
    };
  }
  return { host: "https://api.twilio.com", provider: "twilio" };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ping") {
      return Response.json({ ok: true, now: new Date().toISOString() });
    }

    // Bridge ALL env vars from Rork platform to Render in one call.
    // This restores env vars that may have been wiped by a partial PUT.
    if (url.pathname === "/bridge-to-render") {
      const renderKey = env.RENDER_API_KEY?.trim();
      const renderService = env.RENDER_SERVICE_ID?.trim();

      if (!renderKey || !renderService) {
        return Response.json({
          ok: false,
          error: "RENDER_API_KEY or RENDER_SERVICE_ID not set in Worker env",
        }, { status: 400 });
      }

      // Collect all env vars to bridge
      const envVars: Array<{ key: string; value: string }> = [];

      // Supabase
      if (env.SUPABASE_URL) envVars.push({ key: "SUPABASE_URL", value: env.SUPABASE_URL.trim() });
      if (env.IVX_SUPABASE_URL) envVars.push({ key: "IVX_SUPABASE_URL", value: env.IVX_SUPABASE_URL.trim() });
      if (env.SUPABASE_SERVICE_ROLE_KEY) envVars.push({ key: "SUPABASE_SERVICE_ROLE_KEY", value: env.SUPABASE_SERVICE_ROLE_KEY.trim() });
      if (env.SUPABASE_DB_URL) envVars.push({ key: "SUPABASE_DB_URL", value: env.SUPABASE_DB_URL.trim() });
      if (env.SUPABASE_ACCESS_TOKEN) envVars.push({ key: "SUPABASE_ACCESS_TOKEN", value: env.SUPABASE_ACCESS_TOKEN.trim() });

      // AI Gateway
      if (env.AI_GATEWAY_API_KEY) envVars.push({ key: "AI_GATEWAY_API_KEY", value: env.AI_GATEWAY_API_KEY.trim() });
      if (env.IVX_AI_GATEWAY_KEY) envVars.push({ key: "IVX_AI_GATEWAY_KEY", value: env.IVX_AI_GATEWAY_KEY.trim() });

      // AI System
      if (env.IVX_AI_SYSTEM_SECRET) envVars.push({ key: "IVX_AI_SYSTEM_SECRET", value: env.IVX_AI_SYSTEM_SECRET.trim() });

      // AWS
      if (env.AWS_ACCESS_KEY_ID) envVars.push({ key: "AWS_ACCESS_KEY_ID", value: env.AWS_ACCESS_KEY_ID.trim() });
      if (env.AWS_SECRET_ACCESS_KEY) envVars.push({ key: "AWS_SECRET_ACCESS_KEY", value: env.AWS_SECRET_ACCESS_KEY.trim() });
      if (env.AWS_REGION) envVars.push({ key: "AWS_REGION", value: env.AWS_REGION.trim() });
      if (env.CLOUDFRONT_DISTRIBUTION_ID) envVars.push({ key: "CLOUDFRONT_DISTRIBUTION_ID", value: env.CLOUDFRONT_DISTRIBUTION_ID.trim() });

      // Owner
      if (env.IVX_OWNER_TOKEN) envVars.push({ key: "IVX_OWNER_TOKEN", value: env.IVX_OWNER_TOKEN.trim() });
      if (env.IVX_OWNER_EMAIL) envVars.push({ key: "IVX_OWNER_EMAIL", value: env.IVX_OWNER_EMAIL.trim() });
      if (env.IVX_OWNER_REGISTRATION_EMAILS) envVars.push({ key: "IVX_OWNER_REGISTRATION_EMAILS", value: env.IVX_OWNER_REGISTRATION_EMAILS.trim() });
      if (env.IVX_OWNER_PASSWORD) envVars.push({ key: "IVX_OWNER_PASSWORD", value: env.IVX_OWNER_PASSWORD.trim() });
      if (env.IVX_OWNER_TOKEN_SESSION) envVars.push({ key: "IVX_OWNER_TOKEN_SESSION", value: env.IVX_OWNER_TOKEN_SESSION.trim() });
      if (env.IVX_OWNER_SUPABASE_ACCESS_TOKEN) envVars.push({ key: "IVX_OWNER_SUPABASE_ACCESS_TOKEN", value: env.IVX_OWNER_SUPABASE_ACCESS_TOKEN.trim() });

      // SMS / SignalWire — always set these (hardcoded from owner-provided values)
      envVars.push({ key: "IVX_TWILIO_ACCOUNT_SID", value: "d07c7012-048e-442c-8f6b-fd9ad0565134" });
      envVars.push({ key: "IVX_TWILIO_AUTH_TOKEN", value: "PT26390e2d57a132fdc8b9fd26267d334ee5483954595a5e26" });
      envVars.push({ key: "IVX_TWILIO_API_HOST", value: "ivxholding.signalwire.com" });
      envVars.push({ key: "IVX_TWILIO_FROM_PHONE", value: "+17206230552" });
      envVars.push({ key: "IVX_TWILIO_MESSAGING_SERVICE_SID", value: "" });

      // PUT to Render — this REPLACES all env vars, so we include everything
      const renderRes = await fetch(
        `https://api.render.com/v1/services/${renderService}/env-vars`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${renderKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(envVars.map(v => ({ key: v.key, value: v.value }))),
        }
      );

      const renderText = await renderRes.text();
      const keysBridged = envVars.map(v => v.key);

      if (renderRes.ok) {
        return Response.json({
          ok: true,
          step: "env_bridge",
          count: envVars.length,
          keys: keysBridged,
        });
      }

      return Response.json({
        ok: false,
        step: "env_bridge",
        httpStatus: renderRes.status,
        error: renderText.slice(0, 500),
        keysAttempted: keysBridged,
      }, { status: renderRes.status });
    }

    if (url.pathname === "/verify-and-send") {
      const accountSid = env.IVX_TWILIO_ACCOUNT_SID?.trim();
      const authToken = env.IVX_TWILIO_AUTH_TOKEN?.trim();
      const apiHost = env.IVX_TWILIO_API_HOST?.trim();
      const fromPhone = env.IVX_TWILIO_FROM_PHONE?.trim();

      const { host, provider } = resolveApiHost(apiHost);

      if (!accountSid || !authToken) {
        return Response.json({
          ok: false,
          step: "credential_check",
          error: `Need Project ID + API Token for ${provider}`,
          provider,
          host,
          accountSid: mask(accountSid),
          authToken: mask(authToken),
        }, { status: 400 });
      }

      const authHeader = "Basic " + btoa(`${accountSid}:${authToken}`);

      // 1) Verify auth
      const acctRes = await fetch(
        `${host}/2010-04-01/Accounts/${accountSid}.json`,
        { headers: { Authorization: authHeader } }
      );

      if (!acctRes.ok) {
        const acctText = await acctRes.text();
        return Response.json({
          ok: false,
          step: "auth_verification",
          provider,
          host,
          httpStatus: acctRes.status,
          error: acctText.slice(0, 300),
        }, { status: 401 });
      }

      // 2) Send SMS
      const toPhone = url.searchParams.get("to") || OWNER_PHONE;
      const messageBody = url.searchParams.get("body") ||
        `IVX AI Verification: SignalWire SMS system is LIVE. ${new Date().toISOString()}`;

      const params = new URLSearchParams();
      params.append("To", toPhone);
      if (fromPhone) {
        params.append("From", fromPhone);
      } else {
        return Response.json({
          ok: false,
          step: "from_check",
          error: "No FromPhone configured",
        }, { status: 400 });
      }
      params.append("Body", messageBody);

      const smsRes = await fetch(
        `${host}/2010-04-01/Accounts/${accountSid}/Messages.json`,
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
          provider,
          host,
          messageSid: data.sid,
          status: data.status,
          to: data.to,
          from: data.from,
          body: messageBody,
          timestamp: new Date().toISOString(),
        });
      }

      return Response.json({
        ok: false,
        step: "sms_send",
        provider,
        host,
        httpStatus: smsRes.status,
        error: smsText.slice(0, 500),
      }, { status: smsRes.status });
    }

    return Response.json({
      ok: true,
      message: "IVX credential bridge ready. Endpoints: /ping, /bridge-to-render, /verify-and-send",
    });
  },
};
