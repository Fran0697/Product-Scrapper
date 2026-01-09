import {type Page, type Browser} from 'playwright';
import {createObjectCsvWriter} from "csv-writer";
import {chromium} from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import * as fs from 'fs';

/**
 * Configuration object for the scraper settings.
 */
export const CONFIG = {
    LOCATOR_TIMEOUT: 10000,
    PAGE_TIMEOUT: 30000,
    CONCURRENCY_LIMIT: 3,
    VIEWPORT: {width: 1920, height: 1080}
};

/**
 * Interface representing a product with various attributes.
 */
export interface Product {
    SKU: string;
    Source: string;
    Title: string;
    Description: string;
    Price: string;
    'Number of Reviews': string;
}

/**
 * Interface for the input SKU data.
 */
export interface SKUInput {
    Type: string;
    SKU: string;
}

type SelectorConfig = {
    title: string;
    description: string;
    price: string;
    reviews: string;
};

/**
 * Map of selectors for different supported sources.
 */
const SELECTORS_MAP: Record<string, SelectorConfig> = {
    Amazon: {
        title: '#productTitle, #title, .qa-title-text',
        description: '#productDescription',
        price: '.a-price .a-offscreen, #corePriceDisplay_desktop_feature_div span, .a-color-price',
        reviews: '#acrCustomerReviewText, #acrCustomerReviewLink'
    },
    Walmart: {
        title: 'h1, [itemprop="name"]',
        description: '.product-description, [data-testid="product-description"], .w_A',
        price: '[itemprop="price"], .price-display .display-price, [data-testid="price-wrap"]',
        reviews: '.rating-number, [data-testid="reviews-count"], .w_D'
    }
};

/**
 * CSV writer instance for writing product data to a CSV file.
 */
export const csvWriterInstance = createObjectCsvWriter({
    path: 'product_data.csv',
    header: [
        {id: 'SKU', title: 'SKU'},
        {id: 'Source', title: 'Source'},
        {id: 'Title', title: 'Title'},
        {id: 'Description', title: 'Description'},
        {id: 'Price', title: 'Price'},
        {id: 'Number of Reviews', title: 'Number of Reviews'}
    ]
});

/**
 * Class for scraping product data with performance optimizations and bot evasion.
 */
export class ProductScraper {
    private browser: Browser | null = null;
    private readonly errorStream: fs.WriteStream;

    constructor() {
        chromium.use(stealth());
        this.errorStream = fs.createWriteStream('errors.log', {flags: 'a'});
    }

