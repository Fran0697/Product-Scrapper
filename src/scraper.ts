import {chromium} from 'playwright';
import * as fs from 'fs';
import {csvWriterInstance, fetchAmazonProduct, fetchWalmartProduct, type Product} from "./utils.ts";

const errorLog = fs.createWriteStream('errors.log', {flags: 'a'});

const runScraper = async () => {
    const browser = await chromium.launch({headless: true});
    const page = await browser.newPage();

    try {
        const skusData = JSON.parse(fs.readFileSync('skus.json', 'utf8'));
        for (const sku of skusData.skus) {
            let product: Product | null = null;
            try {
                if (sku.Type === 'Amazon') {
                    product = await fetchAmazonProduct(page, sku.SKU);
                } else if (sku.Type === 'Walmart') {
                    product = await fetchWalmartProduct(page, sku.SKU);
                }
            } catch (error) {
                errorLog.write(`${new Date().toISOString()}: Error fetching ${sku.Type} product with SKU ${sku.SKU}\n`);
                continue;
            }
            if (product) {
                csvWriterInstance.writeRecords([product]).then(() => console.log(`Successfully wrote ${sku.Type} product with SKU ${sku.SKU}`));
            }

        }
    } catch (error) {
        errorLog.write(`${new Date().toISOString()}: Error reading skus.json\n`);
    }
    await browser.close();
};

await runScraper();