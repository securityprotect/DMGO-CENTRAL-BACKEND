import { NextResponse } from 'next/server';

async function createPaymentLink(planId: string, amount: number) {
  if (!planId || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false as const, status: 400, body: { error: 'Invalid plan or amount' } };
  }

  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
  const currency = process.env.RAZORPAY_CURRENCY || 'INR';
  const callbackUrl =
    process.env.RAZORPAY_CALLBACK_URL || `${process.env.WEB_URL || 'http://localhost:4028'}/payment/callback`;

  if (!keyId || !keySecret) {
    return {
      ok: false as const,
      status: 500,
      body: {
        error: 'Razorpay credentials are missing. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
      },
    };
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const payload = {
    amount: Math.round(amount * 100),
    currency,
    description: `DmGo ${planId} subscription`,
    callback_url: callbackUrl,
    callback_method: 'get',
  };

  try {
    const response = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok || !data?.short_url) {
      return {
        ok: false as const,
        status: 400,
        body: { error: 'Unable to create Razorpay payment link', raw: data },
      };
    }

    return {
      ok: true as const,
      status: 200,
      body: { checkoutUrl: data.short_url as string, id: data.id as string },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payment link creation failed';
    return { ok: false as const, status: 500, body: { error: message } };
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const planId = String(body?.planId || '').trim();
  const amount = Number(body?.amount || 0);
  const result = await createPaymentLink(planId, amount);
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const planId = String(url.searchParams.get('planId') || '').trim();
  const amount = Number(url.searchParams.get('amount') || 0);
  const result = await createPaymentLink(planId, amount);

  if (!result.ok) {
    const message = encodeURIComponent(String((result.body as { error?: string }).error || 'Payment init failed'));
    const webUrl = (process.env.WEB_URL || 'http://localhost:4028').trim();
    return NextResponse.redirect(`${webUrl}/#pricing?paymentError=${message}`, { status: 303 });
  }

  return NextResponse.redirect((result.body as { checkoutUrl: string }).checkoutUrl, { status: 303 });
}

