# Kununu Jobs Scraper

Extract job listings from **Kununu.com**, Germany's leading employer review and job search platform. This powerful scraper automatically collects comprehensive job data including titles, companies, locations, salaries, employment types, and full job descriptions.

## Why Use This Scraper?

Kununu is the #1 platform for employer reviews and job postings in Germany, Austria, and Switzerland. This scraper enables you to:

- **Monitor Job Markets** - Track hiring trends across industries and regions
- **Competitive Analysis** - Research competitor hiring patterns and job requirements  
- **Lead Generation** - Identify companies actively recruiting for outreach opportunities
- **Market Research** - Analyze salary ranges and employment conditions across sectors
- **Job Aggregation** - Build comprehensive job boards or career platforms

## Key Features

✅ **Dual Extraction Method** - API-first approach with automatic HTML fallback for maximum reliability  
✅ **Smart Data Extraction** - Prioritizes structured JSON-LD data, falls back to HTML parsing  
✅ **Advanced Filtering** - Search by job title, location, employment type, career level, and home office options  
✅ **Complete Job Details** - Extracts titles, companies, locations, salaries, descriptions, and more  
✅ **Automatic Pagination** - Seamlessly handles multi-page results  
✅ **Duplicate Prevention** - Built-in URL deduplication ensures clean datasets  
✅ **Configurable Depth** - Choose between fast listing scrapes or detailed job information  
✅ **Proxy Support** - Integrated Apify proxy support to prevent blocking

## Input Configuration

Configure the scraper using these parameters:

### Search Parameters

<table>
<thead>
<tr>
<th>Parameter</th>
<th>Type</th>
<th>Description</th>
<th>Required</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>jobTitle</code></td>
<td>String</td>
<td>Job title or keyword (e.g., "Software Engineer", "Marketing Manager")</td>
<td>No</td>
</tr>
<tr>
<td><code>location</code></td>
<td>String</td>
<td>City or region in Germany (e.g., "Berlin", "München", "Hamburg")</td>
<td>No</td>
</tr>
<tr>
<td><code>homeOffice</code></td>
<td>Boolean</td>
<td>Filter for remote/home office positions only</td>
<td>No</td>
</tr>
<tr>
<td><code>employmentType</code></td>
<td>String</td>
<td>Employment type: "vollzeit", "teilzeit", "praktikum", "minijobs", "ausbildung", "werkstudent"</td>
<td>No</td>
</tr>
<tr>
<td><code>careerLevel</code></td>
<td>String</td>
<td>Career level: "berufseinsteiger", "berufserfahren", "fuehrungskraft", "student", "auszubildende"</td>
<td>No</td>
</tr>
<tr>
<td><code>startUrl</code></td>
<td>String</td>
<td>Custom Kununu search URL (overrides other search parameters)</td>
<td>No</td>
</tr>
</tbody>
</table>

### Scraping Controls

<table>
<thead>
<tr>
<th>Parameter</th>
<th>Type</th>
<th>Description</th>
<th>Default</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>collectDetails</code></td>
<td>Boolean</td>
<td>Visit detail pages for complete job descriptions</td>
<td>true</td>
</tr>
<tr>
<td><code>results_wanted</code></td>
<td>Integer</td>
<td>Maximum number of jobs to extract (1-10000)</td>
<td>100</td>
</tr>
  <tr>
  <td><code>max_pages</code></td>
  <td>Integer</td>
  <td>Maximum search result pages to process (1-100)</td>
  <td>50</td>
  </tr>
  <tr>
  <td><code>maxConcurrency</code></td>
  <td>Integer</td>
  <td>Crawler concurrency (1-50). Increase for speed, lower if the site throttles.</td>
  <td>20</td>
  </tr>
  <tr>
  <td><code>proxyConfiguration</code></td>
  <td>Object</td>
  <td>Apify proxy settings (residential proxies recommended)</td>
<td>Residential</td>
</tr>
</tbody>
</table>

## Output Format

Each job listing includes the following fields:

```json
{
  "title": "Senior Software Engineer",
  "company": "Tech Company GmbH",
  "company_url": "https://www.kununu.com/de/tech-company",
  "location": "Berlin, Germany",
  "employment_type": "Vollzeit",
  "salary": "60000-80000 EUR",
  "date_posted": "2025-12-01",
  "valid_through": "2026-01-15",
  "description_html": "<p>Full HTML job description...</p>",
  "description_text": "Plain text version of the job description...",
  "url": "https://www.kununu.com/de/job/abc123",
  "source": "kununu"
}
```

