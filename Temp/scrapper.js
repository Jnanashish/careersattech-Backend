const fetch = require('node-fetch');
// import fetch from 'node-fetch';

const { JSDOM } = require('jsdom');

async function fetchContent(url) {
  try {
    const response = await fetch(url);
    // console.log("RESPONSE", response);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const html = await response.text();
    const dom = new JSDOM(html);
    
    // const textContent = dom.window.document.body.textContent;
    const textContent = dom.window.document.querySelectorAll("p, h1, h2, h3, h4, h5, h6, span, ul, li, strong, b, div");
    const aff = Array.from(textContent).map(p => p.textContent);

    console.log("TEXT=", aff);  // Output the page's text content
  } catch (error) {
    console.error("Error fetching the URL content:", error);
  }
}

// Usage
// exports.scrap = ()=>{
    fetchContent("https://www.amazon.jobs/en/jobs/2815485/software-development-engineer-i-in-payments-use-cases-tech");

// }