    /**
     * Initializes the browser instance.
     */
    async init() {
        if (this.browser) return;
        this.browser = await chromium.launch({
            headless: false,
            channel: 'chrome',
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-infobars',
                `--window-size=${CONFIG.VIEWPORT.width},${CONFIG.VIEWPORT.height}`
            ]
        });
    }

    /**
     * Closes the browser and the error log stream.
     */
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
        if (this.errorStream) {
            this.errorStream.end();
        }
    }

    /**
     * Processes a list of SKUs in batches.
     *
     * @param skus - An array of SKU objects to process.
     * @returns A promise resolving to an array of scraped Product objects.
     */
    async processSKUs(skus: SKUInput[]): Promise<Product[]> {
        await this.init();
        const results: Product[] = [];

        for (let i = 0; i < skus.length; i += CONFIG.CONCURRENCY_LIMIT) {
            const chunk = skus.slice(i, i + CONFIG.CONCURRENCY_LIMIT);
            console.log(`${new Date().toISOString()}: Processing batch ${Math.floor(i / CONFIG.CONCURRENCY_LIMIT) + 1} / ${Math.ceil(skus.length / CONFIG.CONCURRENCY_LIMIT)}...`);

            const batchResults = await Promise.all(
                chunk.map(sku => this.scrapeSingleSKU(sku))
            );

            results.push(...batchResults);

            await this.randomDelay(1000, 3000);
        }

        return results;
    }

    /**
     * Handles the scraping process for a single SKU within an isolated context.
     *
     * @param sku - The SKU input object.
     * @returns The Product object (filled or fallback error).
     */
    private async scrapeSingleSKU(sku: SKUInput): Promise<Product> {
        if (!this.browser) return this.createFallbackProduct(sku, "Browser not initialized");

        let context;
        try {
            context = await this.browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: CONFIG.VIEWPORT,
                locale: 'en-US',
                deviceScaleFactor: 1,
                extraHTTPHeaders: {
                    'Accept-Language': 'en-US,en;q=0.9',
                }
            });

            await context.route('**/*.{png,jpg,jpeg,gif,webp,css,woff,woff2}', route => route.abort());
        } catch (e) {
            return this.createFallbackProduct(sku, "Context Creation Failed");
        }

        let product: Product;
        let page: Page | null = null;

        try {
            page = await context.newPage();
            console.log(`${new Date().toISOString()}: Starting task for ${sku.Type} product with SKU ${sku.SKU}`);

            product = await this.fetchProductData(page, sku);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown Error';
            this.logError(sku.Type, sku.SKU, error);
            product = this.createFallbackProduct(sku, `ERROR: ${errorMessage}`);
        } finally {
            if (context) await context.close();
            console.log(`${new Date().toISOString()}: Finished task for ${sku.Type} product with SKU ${sku.SKU}`);
        }

        return product;
    }

    /**
     * Navigates to the product page and extracts data.
     *
     * @param page - The Playwright Page object.
     * @param sku - The SKU input object.
     * @returns The Product object or throws an error.
     */
    private async fetchProductData(page: Page, sku: SKUInput): Promise<Product> {
        const selectors = SELECTORS_MAP[sku.Type];
        if (!selectors) throw new Error("Selectors not mapped");

        const url = sku.Type === 'Walmart'
            ? `https://www.walmart.com/ip/${sku.SKU}`
            : `https://www.amazon.com/dp/${sku.SKU}`;

        const response = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: CONFIG.PAGE_TIMEOUT});

        if (!response) throw new Error("No Response");
        if (response.status() === 404) throw new Error("Page Not Found (404)");
        if (response.status() > 399) throw new Error(`HTTP Error: ${response.status()}`);

        const title = await page.title();
        if (title.includes("Robot") || title.includes("Captcha") || title.includes("Sorry") || title.includes("Page Not Found")) {
            throw new Error("Anti-bot detected or Invalid Page");
        }

        await this.humanizeInteraction(page);

        try {
            await page.waitForSelector(selectors.title, { state: 'visible', timeout: CONFIG.LOCATOR_TIMEOUT });
        } catch (e) {
            throw new Error("Timeout: Product title never appeared on screen");
        }

        const data = await this.extractData(page, selectors);

        if (!data.Title || data.Title === '') {
            const bodyText = await page.locator('body').innerText();
            if (bodyText.includes("Currently unavailable")) {
                throw new Error("Product Currently Unavailable");
            }
            throw new Error("Validation Failed: Content loaded but Title is empty");
        }

        return {
            SKU: sku.SKU,
            Source: sku.Type,
            ...data
        } as Product;
    }

    /**
     * Extracts text content using the provided selectors.
     *
     * @param page - The Playwright Page object.
     * @param selectors - The selector configuration.
     * @returns An object containing the extracted fields.
     */
    private async extractData(page: Page, selectors: SelectorConfig) {
        const getText = async (sel: string) => {
            try {
                const el = page.locator(sel).first();
                return await el.innerText({timeout: 1000});
            } catch {
                return '';
            }
        };

        const [title, description, price, reviews] = await Promise.all([
            getText(selectors.title),
            getText(selectors.description),
            getText(selectors.price),
            getText(selectors.reviews)
        ]);

        return {
            Title: title.trim(),
            Description: description.slice(0, 200).trim(),
            Price: price.replace(/\n/g, '').trim(),
            'Number of Reviews': reviews.trim()
        };
    }

    /**
     * Creates a fallback product object when an error occurs.
     *
     * @param sku - The SKU input.
     * @param reason - The error message.
     */
    private createFallbackProduct(sku: SKUInput, reason: string): Product {
        return {
            SKU: sku.SKU,
            Source: sku.Type,
            Title: reason,
            Description: 'FAILED',
            Price: '',
            'Number of Reviews': ''
        };
    }

    /**
     * Simulates basic human interaction.
     *
     * @param page - The Playwright Page object.
     */
    private async humanizeInteraction(page: Page) {
        try {
            await page.mouse.move(100, 100);
            await page.mouse.wheel(0, 200);
            await this.randomDelay(500, 1000);
        } catch (e) {
        }
    }

    /**
     * Introduces a random delay between a range.
     *
     * @param min - Minimum delay in ms.
     * @param max - Maximum delay in ms.
     */
    private async randomDelay(min: number, max: number) {
        return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));
    }

    /**
     * Logs errors to the file stream.
     *
     * @param type - Source type.
     * @param sku - Product SKU.
     * @param error - The error encountered.
     */
    private logError(type: string, sku: string, error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        const logLine = `${new Date().toISOString()}: Error fetching ${type} product with SKU ${sku}: ${msg}\n`;
        if (this.errorStream.writable) {
            this.errorStream.write(logLine);
        }
    }
}