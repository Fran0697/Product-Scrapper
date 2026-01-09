import {chromium, type Page} from 'playwright';
import * as csvWriter from "csv-writer";
import fs from "fs";

const errorLog = fs.createWriteStream('errors.log', {flags: 'a'});
const infoLog = fs.createWriteStream('info.log', {flags: 'a'});

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

const fetchAmazonProduct = async (page: Page, sku: string): Promise<Product | null> => {
    try {
        await page.goto(`https://www.amazon.com/dp/${sku}`);

        if (await page.isVisible('text="Page Not Found"')) {
            return {
                SKU: sku,
                Source: 'Amazon',
                Title: 'Item not found on Amazon',
                Description: 'The item with the specified SKU could not be found on Amazon.',
                Price: '',
                'Number of Reviews': ''
            };
        }

        const title = await page.locator('#productTitle').first().innerText();
        const description = await page.locator('#productDescription span').first().innerText();
        const price = await page.locator('.a-price-whole').first().innerText();
        const reviews = await page.locator('#acrCustomerReviewText').first().innerText();

        return {
            SKU: sku,
            Source: 'Amazon',
            Title: title || '',
            Description: description || '',
            Price: price || '',
            'Number of Reviews': reviews || ''
        };
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to fetch Amazon product with SKU ${sku}: ${error.message}`);
        } else {
            throw new Error(`Failed to fetch Amazon product with SKU ${sku}: An unknown error occurred\n`);
        }
    }
};

//TODO Implement this. Just a place holder
const fetchWalmartProduct = async (page: Page, sku: string): Promise<Product | null> => {
    try {
        await page.goto(`https://www.walmart.com/ip/${sku}`);

        const title = await page.locator('#productTitle').first().innerText();
        const description = await page.locator('#productDescription span').first().innerText();
        const price = await page.locator('.a-price-whole').first().innerText();
        const reviews = await page.locator('#acrCustomerReviewText').first().innerText();

        return {
            SKU: sku,
            Source: 'Walmart',
            Title: title || '',
            Description: description || '',
            Price: price || '',
            'Number of Reviews': reviews || ''
        };
    } catch (error) {
        throw new Error(`Failed to fetch Walmart product with SKU ${sku}`);
    }
};

const initializeBrowser = async () => {
    const browser = await chromium.launch({headless: true});
    const context = await browser.newContext();
    const page = await context.newPage();
    return {browser, page};
};

const processAmazonSKU = async (page: Page, sku: string): Promise<Product | null> => {
    infoLog.write(`${new Date().toISOString()}: Fetching Amazon product with SKU ${sku}\n`);
    return await fetchAmazonProduct(page, sku);
};

const processWalmartSKU = async (page: Page, sku: string): Promise<Product | null> => {
    infoLog.write(`${new Date().toISOString()}: Fetching Walmart product with SKU ${sku}\n`);
    return await fetchWalmartProduct(page, sku);
};

const processSKU = async (sku: { Type: string, SKU: string }): Promise<Product | null> => {
    infoLog.write(`${new Date().toISOString()}: Starting task for ${sku.Type} product with SKU ${sku.SKU}\n`);
    const {browser, page} = await initializeBrowser();
    try {
        let product: Product | null = null;
        if (sku.Type === 'Amazon') {
            product = await processAmazonSKU(page, sku.SKU);
        } else if (sku.Type === 'Walmart') {
            product = await processWalmartSKU(page, sku.SKU);
        }
        return product;
    } catch (error: unknown) {
        logError(error, sku.Type, sku.SKU);
        return null;
    } finally {
        await browser.close();
        infoLog.write(`${new Date().toISOString()}: Finished task for ${sku.Type} product with SKU ${sku.SKU}\n`);
    }
};

const logError = (error: unknown, type: string, sku: string) => {
    if (error instanceof Error) {
        errorLog.write(`${new Date().toISOString()}: Error fetching ${type} product with SKU ${sku}: ${error.message}\n`);
    } else {
        errorLog.write(`${new Date().toISOString()}: Error fetching ${type} product with SKU ${sku}: An unknown error occurred\n`);
    }
};

export const processSKUs = async (skus: { Type: string, SKU: string }[]): Promise<Product[]> => {
    const tasks: Promise<Product | null>[] = [];
    for (const sku of skus) {
        tasks.push(processSKU(sku));
    }
    const products = await Promise.all(tasks);
    return products.filter((product): product is Product => product !== null);
};