### Output Fields

| Field | Type | Description |
|-------|------|-------------|
| `title` | String | Job position title |
| `company` | String | Hiring company name |
| `company_url` | String | Link to company's Kununu profile |
| `location` | String | Job location (city, region, country) |
| `employment_type` | String | Employment type (Full-time, Part-time, etc.) |
| `salary` | String | Salary range or information |
| `date_posted` | String | Job posting date (ISO format) |
| `valid_through` | String | Application deadline |
| `description_html` | String | Full job description with HTML formatting |
| `description_text` | String | Plain text version of description |
| `url` | String | Direct link to job posting |
| `source` | String | Data source identifier |

## Usage Examples

### Example 1: Basic Job Search

Search for Software Engineer positions in Berlin:

```json
{
  "jobTitle": "Software Engineer",
  "location": "Berlin",
  "results_wanted": 50,
  "collectDetails": true
}
```

### Example 2: Remote Jobs Only

Find all remote marketing positions:

```json
{
  "jobTitle": "Marketing Manager",
  "homeOffice": true,
  "results_wanted": 100,
  "collectDetails": true
}
```

### Example 3: Entry-Level Internships

Search for internship opportunities for students:

```json
{
  "employmentType": "praktikum",
  "careerLevel": "student",
  "location": "München",
  "results_wanted": 30
}
```

### Example 4: Fast Overview Scrape

Quick scrape without detail pages (faster execution):

```json
{
  "jobTitle": "Data Scientist",
  "location": "Hamburg",
  "collectDetails": false,
  "results_wanted": 200,
  "max_pages": 10
}
```

### Example 5: Custom URL

Start from a specific Kununu search URL:

```json
{
  "startUrl": "https://www.kununu.com/de/jobs?q=product%20manager&l=frankfurt",
  "results_wanted": 75,
  "collectDetails": true
}
```

## How It Works

### 1. API-First Strategy

The scraper attempts to fetch job data via Kununu's internal API endpoints, providing:
- Faster execution
- Structured JSON data
- Lower resource consumption

### 2. HTML Fallback

If the API is unavailable or returns incomplete data, the scraper automatically switches to HTML parsing:
- Extracts data from page markup
- Utilizes JSON-LD structured data when available
- Applies intelligent CSS selectors for reliability

### 3. Detail Extraction

When `collectDetails` is enabled:
- Visits individual job posting pages
- Extracts complete descriptions and metadata
- Merges API and HTML data for comprehensive results

### 4. Smart Pagination

- Automatically follows "next page" links
- Respects `max_pages` limit
- Stops when `results_wanted` is reached

## Performance Tips

**For Speed:** Disable `collectDetails` to skip detail page visits and extract only listing data.

**For Completeness:** Enable `collectDetails` and increase `results_wanted` for comprehensive datasets.

**For Reliability:** The scraper automatically uses API-first extraction with HTML fallback for maximum reliability.

**For Scale:** Use residential proxies and moderate `maxConcurrency` to avoid rate limiting.

## Proxy Configuration

Residential proxies are recommended for Kununu to prevent blocking:

```json
{
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Compliance & Best Practices

- **Rate Limiting:** The scraper includes built-in delays and session management
- **Robots.txt:** Respects standard web scraping protocols
- **Data Usage:** Ensure compliance with data protection regulations (GDPR)
- **Terms of Service:** Review Kununu's terms before commercial use

## Use Cases

### Recruitment & HR

- Track competitor hiring activities
- Identify talent acquisition trends
- Monitor salary benchmarks

### Business Intelligence

- Analyze job market dynamics
- Research industry growth indicators
- Identify expanding companies

### Career Platforms

- Aggregate job listings for job boards
- Provide comprehensive search capabilities
- Offer salary transparency

### Market Research

- Study employment trends by region
- Analyze skill demand patterns
- Research company growth signals

## Troubleshooting

### No Results Returned

- Verify search parameters match Kununu's format
- Check if location name is spelled correctly (German names)
- Try broader search terms or remove filters

### Incomplete Data

- Enable `collectDetails` for full information
- Ensure residential proxies are configured
- Increase `requestHandlerTimeoutSecs` for slow responses

### Rate Limiting Issues

- Reduce `maxConcurrency` in crawler settings
- Use Apify residential proxies
- Add delays between requests

## Support & Updates

This scraper is regularly maintained to adapt to Kununu's website changes. For issues or feature requests, contact the developer through Apify.

---

**Start extracting valuable job market data from Kununu today!**
