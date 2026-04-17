import { logger } from '../utils/logger';

export interface ThreadsTweet {
  id: string;
  text: string;
  authorId?: string;
  likeCount?: number;
  replyCount?: number;
}

export class ThreadsApiClient {
  private readonly baseUrl = 'https://graph.threads.net/v1.0';

  constructor(private readonly accessToken: string) {}

  async getMentions(userId: string = 'me'): Promise<ThreadsTweet[]> {
    try {
      const url = `${this.baseUrl}/${userId}/mentions?fields=id,text,username&access_token=${this.accessToken}`;
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        logger.warn({ status: response.status, body: body.slice(0, 200) }, 'Threads mentions API error detail');
        throw new Error(`Mentions fetch failed HTTP ${response.status}`);
      }
      const data = await response.json() as any;
      return (data.data || []).map((t: any) => ({
        id: t.id,
        text: t.text || '',
        authorId: t.username || 'unknown',
        likeCount: 0,
        replyCount: 0
      }));
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to fetch Threads mentions via Graph API');
      return [];
    }
  }

  async searchTimeline(query: string): Promise<ThreadsTweet[]> {
    try {
      // Official Threads keyword search endpoint: GET /keyword_search
      const url = `${this.baseUrl}/keyword_search?q=${encodeURIComponent(query)}&search_type=RECENT&fields=id,text,username&access_token=${this.accessToken}`;
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        logger.warn({ status: response.status, body: body.slice(0, 200) }, 'Threads search API error detail');
        throw new Error(`Search fetch failed HTTP ${response.status}`);
      }
      const data = await response.json() as any;
      return (data.data || []).map((t: any) => ({
        id: t.id,
        text: t.text || '',
        authorId: t.username || 'unknown',
        likeCount: 0
      }));
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to fetch Threads keyword search via Graph API');
      return [];
    }
  }

  async reply(text: string, targetMediaId: string, userId: string = 'me'): Promise<void> {
    try {
      // 1. Create a reply container
      const createUrl = `${this.baseUrl}/${userId}/threads`;
      const body = new URLSearchParams({
        media_type: 'TEXT',
        text: text,
        reply_to_id: targetMediaId,
        access_token: this.accessToken
      });
      const createRes = await fetch(createUrl, { method: 'POST', body, headers: { 'Content-type': 'application/x-www-form-urlencoded' }});
      if (!createRes.ok) {
        const detail = await createRes.text().catch(() => '');
        throw new Error(`Failed to create reply container: HTTP ${createRes.status} ${detail.slice(0, 200)}`);
      }
      
      const container = await createRes.json() as any;
      if (!container.id) throw new Error('Reply container returned no ID');

      // 2. Publish the container
      const publishUrl = `${this.baseUrl}/${userId}/threads_publish`;
      const publishBody = new URLSearchParams({
        creation_id: container.id,
        access_token: this.accessToken
      });
      const publishRes = await fetch(publishUrl, { method: 'POST', body: publishBody, headers: { 'Content-type': 'application/x-www-form-urlencoded' } });
      if (!publishRes.ok) {
        const detail = await publishRes.text().catch(() => '');
        throw new Error(`Failed to publish reply: HTTP ${publishRes.status} ${detail.slice(0, 200)}`);
      }

      logger.info({ targetMediaId }, 'Threads reply published successfully');
    } catch (error: any) {
      logger.warn({ error: error.message, targetMediaId }, 'Failed to execute Threads reply');
      throw error;
    }
  }
}
