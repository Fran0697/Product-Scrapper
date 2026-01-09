import * as fs from 'fs';
import {csvWriterInstance, processSKUs} from "./utils.ts";

const errorLog = fs.createWriteStream('errors.log', {flags: 'a'});
const infoLog = fs.createWriteStream('info.log', {flags: 'a'});

const runScraper = async () => {
    try {
        const skusData = JSON.parse(fs.readFileSync('skus.json', 'utf8'));
        const validProducts = await processSKUs(skusData.skus);

        if (validProducts.length > 0) {
            await csvWriterInstance.writeRecords(validProducts);
            infoLog.write(`${new Date().toISOString()}: Successfully wrote ${validProducts.length} products to CSV\n`);
        }
    } catch (error: unknown) {
        if (error instanceof Error) {
            errorLog.write(`${new Date().toISOString()}: Error running scraper: ${error.message}\n`);
        } else {
            errorLog.write(`${new Date().toISOString()}: Error running scraper: An unknown error occurred\n`);
        }
    }
};

await runScraper();