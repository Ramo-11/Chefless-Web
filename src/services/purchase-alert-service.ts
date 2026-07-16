import { env } from "../lib/env";
import { sendEmail, escapeHtml } from "../lib/email";
import { logger } from "../lib/logger";

export interface PremiumPurchaseAlertInput {
  email?: string;
  fullName?: string;
  plan?: "monthly" | "annual";
  productId?: string;
  price?: number | null;
  currency?: string | null;
  store?: string | null;
  expiresAt?: Date | null;
}

/**
 * Emails the owner when a user starts a premium subscription. Fired from the
 * RevenueCat webhook on INITIAL_PURCHASE only. Never throws: a mail failure
 * must not fail the webhook response, or RevenueCat retries the event forever.
 */
export async function sendPremiumPurchaseAlert(
  input: PremiumPurchaseAlertInput
): Promise<void> {
  try {
    const who = input.fullName || input.email || "Unknown user";
    const plan = input.plan ?? "unknown";
    const price =
      input.price != null
        ? `${input.price.toFixed(2)} ${input.currency ?? "USD"}`
        : "unknown";
    const store = input.store ?? "unknown";
    const renewsAt = input.expiresAt
      ? input.expiresAt.toISOString().replace("T", " ").slice(0, 16) + " UTC"
      : "unknown";

    const subject = `[Chefless] New premium purchase: ${who} (${plan})`;

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.5;color:#1a1a1a;max-width:640px;">
        <h2 style="margin:0 0 8px;font-size:18px;">New premium purchase</h2>
        <p style="margin:0 0 16px;color:#555;">A user just subscribed to Chefless Premium.</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          <tr><td style="padding:6px 0;color:#888;width:140px;">Name</td><td>${escapeHtml(input.fullName ?? "unknown")}</td></tr>
          <tr><td style="padding:6px 0;color:#888;">Email</td><td>${escapeHtml(input.email ?? "unknown")}</td></tr>
          <tr><td style="padding:6px 0;color:#888;">Plan</td><td>${escapeHtml(plan)}</td></tr>
          <tr><td style="padding:6px 0;color:#888;">Product</td><td>${escapeHtml(input.productId ?? "unknown")}</td></tr>
          <tr><td style="padding:6px 0;color:#888;">Price</td><td>${escapeHtml(price)}</td></tr>
          <tr><td style="padding:6px 0;color:#888;">Store</td><td>${escapeHtml(store)}</td></tr>
          <tr><td style="padding:6px 0;color:#888;">Renews</td><td>${escapeHtml(renewsAt)}</td></tr>
        </table>
      </div>
    `;

    const text = [
      "New Chefless premium purchase",
      "",
      `Name: ${input.fullName ?? "unknown"}`,
      `Email: ${input.email ?? "unknown"}`,
      `Plan: ${plan}`,
      `Product: ${input.productId ?? "unknown"}`,
      `Price: ${price}`,
      `Store: ${store}`,
      `Renews: ${renewsAt}`,
    ].join("\n");

    await sendEmail({ to: env.ALERT_EMAIL_TO, subject, html, text });
  } catch (err) {
    logger.error({ err }, "Failed to send premium purchase alert");
  }
}
