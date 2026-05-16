import { NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb';
import { InstagramAccount } from '@/lib/models/InstagramAccount';

export async function GET(req: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('accountId');
  if (!accountId) return NextResponse.json({ reels: [] });

  await connectToDatabase();
  const account = await InstagramAccount.findOne({ _id: accountId, userId: user._id }).lean();
  if (!account) return NextResponse.json({ reels: [] });

  const graphVersion = process.env.META_GRAPH_VERSION || 'v20.0';
  const fields = 'id,caption,permalink,media_type,media_product_type,thumbnail_url,media_url,timestamp';

  const fetchAllMedia = async (initialUrl: string) => {
    const allItems: any[] = [];
    let url: string | null = initialUrl;
    let pages = 0;

    while (url && pages < 6) {
      const response: Response = await fetch(url);
      const data: any = await response.json();
      if (!response.ok) return { ok: false, items: [] as any[] };

      allItems.push(...(data.data || []));
      url = data?.paging?.next || null;
      pages += 1;
    }

    return { ok: true, items: allItems };
  };

  const primaryUrl = `https://graph.facebook.com/${graphVersion}/${account.igUserId}/media?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(account.accessToken)}`;
  let result = await fetchAllMedia(primaryUrl);

  if (!result.ok) {
    const fallbackUrl = `https://graph.instagram.com/me/media?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(account.accessToken)}`;
    result = await fetchAllMedia(fallbackUrl);
  }

  if (!result.ok) return NextResponse.json({ reels: [] });

  const reels = result.items
    .filter((item: any) => {
      const permalink = String(item.permalink || '').toLowerCase();
      const mediaType = String(item.media_type || '').toUpperCase();
      const productType = String(item.media_product_type || '').toUpperCase();
      return productType === 'REELS' || mediaType === 'REEL' || mediaType === 'VIDEO' || permalink.includes('/reel/');
    })
    .map((item: any) => ({
      id: item.id,
      caption: item.caption || 'Untitled reel',
      permalink: item.permalink,
      thumbnailUrl: item.thumbnail_url || item.media_url || '',
      timestamp: item.timestamp,
    }))
    .filter((item: any, index: number, arr: any[]) => arr.findIndex((x) => x.id === item.id) === index)
    .sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

  return NextResponse.json({ reels });
}
