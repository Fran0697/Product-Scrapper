import {type Page} from 'playwright';
import * as csvWriter from "csv-writer";
import fs from "fs";
import {chromium} from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

const errorLog = fs.createWriteStream('errors.log', {flags: 'a'});

/**
 * Timeout value for locators in milliseconds.
 */
export const LOCATOR_TIMEOUT = 10000;

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
 * Map of selectors for different sources.
 */
const SELECTORS_MAP: { [key: string]: { title: string, description: string, price: string, reviews: string } } = {
    Amazon: {
        title: '#productTitle',
        description: '#productDescription span',
        price: '#corePriceDisplay_desktop_feature_div span',
        reviews: '#acrCustomerReviewText'
    },
    Walmart: {
        title: '#main-title',
        description: '.product-description p',
        price: '.price-display .display-price',
        reviews: '.reviews-summary .review-count'
    }
};

/**
 * CSV writer instance for writing product data to a CSV file.
 */
export const csvWriterInstance = csvWriter.createObjectCsvWriter({
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
 * Processes a list of SKUs and fetches product data for each.
 *
 * @param skus - An array of SKU objects with Type and SKU properties.
 * @returns A promise that resolves to an array of Product objects.
 */
export const processSKUs = async (skus: { Type: string, SKU: string }[]): Promise<Product[]> => {
    const tasks: Promise<Product | null>[] = [];
    for (const sku of skus) {
        tasks.push(processSKU(sku));
    }
    const products = await Promise.all(tasks);
    return products.filter((product): product is Product => product !== null);
};

/**
 * Processes a single SKU and fetches the corresponding product data.
 *
 * @param sku - An object with Type and SKU properties.
 * @returns A promise that resolves to a Product object or null if an error occurs.
 */
const processSKU = async (sku: { Type: string, SKU: string }): Promise<Product | null> => {
    console.log(`${new Date().toISOString()}: Starting task for ${sku.Type} product with SKU ${sku.SKU}`);
    const {browser, page} = await initializeBrowser();
    try {
        const delay = Math.floor(Math.random() * 9000) + 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return await fetchProduct(page, sku);
    } catch (error: unknown) {
        logError(error, sku.Type, sku.SKU);
        return null;
    } finally {
        await browser.close();
        console.log(`${new Date().toISOString()}: Finished task for ${sku.Type} product with SKU ${sku.SKU}`);
    }
};

/**
 * Fetches the text content of a locator with a specified timeout.
 *
 * @param page - The Playwright Page object.
 * @param selector - The CSS selector for the locator.
 * @returns A promise that resolves to the inner text of the locator or null if a timeout occurs.
 */
const getTextWithTimeout = async (page: Page, selector: string): Promise<string | null> => {
    try {
        return await page.locator(selector).first().innerText({timeout: LOCATOR_TIMEOUT});
    } catch (error) {
        if (error instanceof Error && error.message.includes('Timeout')) {
            console.log(`${new Date().toISOString()}: Timeout occurred while fetching text for selector "${selector}". Returning null.`);
            return null;
        }
        throw error;
    }
};

/**
 * Validates the response from the page.goto call.
 *
 * @param response - The response object from page.goto.
 * @param sku - An object with Type and SKU properties.
 * @param page - The Playwright Page object.
 * @returns A promise that resolves to true if the response is valid, false otherwise.
 */
const validateResponse = async (response: any, sku: { Type: string, SKU: string }, page: Page): Promise<boolean> => {
    if (!response || response.status() !== 200) {
        console.error(`${new Date().toISOString()}: Failed to fetch ${sku.Type} product with SKU ${sku.SKU}. Status code: ${response ? response.status() : 'Unknown'}`);
        return false;
    }

    if (await page.isVisible('text="Rate Limit Exceeded"')) {
        console.error(`${new Date().toISOString()}: Rate limit exceeded for ${sku.Type} product with SKU ${sku.SKU}`);
        return false;
    }
    if (await page.isVisible('text="Page Not Found"')) {
        console.log(`${new Date().toISOString()}: Page not found for ${sku.Type} product with SKU ${sku.SKU}`);
        return false;
    }
    return true;
};

/**
 * Constructs the URL based on the source and SKU.
 *
 * @param sku - An object with Type and SKU properties.
 * @returns The constructed URL as a string.
 */
const constructUrl = (sku: { Type: string, SKU: string }): string => {
    const source = sku.Type.toLowerCase();
    const urlPath = source === 'walmart' ? '/ip/' : '/dp/';
    return `https://${source}.com${urlPath}${sku.SKU}`;
};

/**
 * Fetches product data from a given page and SKU.
 *
 * @param page - The Playwright Page object.
 * @param sku - An object with Type and SKU properties.
 * @returns A promise that resolves to a Product object or null if an error occurs.
 */
const fetchProduct = async (
    page: Page,
    sku: { Type: string, SKU: string }
): Promise<Product | null> => {
    try {
        const url = constructUrl(sku);
        const response = await page.goto(url);

        if (!(await validateResponse(response, sku, page))) {
            return {
                SKU: sku.SKU,
                Source: sku.Type,
                Title: `Item not found on ${sku.Type}`,
                Description: `The item with the specified SKU could not be found on ${sku.Type}.`,
                Price: '',
                'Number of Reviews': ''
            };
        }

        const selectors = SELECTORS_MAP[sku.Type];
        if (!selectors) {
            console.error(`${new Date().toISOString()}: No selectors defined for source ${sku.Type}`);
            return null;
        }

        const title = await getTextWithTimeout(page, selectors.title);
        const description = await getTextWithTimeout(page, selectors.description);
        const price = await getTextWithTimeout(page, selectors.price);
        const reviews = await getTextWithTimeout(page, selectors.reviews);

        return {
            SKU: sku.SKU,
            Source: sku.Type,
            Title: title || '',
            Description: description || '',
            Price: price || '',
            'Number of Reviews': reviews || ''
        };
    } catch (error) {
        logError(error, sku.Type, sku.SKU);
        return null;
    }
};

/**
 * Initializes the browser and creates a new context with specific configurations.
 *
 * @returns A promise that resolves to an object containing the browser, context, and page.
 */
const initializeBrowser = async () => {
    chromium.use(stealth());
    const browser = await chromium.launch({headless: true});
    const context = await browser.newContext({
        locale: 'en-US',
        geolocation: {longitude: -122.084095, latitude: 37.42202},
        timezoneId: 'America/Los_Angeles'
    });
    const page = await context.newPage();
    return {browser, page};
};

/**
 * Logs an error message to the error log file.
 *
 * @param error - The error object or unknown value.
 * @param type - The source type of the product (e.g., Amazon).
 * @param sku - The SKU of the product.
 */
const logError = (error: unknown, type: string, sku: string) => {
    if (error instanceof Error) {
        errorLog.write(`${new Date().toISOString()}: Error fetching ${type} product with SKU ${sku}: ${error.message}\n`);
    } else {
        errorLog.write(`${new Date().toISOString()}: Error fetching ${type} product with SKU ${sku}: An unknown error occurred\n`);
    }
};