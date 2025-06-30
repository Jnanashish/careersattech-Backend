const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto('https://www.amazon.jobs/en/jobs/2815485/software-development-engineer-i-in-payments-use-cases-tech');

    // Extract visible text content
    const visibleTexts = await page.evaluate(() => {
        // Function to check visibility based on computed style
        const isVisible = (element) => {
            const style = window.getComputedStyle(element);
            return style && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
        };

        // Recursively get text content from visible elements only
        const getVisibleText = (element) => {
            let textContent = '';
            if (isVisible(element)) {
                if (element.childNodes.length) {
                    element.childNodes.forEach((child) => {
                        if (child.nodeType === Node.TEXT_NODE) {
                            textContent += child.textContent.trim() + ' ';
                        } else if (child.nodeType === Node.ELEMENT_NODE) {
                            textContent += getVisibleText(child);
                        }
                    });
                }
            }
            return textContent.trim();
        };

        // Start from the body and retrieve visible text
        return getVisibleText(document.body);
    });

    console.log(visibleTexts);
    await browser.close();
})();
