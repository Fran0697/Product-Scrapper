import * as fs from 'fs';
import {ProductScraper, csvWriterInstance} from "./utils.ts";

const errorLog = fs.createWriteStream('errors.log', {flags: 'a'});

/**
 * Runs the product scraper to fetch and write product data to a CSV file.
 */
const runScraper = async () => {
    const scraper = new ProductScraper();
    try {
        const rawData = fs.readFileSync('skus.json', 'utf8');
        const skusData = JSON.parse(rawData);
        const validProducts = await scraper.processSKUs(skusData.skus);
        if (validProducts.length > 0) {
            await csvWriterInstance.writeRecords(validProducts);
            console.log(`${new Date().toISOString()}: Successfully wrote ${validProducts.length} products to CSV`);
        } else {
            console.log("No valid products found to write.");
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errorLog.write(`${new Date().toISOString()}: Critical Error running scraper: ${message}\n`);
        console.error("Critical Error:", message);
    } finally {
        await scraper.close();
    }
};

await runScraper();