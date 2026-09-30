const API = 'https://en.wikipedia.org/w/api.php';
export class WikipediaClient {
  constructor({ signal, beforeRequest = async () => {}, fetcher = (...args) => fetch(...args) } = {}) { this.signal = signal; this.beforeRequest = beforeRequest; this.fetcher = fetcher; }
  async delay(ms) {
    this.signal?.throwIfAborted();
    await new Promise((resolve, reject) => { const stop = () => { clearTimeout(timer); reject(this.signal.reason); }; const timer = setTimeout(() => { this.signal?.removeEventListener('abort', stop); resolve(); }, ms); this.signal?.addEventListener('abort', stop, { once: true }); });
  }
  async request(url) {
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.beforeRequest(); this.signal?.throwIfAborted();
      await this.delay(160);
      const controller = new AbortController();
      const abort = () => controller.abort(this.signal.reason);
      this.signal?.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(() => controller.abort(new Error('Wikipedia did not respond within 25 seconds.')), 25000);
      let response;
      try {
        response = await this.fetcher(url, { signal: controller.signal, credentials: 'omit' });
        if (response.status === 404) { const error = new Error('Ranking not available for this date.'); error.status = 404; throw error; }
        if ([429, 503, 502, 504].includes(response.status)) {
          const error = new Error('Wikipedia is busy. Please try again shortly.'); error.retry = true;
          error.retryAfter = Math.min(30000, Math.max(0, Number(response.headers.get('retry-after')) * 1000 || 0)); throw error;
        }
        if (!response.ok) throw new Error(`Wikipedia request failed (${response.status}).`);
        const data = await response.json();
        if (data.error) { const error = new Error(data.error.info || 'Wikipedia returned an API error.'); error.retry = data.error.code === 'maxlag' || data.error.code === 'ratelimited'; throw error; }
        return data;
      } catch (error) {
        this.signal?.throwIfAborted();
        if (error.status === 404) throw error;
        const retry = error.retry || error instanceof TypeError || controller.signal.aborted;
        if (!retry || attempt === 3) throw error;
        clearTimeout(timeout); this.signal?.removeEventListener('abort', abort);
        await this.delay(Math.max(error.retryAfter || 0, 800 * 2 ** attempt));
      } finally { clearTimeout(timeout); this.signal?.removeEventListener('abort', abort); }
    }
  }
  async query(params) {
    const url = new URL(API);
    url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', origin: '*', maxlag: '5', ...params });
    return this.request(url);
  }
  async ranking(now = new Date()) {
    // Latest completed UTC day; older dates are tried only when Wikimedia reports 404.
    for (let ago = 1; ago <= 7; ago++) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ago));
      const iso = date.toISOString().slice(0, 10);
      try {
        const data = await this.request(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia.org/all-access/${iso.replaceAll('-', '/')}`);
        const pages = data.items?.[0]?.articles;
        if (!Array.isArray(pages) || !pages.length) throw new Error('The popularity ranking was empty.');
        const excluded = /^(Special|Wikipedia|User|User talk|Talk|File|Media|Template|Help|Category|Portal|Draft|Module|MediaWiki|Book|TimedText)(?: talk)?:/i;
        return { date: iso, articles: pages.filter(a => a.article !== 'Main_Page' && !excluded.test(a.article.replaceAll('_', ' '))).map(a => ({ title: a.article.replaceAll('_', ' '), views: a.views, rank: a.rank })) };
      } catch (error) { if (error.status !== 404) throw error; }
    }
    throw new Error('No daily ranking was available in the last week. Please try again later.');
  }
  async article(ranked) {
    const first = await this.query({ titles: ranked.title, redirects: '1', prop: 'info|pageprops|extracts|links|categories|redirects', inprop: 'url', ppprop: 'disambiguation', exintro: '1', explaintext: '1', exchars: '1400', plnamespace: '0', pllimit: 'max', clshow: '!hidden', cllimit: 'max', rdnamespace: '0', rdlimit: 'max' });
    const page = first.query?.pages?.[0];
    if (!page || page.missing || page.invalid || page.ns !== 0 || page.pageprops?.disambiguation !== undefined) return null;
    const article = { ...ranked, pageid: page.pageid, title: page.title, url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(' ', '_'))}`, extract: page.extract || 'No introduction is available for this article.', links: [], categories: [], aliases: [ranked.title] };
    let batch = first;
    // Follow all continuation keys: links, visible categories, and redirect aliases.
    do {
      const current = batch.query?.pages?.[0];
      article.links.push(...(current?.links || []).map(x => x.title));
      article.categories.push(...(current?.categories || []).map(x => x.title.replace(/^Category:/, '')));
      article.aliases.push(...(current?.redirects || []).map(x => x.title));
      if (!batch.continue) break;
      batch = await this.query({ pageids: String(page.pageid), prop: 'links|categories|redirects', plnamespace: '0', pllimit: 'max', clshow: '!hidden', cllimit: 'max', rdnamespace: '0', rdlimit: 'max', ...batch.continue });
    } while (true);
    article.links = [...new Set(article.links)]; article.categories = [...new Set(article.categories)]; article.aliases = [...new Set(article.aliases)];
    return article;
  }
}
