// Kununu Jobs Scraper - API-first with HTML fallback
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';
import { load as cheerioLoad } from 'cheerio';

await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            jobTitle = '',
            location = '',
            homeOffice = false,
            employmentType = '',
            careerLevel = '',
            results_wanted: RESULTS_WANTED_RAW = 100,
            max_pages: MAX_PAGES_RAW = 50,
            collectDetails = true,
            maxConcurrency: maxConcurrencyInput,
            startUrl,
            startUrls,
            url,
            proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 50;
        const MAX_CONCURRENCY = Number.isFinite(+maxConcurrencyInput) && +maxConcurrencyInput > 0
            ? Math.min(+maxConcurrencyInput, 50)
            : 12; // conservative default to reduce blocking

        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;
        const requestQueue = await Actor.openRequestQueue();

        let saved = 0;
        const seenUrls = new Set();
        let detailQueued = 0;

        const buildSearchUrl = (title, loc, page = 1) => {
            let newUrl = 'https://www.kununu.com/de/jobs';
            const params = [];

            if (title) params.push(`q=${encodeURIComponent(title)}`);
            if (loc) params.push(`l=${encodeURIComponent(loc)}`);
            if (homeOffice) params.push('w=home-office');
            if (employmentType) params.push(`m=${encodeURIComponent(employmentType)}`);
            if (careerLevel) params.push(`t=${encodeURIComponent(careerLevel)}`);
            if (page > 1) params.push(`page=${page}`);

            if (params.length) newUrl += `?${params.join('&')}`;
            return newUrl;
        };

        const extractLocation = (jobLocation) => {
            if (!jobLocation) return null;
            if (Array.isArray(jobLocation)) jobLocation = jobLocation[0];
            const addr = jobLocation.address;
            if (!addr) return null;
            return [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(', ') || null;
        };

        const parseSalaryNumber = (value) => {
            if (value == null) return null;
            if (typeof value === 'number') return value;
            const cleaned = String(value)
                .replace(/[^\d,.-]/g, '')
                .replace(/\.(?=\d{3}(?:\D|$))/g, '')
                .replace(',', '.');
            const num = parseFloat(cleaned);
            return Number.isFinite(num) ? num : null;
        };

        const formatSalaryRange = (min, max, currency) => {
            const cur = currency || 'EUR';
            const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : null);
            const minFmt = fmt(min);
            const maxFmt = fmt(max);
            if (minFmt && maxFmt && min !== max) return `${minFmt} - ${maxFmt} ${cur}`;
            if (minFmt) return `${minFmt} ${cur}`;
            return null;
        };

        const extractSalary = (baseSalary) => {
            if (!baseSalary) return null;
            if (typeof baseSalary === 'string') return normalizeSalary(baseSalary);

            const currency = baseSalary.currency
                || baseSalary.currencyCode
                || baseSalary?.value?.currency
                || 'EUR';
            const value = typeof baseSalary.value === 'object' ? baseSalary.value : baseSalary;
            const min = parseSalaryNumber(value?.minValue ?? value?.value);
            const max = parseSalaryNumber(value?.maxValue);

            return formatSalaryRange(min, max, currency);
        };

        const normalizeSalary = (raw) => {
            if (!raw) return null;
            if (typeof raw === 'number') return formatSalaryRange(raw, null, 'EUR');
            if (typeof raw === 'object') return extractSalary(raw);

            const clean = String(raw).replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
            if (!clean) return null;
            const currency = /\u20ac|eur/i.test(clean) ? 'EUR' : undefined;
            const numbers = [...clean.matchAll(/\d[\d.,\s]*\d/g)]
                .map((m) => parseSalaryNumber(m[0]))
                .filter((n) => Number.isFinite(n));

            if (numbers.length >= 2) {
                const min = Math.min(...numbers);
                const max = Math.max(...numbers);
                return formatSalaryRange(min, max, currency);
            }

            if (numbers.length === 1) return formatSalaryRange(numbers[0], null, currency) || clean;

            return currency ? `${clean} (${currency})` : clean;
        };

        // -------- PAGINATION HELPER (HTML LIST) --------
        const resolveNextPageUrl = ($, request, pageNo, hasJobsOnPage) => {
            const nextPage = pageNo + 1;
            if (nextPage > MAX_PAGES) return null;

            // Try various "next" link selectors first
            const labelledSelector = [
                'a.button._pageItem_1qfbl_213.focus-dark[rel="next"]',
                'a.button._pageItem_1qfbl_213.focus-dark[aria-label*="next" i]',
                'a.button._pageItem_1qfbl_213.focus-dark[aria-label*="weiter" i]',
                'a[rel="next"]',
                'a[aria-label*="next" i]',
                'a[aria-label*="weiter" i]',
                'a:contains("Weiter")',
                'a:contains("Nächste")',
                'a:contains("N\\u00e4chste")',
                'a:contains(">")',
                'a:contains("»")',
                'a:contains("›")',
            ].join(', ');

            const labelled = $(labelledSelector)
                .filter((_, el) => !$(el).hasClass('disabled'))
                .first()
                .attr('href');

            if (labelled) return new URL(labelled, request.url).href;

            // NEW: fall back to numbered links or any link containing the next page query
            const numberedCandidate = $('a[href]')
                .filter((_, el) => {
                    const text = $(el).text().trim();
                    const href = $(el).attr('href') || '';
                    if (!href || href === '#' || href.startsWith('javascript:')) return false;
                    if (text === String(nextPage)) return true;
                    return href.includes(`page=${nextPage}`);
                })
                .first()
                .attr('href');

            if (numberedCandidate) return new URL(numberedCandidate, request.url).href;

            // FINAL fallback: increment ?page= param directly
            const urlObj = new URL(request.url);
            const currentFromQuery = Number(urlObj.searchParams.get('page')) || pageNo;
            urlObj.searchParams.set('page', currentFromQuery + 1);
            return urlObj.href;
        };
        // -------- END PAGINATION HELPER --------

        const extractFromJsonLd = ($) => {
            const scripts = $('script[type="application/ld+json"]');
            for (let i = 0; i < scripts.length; i++) {
                try {
                    const parsed = JSON.parse($(scripts[i]).html() || '');
                    const arr = Array.isArray(parsed) ? parsed : [parsed];
                    for (const item of arr) {
                        if (!item) continue;
                        const type = item['@type'] || item.type;
                        if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) {
                            return {
                                title: item.title || item.name || null,
                                company: item.hiringOrganization?.name || null,
                                company_url: item.hiringOrganization?.url || null,
                                date_posted: item.datePosted || null,
                                valid_through: item.validThrough || null,
                                description_html: item.description || null,
                                location: extractLocation(item.jobLocation),
                                employment_type: item.employmentType || null,
                                salary: extractSalary(item.baseSalary),
                            };
                        }
                    }
                } catch (e) {
                    log.debug(`JSON-LD parse error: ${e.message}`);
                }
            }
            return null;
        };

        const cleanText = (html) => {
            if (!html) return '';
            const $ = cheerioLoad(html);
            $('script, style, noscript, iframe').remove();
            return $.root().text().replace(/\s+/g, ' ').trim();
        };

        const tryFetchJobsViaApi = async (pageIndex = 0) => {
            try {
                const apiUrl = 'https://www.kununu.com/api/v1/jobs/search';
                const params = new URLSearchParams();

                if (jobTitle) params.append('q', jobTitle);
                if (location) params.append('location', location);
                if (homeOffice) params.append('homeOffice', 'true');
                if (employmentType) params.append('employmentType', employmentType);
                if (careerLevel) params.append('careerLevel', careerLevel);
                // Kununu uses 1-based page query for public results; shift by +1.
                params.append('page', pageIndex + 1);
                params.append('limit', 50); // Kununu may still return ~30, that's fine.

                const response = await gotScraping({
                    url: `${apiUrl}?${params.toString()}`,
                    method: 'GET',
                    useHeaderGenerator: true,
                    headerGeneratorOptions: {
                        devices: ['desktop'],
                        locales: ['de-DE', 'en-US'],
                    },
                    http2: true,
                    responseType: 'json',
                    timeout: { request: 30000 },
                    proxyUrl: proxyConf ? await proxyConf.newUrl() : undefined,
                });

                if (response.body && response.body.jobs) {
                    return response.body.jobs.map((job) => ({
                        id: job.id || job.uuid,
                        title: job.title || job.jobTitle,
                        company: job.company?.name || job.companyName,
                        company_url: job.company?.url || job.companyUrl,
                        location: job.location?.name || job.locationName,
                        employment_type: job.employmentType,
                        salary: normalizeSalary(job.salary || job.salaryText),
                        date_posted: job.publishedAt || job.datePosted,
                        url: job.url || `https://www.kununu.com/de/job/${job.id || job.uuid}`,
                        source: 'api',
                    }));
                }
            } catch (error) {
                log.warning(`API fetch failed: ${error.message}. Falling back to HTML parsing.`);
            }
            return null;
        };

        // Build initial URLs (for HTML mode)
        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) {
            initial.push(...startUrls);
        } else if (startUrl || url) {
            initial.push(startUrl || url);
        } else {
            initial.push(buildSearchUrl(jobTitle, location, 1));
        }

        // -------- API-FIRST MODE --------
        if (!startUrl && !url && !startUrls) {
            log.info('Attempting API-based scraping...');

            for (let pageIndex = 0; pageIndex < MAX_PAGES && saved < RESULTS_WANTED; pageIndex++) {
                const jobs = await tryFetchJobsViaApi(pageIndex);

                if (!jobs || jobs.length === 0) {
                    log.info(`No more jobs from API at page index ${pageIndex}. Switching to HTML parsing.`);
                    break;
                }

                log.info(`API returned ${jobs.length} jobs from page index ${pageIndex}`);

                for (const job of jobs) {
                    if (saved >= RESULTS_WANTED) break;
                    if (seenUrls.has(job.url)) continue;
                    seenUrls.add(job.url);

                    if (collectDetails && job.url) {
                        await requestQueue.addRequest({
                            url: job.url,
                            userData: { label: 'DETAIL', apiData: job },
                        });
                        detailQueued++;
                    } else {
                        await Dataset.pushData({
                            ...job,
                            description_html: null,
                            description_text: null,
                        });
                        saved++;
                    }
                }

                // Keep paging until API returns 0 jobs (or limits reached).
            }

            const queueInfo = await requestQueue.getInfo();
            const hasPendingDetails = (queueInfo?.pendingRequestCount || 0) > 0;
            if (!collectDetails && saved >= RESULTS_WANTED && !hasPendingDetails) {
                log.info(`Reached target of ${RESULTS_WANTED} jobs via API.`);
                return;
            }
        }
        // -------- END API-FIRST MODE --------

        const crawler = new CheerioCrawler({
            requestQueue,
            proxyConfiguration: proxyConf,
            maxRequestRetries: 2,
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: Math.max(6, Math.ceil(MAX_CONCURRENCY)),
                sessionOptions: { maxUsageCount: 8 },
            },
            maxConcurrency: MAX_CONCURRENCY,
            requestHandlerTimeoutSecs: 60,
            useHeaderGenerator: true,
            headerGeneratorOptions: {
                browsers: ['chrome', 'firefox'],
                devices: ['desktop'],
                locales: ['de-DE', 'en-US'],
            },
            preNavigationHooks: [
                async ({ request }) => {
                    request.headers = {
                        ...request.headers,
                        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                        'accept-language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
                        'cache-control': 'no-cache',
                        pragma: 'no-cache',
                    };
                },
            ],

            async requestHandler({ request, $, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                if (label === 'LIST') {
                    crawlerLog.info(`Processing LIST page: ${request.url}`);

                    const jobLinks = [];
                    $('a[href*="/de/job/"]').each((_, el) => {
                        const href = $(el).attr('href');
                        if (href && href.includes('/de/job/')) {
                            const fullUrl = new URL(href, 'https://www.kununu.com').href;
                            if (!seenUrls.has(fullUrl)) {
                                seenUrls.add(fullUrl);
                                jobLinks.push(fullUrl);
                            }
                        }
                    });

                    crawlerLog.info(`Found ${jobLinks.length} job links on page ${pageNo}`);

                    if (collectDetails && jobLinks.length) {
                        const remaining = RESULTS_WANTED - saved - detailQueued;
                        const toEnqueue = jobLinks.slice(0, Math.max(0, remaining));
                        for (const u of toEnqueue) {
                            await requestQueue.addRequest({ url: u, userData: { label: 'DETAIL' } });
                            detailQueued++;
                        }
                    } else if (jobLinks.length) {
                        const remaining = RESULTS_WANTED - saved;
                        const toPush = jobLinks.slice(0, Math.max(0, remaining));
                        await Dataset.pushData(toPush.map((u) => ({
                            url: u,
                            title: null,
                            company: null,
                            location: null,
                            source: 'kununu',
                        })));
                        saved += toPush.length;
                    }

                    if (saved < RESULTS_WANTED && pageNo < MAX_PAGES) {
                        const nextUrl = resolveNextPageUrl($, request, pageNo, jobLinks.length > 0);
                        if (nextUrl) {
                            crawlerLog.info(`Enqueueing next page: ${nextUrl}`);
                            await requestQueue.addRequest({
                                url: nextUrl,
                                userData: { label: 'LIST', pageNo: pageNo + 1 },
                            });
                        } else {
                            crawlerLog.info(`No next page found at page ${pageNo} (max_pages=${MAX_PAGES}, jobsOnPage=${jobLinks.length})`);
                        }
                    }
                    return;
                }

                if (label === 'DETAIL') {
                    const decrementQueue = () => { detailQueued = Math.max(0, detailQueued - 1); };
                    if (saved >= RESULTS_WANTED) {
                        decrementQueue();
                        return;
                    }

                    try {
                        let data = extractFromJsonLd($);
                        const apiData = request.userData?.apiData || {};

                        if (!data) data = {};
                        data = { ...apiData, ...data };

                        if (!data.title) {
                            data.title = $('h1, [class*="jobTitle"], [class*="job-title"]').first().text().trim() || null;
                        }

                        if (!data.company) {
                            data.company = $('[class*="company"], [data-testid*="company"]').first().text().trim() || null;
                        }

                        if (!data.location) {
                            data.location = $('[class*="location"], [class*="Location"]').first().text().trim() || null;
                        }

                        if (!data.employment_type) {
                            data.employment_type = $('[class*="employmentType"], [class*="job-type"]').first().text().trim() || null;
                        }

                        if (!data.salary) {
                            const salaryText = $('[class*="salary"], [class*="Salary"]').first().text().trim();
                            data.salary = normalizeSalary(salaryText);
                        } else {
                            data.salary = normalizeSalary(data.salary);
                        }

                        if (!data.description_html) {
                            const desc = $('[class*="job-description"], [class*="jobDescription"], [class*="description"]').first();
                            data.description_html = desc && desc.length ? desc.html()?.trim() : null;
                        }

                        data.description_text = data.description_html ? cleanText(data.description_html) : null;

                        const item = {
                            title: data.title || null,
                            company: data.company || null,
                            company_url: data.company_url || null,
                            location: data.location || null,
                            employment_type: data.employment_type || null,
                            salary: data.salary || null,
                            date_posted: data.date_posted || null,
                            valid_through: data.valid_through || null,
                            description_html: data.description_html || null,
                            description_text: data.description_text || null,
                            url: request.url,
                            source: data.source || 'kununu',
                        };

                        await Dataset.pushData(item);
                        saved++;
                        crawlerLog.info(`Saved job ${saved}/${RESULTS_WANTED}: ${item.title}`);
                    } catch (err) {
                        crawlerLog.error(`DETAIL ${request.url} failed: ${err.message}`);
                    } finally {
                        decrementQueue();
                    }
                }
            },
        });

        const queueInfoAfterApi = await requestQueue.getInfo();
        const hasPending = (queueInfoAfterApi?.pendingRequestCount || 0) > 0;

        if (saved + detailQueued < RESULTS_WANTED) {
            for (const u of initial) {
                if (!u) continue;
                let pageNo = 1;
                try {
                    pageNo = Number(new URL(u).searchParams.get('page')) || 1;
                } catch { /* ignore */ }
                await requestQueue.addRequest({
                    url: u,
                    userData: { label: 'LIST', pageNo },
                });
            }
        }

        log.info('Starting crawler...');
        await crawler.run();

        log.info(`Finished. Saved ${saved} job listings from Kununu.`);
    } finally {
        await Actor.exit();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
