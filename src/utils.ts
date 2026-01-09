import {chromium, type Page} from 'playwright';
import * as csvWriter from "csv-writer";
import fs from "fs";

const errorLog = fs.createWriteStream('errors.log', {flags: 'a'});
export const LOCATOR_TIMEOUT = 5000;

export interface Product {
    SKU: string;
    Source: string;
    Title: string;
    Description: string;
    Price: string;
    'Number of Reviews': string;
}

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

export const processSKUs = async (skus: { Type: string, SKU: string }[]): Promise<Product[]> => {
    const tasks: Promise<Product | null>[] = [];
    for (const sku of skus) {
        tasks.push(processSKU(sku));
    }
    const products = await Promise.all(tasks);
    return products.filter((product): product is Product => product !== null);
};

const processSKU = async (sku: { Type: string, SKU: string }): Promise<Product | null> => {
    console.log(`${new Date().toISOString()}: Starting task for ${sku.Type} product with SKU ${sku.SKU}`);
    const {browser, page} = await initializeBrowser();
    try {
        return await fetchProduct(page, sku);
    } catch (error: unknown) {
        logError(error, sku.Type, sku.SKU);
        return null;
    } finally {
        await browser.close();
        console.log(`${new Date().toISOString()}: Finished task for ${sku.Type} product with SKU ${sku.SKU}`);
    }
};

const getTextWithTimeout = async (page: Page, selector: string): Promise<string> => {
    return await page.locator(selector).first().innerText({timeout: LOCATOR_TIMEOUT});
};

const fetchProduct = async (
    page: Page,
    sku: { Type: string, SKU: string }
): Promise<Product | null> => {
    try {
        const source = sku.Type;
        await page.goto(`https://${source.toLowerCase()}.com/dp/${sku.SKU}`);

        if (await page.isVisible('text="Page Not Found"')) {
            return {
                SKU: sku.SKU,
                Source: source,
                Title: `Item not found on ${source}`,
                Description: `The item with the specified SKU could not be found on ${source}.`,
                Price: '',
                'Number of Reviews': ''
            };
        }

        const title = await getTextWithTimeout(page, '#productTitle');
        const description = await getTextWithTimeout(page, '#productDescription span');
        const price = await getTextWithTimeout(page, '.a-price-whole');
        const reviews = await getTextWithTimeout(page, '#acrCustomerReviewText');

        return {
            SKU: sku.SKU,
            Source: source,
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

const initializeBrowser = async () => {
    const browser = await chromium.launch({headless: true});
    const context = await browser.newContext();
    const page = await context.newPage();
    return {browser, page};
};

const logError = (error: unknown, type: string, sku: string) => {
    if (error instanceof Error) {
        errorLog.write(`${new Date().toISOString()}: Error fetching ${type} product with SKU ${sku}: ${error.message}\n`);
    } else {
        errorLog.write(`${new Date().toISOString()}: Error fetching ${type} product with SKU ${sku}: An unknown error occurred\n`);
    }
};