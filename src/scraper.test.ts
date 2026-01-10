import { describe, expect, test, jest, beforeEach, afterEach, beforeAll } from '@jest/globals';

jest.unstable_mockModule('playwright-extra', () => ({
    chromium: {
        use: jest.fn(),
        launch: jest.fn().mockImplementation(() => Promise.resolve({
            newContext: jest.fn().mockImplementation(() => Promise.resolve({
                newPage: jest.fn().mockImplementation(() => Promise.resolve({
                    goto: jest.fn(),
                    close: jest.fn(),
                    waitForSelector: jest.fn(),
                    $: jest.fn(),
                    locator: jest.fn(() => ({ all: async () => [] }))
                })),
                close: jest.fn(),
            })),
            close: jest.fn(),
        }))
    }
} as any));

jest.unstable_mockModule('puppeteer-extra-plugin-stealth', () => ({
    default: jest.fn()
} as any));

jest.unstable_mockModule('fs', () => ({
    createWriteStream: jest.fn(() => ({
        write: jest.fn().mockReturnValue(true),
        end: jest.fn(),
        writable: true
    })),
    readFileSync: jest.fn().mockReturnValue('{"skus": []}'),
    existsSync: jest.fn(),
    mkdirSync: jest.fn()
} as any));

jest.unstable_mockModule('csv-writer', () => ({
    createObjectCsvWriter: jest.fn(() => ({
        writeRecords: jest.fn().mockImplementation(() => Promise.resolve())
    }))
} as any));

describe('ProductScraper Logic', () => {
    let ProductScraper: any;
    let CONFIG: any;
    let scraper: any;

    beforeAll(async () => {
        const utils = await import('./utils');
        ProductScraper = utils.ProductScraper;
        CONFIG = utils.CONFIG;
    });

    beforeEach(() => {
        scraper = new ProductScraper();
    });

    afterEach(async () => {
        if (scraper && scraper.browser) {
            await scraper.close();
        }
        jest.clearAllMocks();
    });

    test('should initialize with default configuration', () => {
        expect(CONFIG.CONCURRENCY_LIMIT).toBe(3);
        expect(CONFIG.MAX_RETRIES).toBe(3);
    });

    test('should resolve correct URL for Amazon SKU', () => {
        const input = { Type: 'Amazon', SKU: 'B012345' };
        const url = scraper.resolveProductUrl(input);
        expect(url).toBe('https://www.amazon.com/dp/B012345');
    });

    test('should resolve correct URL for Walmart SKU', () => {
        const input = { Type: 'Walmart', SKU: '987654321' };
        const url = scraper.resolveProductUrl(input);
        expect(url).toBe('https://www.walmart.com/ip/987654321');
    });

    test('should create fallback product on critical failure', async () => {
        const input = { Type: 'Amazon', SKU: 'FAIL123' };

        scraper.browser = null;

        // @ts-ignore: Accessing private method directly for testing purposes
        const result = await scraper.scrapeSingleSKU(input);

        expect(result).toBeDefined();
        expect(result.SKU).toBe('FAIL123');
        expect(result.Price).toBe('');
    });

    test('processSKUs should handle empty list gracefully', async () => {
        const results = await scraper.processSKUs([]);
        expect(results).toEqual([]);
    });
});