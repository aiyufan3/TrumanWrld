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
      const url = `${this.baseUrl}/${userId}/mentions?fields=id,text,username,replies_count,likes_count&access_token=${this.accessToken}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Mentions fetch failed HTTP ${response.status}`);
      }
      const data = await response.json();
      return (data.data || []).map((t: any) => ({
        id: t.id,
        text: t.text || '',
        authorId: t.username || 'unknown',
        likeCount: t.likes_count || 0,
        replyCount: t.replies_count || 0
      }));
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to fetch Threads mentions via Graph API');
      return [];
    }
  }

  async searchTimeline(query: string): Promise<ThreadsTweet[]> {
    try {
      // Best effort assumption of recently launched Threads Search endpoint.
      const url = `${this.baseUrl}/search?q=${encodeURIComponent(query)}&fields=id,text,username,likes_count&access_token=${this.accessToken}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Search fetch failed HTTP ${response.status}`);
      }
      const data = await response.json();
      return (data.data || []).map((t: any) => ({
        id: t.id,
        text: t.text || '',
        authorId: t.username || 'unknown',
        likeCount: t.likes_count || 0
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
      if (!createRes.ok) throw new Error('Failed to create reply container');
      
      const container = await createRes.json();
      if (!container.id) throw new Error('Reply container returned no ID');

      // 2. Publish the container
      const publishUrl = `${this.baseUrl}/${userId}/threads_publish`;
      const publishBody = new URLSearchParams({
        creation_id: container.id,
        access_token: this.accessToken
      });
      const publishRes = await fetch(publishUrl, { method: 'POST', body: publishBody, headers: { 'Content-type': 'application/x-www-form-urlencoded' } });
      if (!publishRes.ok) throw new Error('Failed to publish reply');

    } catch (error: any) {
      logger.warn({ error: error.message, targetMediaId }, 'Failed to execute Threads reply');
      throw error;
    }
  }
}
