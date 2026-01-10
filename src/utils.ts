import {type Page, type Browser, type BrowserContext, type Locator} from 'playwright';
import {createObjectCsvWriter} from "csv-writer";
import {chromium} from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import * as fs from 'fs';

chromium.use(stealth());

/**
 * Global configuration settings for the scraper.
 * Contains timeouts, concurrency limits, viewport settings, and anti-bot behavior parameters.
 */
export const CONFIG = {
    LOCATOR_TIMEOUT: 10000,
    PAGE_TIMEOUT: 30000,
    CONCURRENCY_LIMIT: 3,
    MAX_RETRIES: 3,
    VIEWPORT: {width: 1920, height: 1080},
    CAPTCHA_WAIT_STABILIZE: 10000,
    CAPTCHA_HOLD_MIN: 10000,
    CAPTCHA_HOLD_RANDOM: 30000,
    BATCH_DELAY_MIN: 1000,
    BATCH_DELAY_MAX: 3000,
    HUMAN_DELAY_MIN: 1000,
    HUMAN_DELAY_MAX: 5000,
    AMAZON_CONTINUE_WAIT: 15000,
    AMAZON_POST_CLICK_DELAY_MIN: 5000,
    AMAZON_POST_CLICK_DELAY_MAX: 15000,
    WALMART_POST_CAPTCHA_DELAY_MIN: 10000,
    WALMART_POST_CAPTCHA_DELAY_MAX: 20000,
    EXTRACT_TEXT_TIMEOUT: 2000,
    INTERNAL_NAVIGATION_TIMEOUT: 10000,
    MOUSE_START_X: 100,
    MOUSE_START_Y: 100,
    WHEEL_SCROLL_X: 0,
    WHEEL_SCROLL_Y: 200,
    DESCRIPTION_MAX_LENGTH: 500,
    FALLBACK_DESCRIPTION: 'FAILED',
    EMPTY_STRING: '',
    USER_AGENTS: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ],
    LOCALE: 'en-US'
};

/**
 * Represents the standardized structure of scraped product data.
 */
export interface Product {
    SKU: string;
    Source: string;
    Title: string;
    Description: string;
    Price: string;
    'Number of Reviews': string;
    Rating: string;
}

/**
 * Represents the input required to initiate a scraping task for a specific item.
 */
export interface SKUInput {
    Type: 'Amazon' | 'Walmart' | string;
    SKU: string;
}

/**
 * Defines the CSS selectors used to extract specific data points for a given retailer.
 */
type SelectorConfig = {
    title: string[];
    description: string[];
    price: string[];
    reviews: string[];
    rating: string[];
};

/**
 * Maps retailer names to their respective CSS selector configurations.
 */
const SELECTORS_MAP: Record<string, SelectorConfig> = {
    Amazon: {
        title: ['#productTitle', '#title', '.qa-title-text'],
        description: ['#productDescription', '#feature-bullets'],
        price: ['.a-price .a-offscreen', '#corePriceDisplay_desktop_feature_div span', '.a-color-price'],
        reviews: ['#acrCustomerReviewText', '#acrCustomerReviewLink'],
        rating: ['i.a-icon-star span', 'span[data-hook="rating-out-of-text"]', '.a-icon-alt']
    },
    Walmart: {
        title: ['h1', '[itemprop="name"]'],
        description: ['meta[name="description"]'],
        price: ['[itemprop="price"]', '.price-display .display-price', '[data-testid="price-wrap"]'],
        reviews: ['script[data-seo-id="schema-org-product"]', '.rating-number', '[data-testid="reviews-count"]', '.w_D'],
        rating: ['script[data-seo-id="schema-org-product"]', '[data-testid="average-rating"]', '.rating-number']
    }
};

/**
 * The CSV writer instance configured with headers matching the Product interface.
 */
export const csvWriterInstance = createObjectCsvWriter({
    path: 'product_data.csv',
    header: [
        {id: 'SKU', title: 'SKU'},
        {id: 'Source', title: 'Source'},
        {id: 'Title', title: 'Title'},
        {id: 'Description', title: 'Description'},
        {id: 'Price', title: 'Price'},
        {id: 'Number of Reviews', title: 'Number of Reviews'},
        {id: 'Rating', title: 'Rating'}
    ]
});

