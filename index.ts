import { chromium } from 'playwright';

const runScraper = async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    console.log("Navigating...");
    await page.goto('https://example.com');

    const title = await page.title();
    const data = await page.evaluate(() => {
        return document.querySelector('h1')?.innerText;
    });

    console.log(`Title: ${title}`);
    console.log(`H1 Content: ${data}`);

    await browser.close();
};

await runScraper();