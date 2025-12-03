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
            startUrl,
            startUrls,
            url,
            proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 50;

        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

        let saved = 0;
        const seenUrls = new Set();

        // Helper: Build Kununu search URL
        const buildSearchUrl = (title, loc, page = 1) => {
            let url = 'https://www.kununu.com/de/jobs';
            const params = [];
            
            if (title) params.push(`q=${encodeURIComponent(title)}`);
            if (loc) params.push(`l=${encodeURIComponent(loc)}`);
            if (homeOffice) params.push('w=home-office');
            if (employmentType) params.push(`m=${encodeURIComponent(employmentType)}`);
            if (careerLevel) params.push(`t=${encodeURIComponent(careerLevel)}`);
            if (page > 1) params.push(`page=${page}`);
            
            if (params.length) url += '?' + params.join('&');
            return url;
        };

        // Helper: Extract job data from JSON-LD
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

        const extractLocation = (jobLocation) => {
            if (!jobLocation) return null;
            if (Array.isArray(jobLocation)) jobLocation = jobLocation[0];
            const addr = jobLocation.address;
            if (!addr) return null;
            return [addr.addressLocality, addr.addressRegion, addr.addressCountry]
                .filter(Boolean).join(', ') || null;
        };

        const extractSalary = (baseSalary) => {
            if (!baseSalary) return null;
            const value = baseSalary.value || baseSalary;
            if (typeof value === 'object') {
                const min = value.minValue || value.value;
                const max = value.maxValue;
                const currency = value.currency || 'EUR';
                if (min && max) return `${min}-${max} ${currency}`;
                if (min) return `${min}+ ${currency}`;
            }
            return null;
        };

        const cleanText = (html) => {
            if (!html) return '';
            const $ = cheerioLoad(html);
            $('script, style, noscript, iframe').remove();
            return $.root().text().replace(/\s+/g, ' ').trim();
        };

        // API-first approach: Try to fetch jobs via API
        const tryFetchJobsViaApi = async (page = 1) => {
            try {
                const apiUrl = 'https://www.kununu.com/api/v1/jobs/search';
                const params = new URLSearchParams();
                
                if (jobTitle) params.append('q', jobTitle);
                if (location) params.append('location', location);
                if (homeOffice) params.append('homeOffice', 'true');
                if (employmentType) params.append('employmentType', employmentType);
                if (careerLevel) params.append('careerLevel', careerLevel);
                params.append('page', page);
                params.append('limit', 50);

                const response = await gotScraping({
                    url: `${apiUrl}?${params.toString()}`,
                    method: 'GET',
                    headers: {
                        'accept': 'application/json',
                        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    },
                    responseType: 'json',
                    proxyUrl: proxyConf ? await proxyConf.newUrl() : undefined,
                });

                if (response.body && response.body.jobs) {
                    return response.body.jobs.map(job => ({
                        id: job.id || job.uuid,
                        title: job.title || job.jobTitle,
                        company: job.company?.name || job.companyName,
                        company_url: job.company?.url || job.companyUrl,
                        location: job.location?.name || job.locationName,
                        employment_type: job.employmentType,
                        salary: job.salary,
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

        // Initialize start URLs
        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) {
            initial.push(...startUrls);
        } else if (startUrl || url) {
            initial.push(startUrl || url);
        } else {
            initial.push(buildSearchUrl(jobTitle, location, 1));
        }

        // Try API-first approach if enabled
        if (!startUrl && !url && !startUrls) {
            log.info('Attempting API-based scraping...');
            
            for (let page = 1; page <= MAX_PAGES && saved < RESULTS_WANTED; page++) {
                const jobs = await tryFetchJobsViaApi(page);
                
                if (!jobs || jobs.length === 0) {
                    log.info(`No more jobs from API at page ${page}. Switching to HTML parsing.`);
                    break;
                }

                log.info(`API returned ${jobs.length} jobs from page ${page}`);

                for (const job of jobs) {
                    if (saved >= RESULTS_WANTED) break;
                    if (seenUrls.has(job.url)) continue;
                    seenUrls.add(job.url);

                    if (collectDetails && job.url) {
                        // Enqueue detail page for full scraping
                        await crawler.addRequests([{
                            url: job.url,
                            userData: { label: 'DETAIL', apiData: job },
                        }]);
                    } else {
                        await Dataset.pushData({
                            ...job,
                            description_html: null,
                            description_text: null,
                        });
                        saved++;
                    }
                }

                if (jobs.length < 50) break; // Last page
            }

            if (saved >= RESULTS_WANTED) {
                log.info(`Reached target of ${RESULTS_WANTED} jobs via API.`);
                return;
            }
        }

        // HTML Crawler (fallback or primary)
        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            maxConcurrency: 5,
            requestHandlerTimeoutSecs: 90,
            
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                if (label === 'LIST') {
                    crawlerLog.info(`Processing LIST page: ${request.url}`);

                    // Find job links from HTML
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

                    // Enqueue job detail pages
                    if (collectDetails && jobLinks.length) {
                        const remaining = RESULTS_WANTED - saved;
                        const toEnqueue = jobLinks.slice(0, Math.max(0, remaining));
                        if (toEnqueue.length) {
                            await enqueueLinks({
                                urls: toEnqueue,
                                userData: { label: 'DETAIL' },
                            });
                        }
                    } else if (jobLinks.length) {
                        const remaining = RESULTS_WANTED - saved;
                        const toPush = jobLinks.slice(0, Math.max(0, remaining));
                        await Dataset.pushData(toPush.map(u => ({
                            url: u,
                            title: null,
                            company: null,
                            location: null,
                            source: 'kununu',
                        })));
                        saved += toPush.length;
                    }

                    // Find next page
                    if (saved < RESULTS_WANTED && pageNo < MAX_PAGES) {
                        const nextLink = $('a[aria-label*="next" i], a:contains("›"), a:contains("Weiter")')
                            .filter((_, el) => !$(el).hasClass('disabled'))
                            .first()
                            .attr('href');
                        
                        if (nextLink) {
                            const nextUrl = new URL(nextLink, request.url).href;
                            crawlerLog.info(`Enqueueing next page: ${nextUrl}`);
                            await enqueueLinks({
                                urls: [nextUrl],
                                userData: { label: 'LIST', pageNo: pageNo + 1 },
                            });
                        } else {
                            crawlerLog.info('No next page found');
                        }
                    }
                    return;
                }

                if (label === 'DETAIL') {
                    if (saved >= RESULTS_WANTED) return;

                    try {
                        // Try JSON-LD first
                        let data = extractFromJsonLd($);
                        const apiData = request.userData?.apiData || {};

                        // Merge API data if available
                        if (!data) data = {};
                        data = { ...apiData, ...data };

                        // Fallback to HTML selectors
                        if (!data.title) {
                            data.title = $('h1, [class*="jobTitle"], [class*="job-title"]')
                                .first().text().trim() || null;
                        }
                        
                        if (!data.company) {
                            data.company = $('[class*="company"], [data-testid*="company"]')
                                .first().text().trim() || null;
                        }

                        if (!data.location) {
                            data.location = $('[class*="location"], [class*="Location"]')
                                .first().text().trim() || null;
                        }

                        if (!data.employment_type) {
                            data.employment_type = $('[class*="employmentType"], [class*="job-type"]')
                                .first().text().trim() || null;
                        }

                        if (!data.salary) {
                            const salaryText = $('[class*="salary"], [class*="Salary"]')
                                .first().text().trim();
                            data.salary = salaryText || null;
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
                    }
                }
            },
        });

        // Run HTML crawler if we didn't get enough via API
        if (saved < RESULTS_WANTED) {
            log.info('Starting HTML crawler...');
            await crawler.run(initial.map(u => ({
                url: u,
                userData: { label: 'LIST', pageNo: 1 },
            })));
        }

        log.info(`✓ Finished. Saved ${saved} job listings from Kununu.`);
    } finally {
        await Actor.exit();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