/**
 * Manages the browser lifecycle and executes scraping tasks for Amazon and Walmart products.
 * Handles concurrency, anti-bot detection, and error logging.
 */
export class ProductScraper {
    private browser: Browser | null = null;
    private readonly errorStream: fs.WriteStream;

    /**
     * Initializes the ProductScraper and sets up the error logging stream.
     */
    constructor() {
        this.errorStream = fs.createWriteStream('errors.log', {flags: 'a'});
    }

    /**
     * Launches the Chromium browser with specific flags to reduce bot detection.
     * If the browser is already initialized, this method does nothing.
     */
    async init(): Promise<void> {
        if (this.browser) return;
        this.browser = await chromium.launch({
            headless: true,
            channel: 'chrome',
            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-webrtc',
                '--disable-infobars',
                '--disable-setuid-sandbox',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                `--window-size=${CONFIG.VIEWPORT.width},${CONFIG.VIEWPORT.height}`
            ]
        });
    }

    /**
     * Closes the browser instance and terminates the error log stream.
     */
    async close(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
        if (this.errorStream) {
            this.errorStream.end();
        }
    }

    /**
     * Processes a list of SKUs in batches based on the configured concurrency limit.
     * @param skus - An array of SKUInput objects containing the SKU and retailer type.
     * @returns A promise that resolves to an array of scraped Product objects.
     */
    async processSKUs(skus: SKUInput[]): Promise<Product[]> {
        await this.init();
        const results: Product[] = [];
        const queue = [...skus];
        const activeWorkers: Promise<void>[] = [];

        console.log(`${new Date().toISOString()}: Starting processing pool for ${skus.length} SKUs with concurrency ${CONFIG.CONCURRENCY_LIMIT}`);

        while (queue.length > 0 || activeWorkers.length > 0) {
            while (queue.length > 0 && activeWorkers.length < CONFIG.CONCURRENCY_LIMIT) {
                const sku = queue.shift();
                if (sku) {
                    const worker = this.scrapeWithRetry(sku).then(product => {
                        results.push(product);
                    });

                    const workerPromise = worker.finally(() => {
                        activeWorkers.splice(activeWorkers.indexOf(workerPromise), 1);
                    });

                    activeWorkers.push(workerPromise);
                }
            }

            if (activeWorkers.length > 0) {
                await Promise.race(activeWorkers);
            }
        }

        return results;
    }

    /**
     * Wraps the single SKU scraping logic with a retry mechanism.
     * Attempts to scrape the product up to CONFIG.MAX_RETRIES times.
     * @param sku - The SKU input data.
     * @returns A promise resolving to the scraped Product or a fallback error object after retries exhausted.
     */
    private async scrapeWithRetry(sku: SKUInput): Promise<Product> {
        let attempt = 0;

        while (attempt < CONFIG.MAX_RETRIES) {
            attempt++;
            try {
                const product = await this.scrapeSingleSKU(sku);

                if (product.Title === 'ERROR' || product.Title.includes('Robot Check')) {
                    throw new Error('Soft detection or content load failure');
                }

                return product;
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown';
                console.warn(`${new Date().toISOString()}: Warning - Attempt ${attempt}/${CONFIG.MAX_RETRIES} failed for ${sku.SKU}: ${msg}`);

                if (attempt < CONFIG.MAX_RETRIES) {
                    await this.randomDelay(2000, 5000);
                }
            }
        }

        this.logError(sku.Type, sku.SKU, new Error(`Failed after ${CONFIG.MAX_RETRIES} attempts`));
        return this.createFallbackProduct(sku, `FAILED after ${CONFIG.MAX_RETRIES} attempts`);
    }

    /**
     * Orchestrates the scraping process for a single SKU.
     * Handles context creation, data fetching, error handling, and cleanup.
     * @param sku - The SKU input data.
     * @returns A promise resolving to the scraped Product or a fallback error object.
     */
    private async scrapeSingleSKU(sku: SKUInput): Promise<Product> {
        if (!this.browser) return this.createFallbackProduct(sku, "Browser not initialized");

        let context: BrowserContext | null = null;
        let page: Page | null = null;
        let product: Product;

        try {
            context = await this.createBrowserContext();
            page = await context.newPage();

            console.log(`${new Date().toISOString()}: Starting task for ${sku.Type} product with SKU ${sku.SKU}`);
            product = await this.fetchProductData(page, sku);

        } catch (error) {
            product = this.createFallbackProduct(sku, "Temporary Failure");
            throw error;
        } finally {
            try {
                if (page) await page.close();
                if (context) await context.close();
            } catch (e) {
            }
            console.log(`${new Date().toISOString()}: Finished task for ${sku.Type} product with SKU ${sku.SKU}`);
        }

        return product;
    }

    /**
     * Creates a new browser context with randomized user agent and specific locale settings.
     * Forces US geolocation (NY) and timezone to ensure correct currency and availability.
     * Blocks requests for media and font resources to improve performance.
     * @returns A configured BrowserContext.
     */
    private async createBrowserContext(): Promise<BrowserContext> {
        if (!this.browser) throw new Error("Browser not ready");

        const userAgent = CONFIG.USER_AGENTS[Math.floor(Math.random() * CONFIG.USER_AGENTS.length)];

        const context = await this.browser.newContext({
            userAgent: userAgent,
            viewport: CONFIG.VIEWPORT,
            locale: CONFIG.LOCALE,
            timezoneId: 'America/New_York',
            geolocation: {latitude: 40.7128, longitude: -74.0060},
            deviceScaleFactor: 1,
            hasTouch: false,
            isMobile: false,
            permissions: ['geolocation'],
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            }
        });

        await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,eot,css}', route => route.abort());
        return context;
    }

    /**
     * Navigates to the product page and orchestrates the extraction logic.
     * Includes handling for blocks, bot detection, human-like interaction, and validation.
     * @param page - The Playwright Page object.
     * @param sku - The SKU input data.
     * @returns The extracted Product data.
     */
    private async fetchProductData(page: Page, sku: SKUInput): Promise<Product> {
        const selectors = SELECTORS_MAP[sku.Type];
        if (!selectors) throw new Error("Selectors not mapped");

        const url = this.resolveProductUrl(sku);

        await this.navigateToPage(page, url);
        await this.handleSoftBlock(page, sku);
        await this.checkForBotDetection(page);

        await this.humanizeInteraction(page);
        await this.waitForProductContent(page, selectors);

        const data = await this.extractData(page, selectors);
        await this.validateExtractedData(data, page);

        return {
            SKU: sku.SKU,
            Source: sku.Type,
            ...data
        };
    }

    /**
     * Constructs the full product URL based on the retailer type and SKU.
     * @param sku - The SKU input data.
     * @returns The full URL string.
     */
    private resolveProductUrl(sku: SKUInput): string {
        return sku.Type === 'Walmart'
            ? `https://www.walmart.com/ip/${sku.SKU}`
            : `https://www.amazon.com/dp/${sku.SKU}`;
    }

    /**
     * Navigates the page to the specified URL and checks for HTTP errors.
     * @param page - The Playwright Page object.
     * @param url - The URL to navigate to.
     * @throws Error if the response is empty or the status code indicates failure.
     */
    private async navigateToPage(page: Page, url: string): Promise<void> {
        const response = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: CONFIG.PAGE_TIMEOUT});

        if (!response) throw new Error("No Response");
        if (response.status() === 404) throw new Error("Page Not Found (404)");
        if (response.status() > 399) throw new Error(`HTTP Error: ${response.status()}`);
    }

    /**
     * Routes soft-block handling to the specific logic for the retailer.
     * @param page - The Playwright Page object.
     * @param sku - The SKU input containing the retailer type.
     */
    private async handleSoftBlock(page: Page, sku: SKUInput): Promise<void> {
        if (sku.Type === 'Amazon') await this.handleAmazonBlock(page);
        else if (sku.Type === 'Walmart') await this.handleWalmartBlock(page);
    }

    /**
     * Attempts to bypass Amazon's "soft block" interstitials (e.g., "Continue shopping").
     * @param page - The Playwright Page object.
     */
    private async handleAmazonBlock(page: Page): Promise<void> {
        try {
            const continueBtn = page.locator('text="Continue shopping"').first();
            if (await continueBtn.isVisible({timeout: 1000})) {
                await continueBtn.click();
                await page.waitForLoadState('domcontentloaded');
                await this.randomDelay(CONFIG.AMAZON_POST_CLICK_DELAY_MIN, CONFIG.AMAZON_POST_CLICK_DELAY_MAX);
            }
        } catch (e) {
        }
    }

    /**
     * Attempts to detect and resolve Walmart CAPTCHAs.
     * @param page - The Playwright Page object.
     */
    private async handleWalmartBlock(page: Page): Promise<void> {
        try {
            const captchaBtn = await this.findWalmartCaptcha(page);
            if (captchaBtn) await this.resolveWalmartCaptcha(page, captchaBtn);
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Unknown';
            console.log(`${new Date().toISOString()}: Warning - Error in Walmart captcha logic: ${msg}`);
        }
    }

    /**
     * Scans the page and iframes for known Walmart CAPTCHA selectors.
     * @param page - The Playwright Page object.
     * @returns The CAPTCHA locator if found, otherwise null.
     */
    private async findWalmartCaptcha(page: Page): Promise<Locator | null> {
        const possibleSelectors = ['#px-captcha', '#px-captcha-wrapper', '[aria-label="Press & Hold"]'];

        for (const sel of possibleSelectors) {
            const loc = page.locator(sel).first();
            if (await loc.isVisible().catch(() => false)) return loc;
        }

        for (const frame of page.frames()) {
            const loc = frame.locator('#px-captcha').first();
            if (await loc.isVisible().catch(() => false)) return loc;
        }
        return null;
    }

    /**
     * Simulates a "Press & Hold" interaction to solve Walmart CAPTCHA.
     * @param page - The Playwright Page object.
     * @param captchaBtn - The locator for the CAPTCHA button.
     */
    private async resolveWalmartCaptcha(page: Page, captchaBtn: Locator): Promise<void> {
        await page.waitForTimeout(CONFIG.CAPTCHA_WAIT_STABILIZE);
        const box = await captchaBtn.boundingBox().catch(() => null);

        if (!box) return;

        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        const holdDuration = CONFIG.CAPTCHA_HOLD_MIN + Math.floor(Math.random() * CONFIG.CAPTCHA_HOLD_RANDOM);
        await page.waitForTimeout(holdDuration);
        await page.mouse.up();

        await page.waitForLoadState('domcontentloaded').catch(() => {
        });
        await this.randomDelay(CONFIG.WALMART_POST_CAPTCHA_DELAY_MIN, CONFIG.WALMART_POST_CAPTCHA_DELAY_MAX);
    }

    /**
     * Checks the page title for keywords indicating bot detection or request blocking.
     * @param page - The Playwright Page object.
     * @throws Error if bot detection keywords are found in the title.
     */
    private async checkForBotDetection(page: Page): Promise<void> {
        const title = await page.title().catch(() => CONFIG.EMPTY_STRING);
        if (/Robot|Captcha|Sorry|Page Not Found/i.test(title)) {
            throw new Error("Anti-bot detected or Invalid Page");
        }
    }

    /**
     * Waits for the product title selector to become visible to ensure content is loaded.
     * @param page - The Playwright Page object.
     * @param selectors - The selector configuration for the current retailer.
     */
    private async waitForProductContent(page: Page, selectors: SelectorConfig): Promise<void> {
        try {
            const combinedSelectors = selectors.title.join(',');
            await page.waitForSelector(combinedSelectors, {state: 'visible', timeout: CONFIG.LOCATOR_TIMEOUT});
        } catch {
            throw new Error("Timeout: Product title never appeared on screen");
        }
    }

    /**
     * Validates that the extracted data contains essential fields (e.g., Title).
     * Checks for specific "Currently unavailable" states if the title is missing.
     * @param data - The partial extracted data.
     * @param page - The Playwright Page object for further inspection if validation fails.
     */
    private async validateExtractedData(data: { Title: string }, page: Page): Promise<void> {
        if (!data.Title) {
            const bodyText = await page.locator('body').innerText().catch(() => CONFIG.EMPTY_STRING);
            if (bodyText.includes("Currently unavailable")) throw new Error("Product Currently Unavailable");
            throw new Error("Validation Failed: Content loaded but Title is empty");
        }
    }

    /**
     * Extracts text content or attribute data from the page using the provided selector configuration.
     * Handles standard elements, Meta tags, and JSON-LD scripts for structured data.
     * Applies Regex cleaning to Price and Reviews to ensure numerical format.
     * @param page - The Playwright Page object.
     * @param selectors - The selector configuration.
     * @returns An object containing cleaned strings for Title, Description, Price, Reviews, and Rating.
     */
    private async extractData(page: Page, selectors: SelectorConfig) {

        const getTextFromSelectors = async (selectorList: string[], dataType?: 'reviews' | 'rating') => {
            for (const sel of selectorList) {
                try {
                    const el = page.locator(sel).first();

                    if (sel.startsWith('script')) {
                        const scriptContent = await el.textContent();
                        if (scriptContent) {
                            try {
                                const json = JSON.parse(scriptContent);
                                const data = Array.isArray(json) ? json[0] : json;

                                if (dataType === 'rating' && data?.aggregateRating?.ratingValue) {
                                    return data.aggregateRating.ratingValue.toString();
                                }
                                if (dataType === 'reviews' && data?.aggregateRating?.reviewCount) {
                                    return data.aggregateRating.reviewCount.toString();
                                }
                            } catch (e) {
                            }
                        }
                    }

                    if (sel.startsWith('meta')) {
                        const content = await el.getAttribute('content');
                        if (content) return content;
                    }

                    if (await el.isVisible()) {
                        return await el.innerText({timeout: CONFIG.EXTRACT_TEXT_TIMEOUT});
                    }
                } catch {
                }
            }
            return CONFIG.EMPTY_STRING;
        };

        const [title, description, price, reviews, rating] = await Promise.all([
            getTextFromSelectors(selectors.title),
            getTextFromSelectors(selectors.description),
            getTextFromSelectors(selectors.price),
            getTextFromSelectors(selectors.reviews, 'reviews'),
            getTextFromSelectors(selectors.rating, 'rating')
        ]);

        return {
            Title: title.trim() || "ERROR",
            Description: description.slice(0, CONFIG.DESCRIPTION_MAX_LENGTH).replace(/\s+/g, ' ').trim(),
            Price: price.replace(/[^0-9.]/g, ''),
            'Number of Reviews': reviews.replace(/\D/g, ''),
            Rating: rating.split('out of')[0].trim().replace(/[^\d.]/g, '')
        };
    }

    /**
     * Creates a fallback Product object filled with error information when scraping fails.
     * @param sku - The SKU input data.
     * @param reason - The error message or reason for failure.
     * @returns A Product object reflecting the failure state.
     */
    private createFallbackProduct(sku: SKUInput, reason: string): Product {
        return {
            SKU: sku.SKU,
            Source: sku.Type,
            Title: reason,
            Description: CONFIG.FALLBACK_DESCRIPTION,
            Price: CONFIG.EMPTY_STRING,
            'Number of Reviews': CONFIG.EMPTY_STRING,
            Rating: CONFIG.EMPTY_STRING
        };
    }

    /**
     * Performs random mouse movements and scrolling to simulate human behavior.
     * @param page - The Playwright Page object.
     */
    private async humanizeInteraction(page: Page): Promise<void> {
        try {
            await page.mouse.move(CONFIG.MOUSE_START_X + Math.random() * 10, CONFIG.MOUSE_START_Y + Math.random() * 10);
            await page.mouse.wheel(0, CONFIG.WHEEL_SCROLL_Y);
            await this.randomDelay(CONFIG.HUMAN_DELAY_MIN, CONFIG.HUMAN_DELAY_MAX);
        } catch {
        }
    }

    /**
     * Creates a promise that resolves after a random delay within the specified range.
     * @param min - Minimum delay in milliseconds.
     * @param max - Maximum delay in milliseconds.
     */
    private async randomDelay(min: number, max: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));
    }

    /**
     * Logs error details to the persistent error stream.
     * @param type - The retailer type (e.g., Amazon, Walmart).
     * @param sku - The SKU that caused the error.
     * @param error - The error object or unknown value caught.
     */
    private logError(type: string, sku: string, error: unknown): void {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        const logLine = `${new Date().toISOString()}: Error fetching ${type} product with SKU ${sku}: ${msg}\n`;
        if (this.errorStream.writable) {
            this.errorStream.write(logLine);
        }
    }
}