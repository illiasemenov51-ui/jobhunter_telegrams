# Vacancy sources

Research checked on 2026-11-12. This is an implementation decision, not legal
advice. `robots.txt` is not a license or a substitute for the site's terms.

## Decision

The project does not poll, crawl, or import listings from any of these sites.
No source had both a clearly documented, permitted public feed/API and terms
that could be verified during this review. A sitemap intended for search
engines is not treated as an ingestion API.

Add vacancies manually with `/add <https-url>`. Saved-search email alerts can
also be used as a human source: copy a vacancy link from the alert and add it
with `/add`. Automatic email-alert ingestion is not configured.

## Findings

| Source | Official discovery and robots findings | Terms / feed finding | Decision |
|---|---|---|---|
| No Fluff Jobs | [robots.txt](https://nofluffjobs.com/robots.txt) allows `/` but disallows `/api/`, `/posting/`, localized posting paths, and `*/job/job/*`. It does not advertise a sitemap. | No official RSS or public listing API was confirmed. The attempted [terms-and-conditions](https://nofluffjobs.com/terms-and-conditions) URL redirected to job listings rather than terms, so access conditions could not be verified. | Manual `/add` only. Do not crawl disallowed API or posting paths. |
| JustJoin.it | [robots.txt](https://justjoin.it/robots.txt) lists an [active-jobs sitemap](https://justjoin.it/sitemaps/active-jobs.xml), while disallowing `/oferty-pracy/*,*` and `/api/`. | The [terms and privacy page](https://justjoin.it/terms-and-privacy-policies) is JavaScript-rendered and its policy text could not be verified in this review. The sitemap is not treated as a supported feed or permission to ingest listings. | Manual `/add` only. Do not use the disallowed API or job paths. |
| Pracuj.pl | [robots.txt](https://www.pracuj.pl/robots.txt) publishes several current-offer sitemaps, including the [job-offer sitemap index](https://www.pracuj.pl/SiteMaps/CurrentOffers/SiteMapIndexJobOffers.xml). | No official public listing API or RSS feed was confirmed. The attempted `/regulamin` URL redirected to job listings, so terms could not be verified. A search-engine sitemap alone is not considered an authorized ingestion feed. | Manual `/add` only. |
| OLX.pl | [robots.txt](https://www.olx.pl/robots.txt) disallows `/api/` and `*/rss/`, but separately allows `/api/v1/offers/`, `/api/v1/targeting/`, and `/api/v1/friendly-links/`. It also lists a [sitemap](https://www.olx.pl/sitemap.xml). | The robots exceptions are not API documentation or evidence of permitted third-party use. No official API usage terms could be confirmed; the attempted `/regulamin/` URL returned 404. | Manual `/add` only until official API documentation and applicable terms are verified. |

## Runtime behavior

There is deliberately no `fill-queue` polling workflow yet. Creating one without
a verified source would risk violating source rules. The existing `/add`
workflow validates HTTPS URLs, derives a stable ID, and deduplicates entries.
The separate `/next` action fetches only the single URL the user explicitly
selected; a failed fetch still produces a manual-review card.

Do not add crawlers, browser automation, API calls to disallowed paths, or
Cloudflare/login workarounds without first confirming an official integration
and its applicable terms. If a source later publishes an explicitly supported
feed/API with suitable usage terms, document that evidence here before adding
polling, filtering, rate limits, and an honest User-Agent.
