const fs = require('fs');
const path = require('path');

const domain = 'https://onlinebrainhub.com';

// Add any HTML files here that you do NOT want Google to index
const ignoreFiles = ['404.html'];

function generateSitemap() {
    // 1. Read all files in the current directory
    const files = fs.readdirSync(__dirname);
    
    // 2. Filter for only .html files
    const htmlFiles = files.filter(file => file.endsWith('.html') && !ignoreFiles.includes(file));

    // 3. Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];

    // 4. Start building the XML string
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    // 5. Loop through every HTML file and add it to the sitemap
    htmlFiles.forEach(file => {
        // Make sure index.html just points to the root domain
        let urlPath = file === 'index.html' ? '' : file;
        
        xml += `  <url>\n`;
        xml += `    <loc>${domain}/${urlPath}</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>weekly</changefreq>\n`;
        xml += `  </url>\n`;
    });

    xml += `</urlset>`;

    // 6. Write the final string into sitemap.xml
    fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), xml);
    console.log('Automated sitemap.xml generated successfully!');
}

generateSitemap();