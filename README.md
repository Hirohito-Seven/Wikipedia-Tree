# Wikipedia Tree

A browser app that processes the most popular English Wikipedia articles and grows an interactive tree after every completed article. Choose an article count, then explore actual hyperlink connections by selecting nodes, zooming, and panning.

## Run locally

Install Node.js 20 or newer, then run:

```sh
npm run dev
```

Open http://127.0.0.1:4173. No dependencies or API keys are needed. The app also works as static files served by GitHub Pages or another web server. It requires an internet connection to reach Wikimedia's public APIs.

```sh
npm test
npm run build
```

The build copies only public app files into `dist/`.

## Publish on GitHub Pages

Push this directory to a GitHub repository on the `main` branch. In **Settings → Pages**, choose **GitHub Actions** as the source. The included `.github/workflows/pages.yml` checks the graph and parser, builds the static files, and deploys them to Pages. Subsequent pushes deploy automatically. If the first run occurs before Pages is enabled, rerun the workflow after changing the setting.

## How it works

- **Popularity:** Wikimedia's Pageviews API supplies the top 1,000 pages for the latest available completed UTC day. Up to seven recent days are tried if data is not yet published. Main Page, non-article namespaces, missing pages, disambiguation pages, and duplicate canonical articles are skipped. The app continues down the ranking until it reaches the requested number of unique articles or exhausts the list. The ranking date is shown in the header; this is daily popularity, not all-time popularity.
- **Processing:** Articles are processed in popularity order using the MediaWiki Action API. Each successful article loads its introductory text, article links, visible categories, and redirect aliases. All continuation pages are fetched before a node is added. A long article can therefore take more time than a short one. Requests are paced and transient failures retry with backoff. Runs can pause, stop, or resume after an error. State lives in memory for the current tab; refreshing starts again.
- **Connections:** Every directed hyperlink between processed articles is retained. Redirect aliases resolve to the canonical article. One solid edge per branch forms a spanning forest without cycles; remaining links are cross-links. Reciprocal hyperlinks count as two directed links, while the tree uses one visual connection. Hyperlinks include links introduced by navigation templates. No unprocessed article is added as a node, and no topical relationship is invented.
- **Display:** The oldest available connections determine the spanning forest. Each connected group is rooted at its highest-ranked article. When new nodes connect separate groups, branches merge and the layout updates. The central W is a display anchor; dotted spokes are layout guides, not Wikipedia hyperlinks. Category-based color labels use simple keyword estimates, not a formal Wikipedia taxonomy. Larger nodes represent higher daily pageviews. Selecting a node highlights its neighbors and reveals its links; the cross-links toggle also displays links outside the selection.
- **Limits:** The API supplies at most 1,000 ranked pages, usually fewer usable articles after filtering. Count is limited to 1–1,000, and the UI reports if fewer can be processed. Network failures stop the run without discarding the existing tree. Press Continue growing to retry the same article.

## Controls

Drag the tree to pan. Scroll or pinch to zoom, or use the +/− buttons. Fit tree frames the complete forest. Select a node or an item in the processed article list to open details. With the canvas focused, arrow keys pan, +/− zoom, and 0 fits the tree. Article list and detail controls support keyboard selection. Reduced motion preferences are respected.

## Data sources and attribution

- [Wikimedia Pageviews API](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/examples/project-metrics.html)
- [MediaWiki article links](https://www.mediawiki.org/wiki/API:Links)
- [MediaWiki categories](https://www.mediawiki.org/wiki/API:Categories)
- [MediaWiki redirects](https://www.mediawiki.org/wiki/API:Redirects)

Article introductions are written by Wikipedia contributors and available under the licenses described on each linked article, generally [CC BY-SA](https://en.wikipedia.org/wiki/Wikipedia:Copyrights). The detail panel links to the original article for its authorship history and licensing. This is an independent project, not affiliated with Wikimedia. Fonts are optionally loaded from Google Fonts; system fonts are used if unavailable. There is no analytics, login, backend, or storage of browsing activity.
