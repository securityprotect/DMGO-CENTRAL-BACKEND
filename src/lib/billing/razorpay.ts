import crypto from 'crypto';

const RAZORPAY_API = 'https://api.razorpay.com/v1';

export function getRazorpayCreds() {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
  return { keyId, keySecret };
}

export function razorpayConfigured() {
  const { keyId, keySecret } = getRazorpayCreds();
  return Boolean(keyId && keySecret);
}

function authHeader() {
  const { keyId, keySecret } = getRazorpayCreds();
  return 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
}

/**
 * Create a Razorpay Order. `amountInRupees` is converted to paise here — the
 * only place the conversion happens, so callers always pass human rupees.
 */
export async function createRazorpayOrder(params: {
  amountInRupees: number;
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  const currency = params.currency || process.env.RAZORPAY_CURRENCY || 'INR';
  const res = await fetch(`${RAZORPAY_API}/orders`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(params.amountInRupees * 100),
      currency,
      receipt: params.receipt,
      notes: params.notes || {},
    }),
  });

  const data = await res.json();
  if (!res.ok || !data?.id) {
    const message = data?.error?.description || 'Failed to create Razorpay order';
    throw new Error(message);
  }
  return data as RazorpayOrder;
}

/**
 * Verify the signature returned by Razorpay Checkout on the client.
 * HMAC-SHA256( order_id + "|" + payment_id, key_secret ).
 */
export function verifyCheckoutSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const { keySecret } = getRazorpayCreds();
  if (!keySecret) return false;
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${params.orderId}|${params.paymentId}`)
    .digest('hex');
  return timingSafeEqual(expected, params.signature);
}

/**
 * Verify a Razorpay Webhook signature.
 * HMAC-SHA256( rawBody, webhook_secret ).
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqual(expected, signature);
}

/**
 * Fetch a payment entity from Razorpay (contains email, contact, method, etc.).
 * Returns null on any failure — callers treat contact details as best-effort.
 */
export async function fetchRazorpayPayment(paymentId: string): Promise<Record<string, any> | null> {
  if (!paymentId) return null;
  try {
    const res = await fetch(`${RAZORPAY_API}/payments/${paymentId}`, {
      headers: { Authorization: authHeader() },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, any>;
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
