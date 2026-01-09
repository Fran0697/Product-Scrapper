import {type Page} from 'playwright';
import * as csvWriter from "csv-writer";

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

export const fetchAmazonProduct = async (page: Page, sku: string): Promise<Product | null> => {
    try {
        await page.goto(`https://www.amazon.com/dp/${sku}`);

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
export const fetchWalmartProduct = async (page: Page, sku: string): Promise<Product | null> => {
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
