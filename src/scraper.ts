import {chromium} from 'playwright';
import * as fs from 'fs';
import {csvWriterInstance, fetchAmazonProduct, fetchWalmartProduct, type Product} from "./utils.ts";

const errorLog = fs.createWriteStream('errors.log', {flags: 'a'});
const infoLog = fs.createWriteStream('info.log', {flags: 'a'});

const runScraper = async () => {
    const skusData = JSON.parse(fs.readFileSync('skus.json', 'utf8'));
    const tasks: Promise<void>[] = [];
    for (const sku of skusData.skus) {
        tasks.push((async () => {
            infoLog.write(`${new Date().toISOString()}: Starting task for ${sku.Type} product with SKU ${sku.SKU}\n`);
            const browser = await chromium.launch({headless: true});
            const context = await browser.newContext();
            const page = await context.newPage();
            try {
                let product: Product | null = null;
                if (sku.Type === 'Amazon') {
                    infoLog.write(`${new Date().toISOString()}: Fetching Amazon product with SKU ${sku.SKU}\n`);
                    product = await fetchAmazonProduct(page, sku.SKU);
                } else if (sku.Type === 'Walmart') {
                    infoLog.write(`${new Date().toISOString()}: Fetching Walmart product with SKU ${sku.SKU}\n`);
                    product = await fetchWalmartProduct(page, sku.SKU);
                }
                if (product) {
                    await csvWriterInstance.writeRecords([product]);
                    infoLog.write(`${new Date().toISOString()}: Successfully wrote ${sku.Type} product with SKU ${sku.SKU}\n`);
                }
            } catch (error: unknown) {
                if (error instanceof Error) {
                    errorLog.write(`${new Date().toISOString()}: Error fetching ${sku.Type} product with SKU ${sku.SKU}: ${error.message}\n`);
                } else {
                    errorLog.write(`${new Date().toISOString()}: Error fetching ${sku.Type} product with SKU ${sku.SKU}: An unknown error occurred\n`);
                }
            } finally {
                await browser.close();
                infoLog.write(`${new Date().toISOString()}: Finished task for ${sku.Type} product with SKU ${sku.SKU}\n`);
            }
        })());
    }
    await Promise.all(tasks);
};

await runScraper();