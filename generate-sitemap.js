
const fs = require('fs');
const path = require('path');

const domain = 'https://onlinebrainhub.com';

const ignoreFiles = [
    '404.html',
    'admin.html',
    'login.html',
    'profile.html'
];

function generateSitemap() {
    const files = fs.readdirSync(__dirname);

    const htmlFiles = files
        .filter(file => file.endsWith('.html'))
        .filter(file => !ignoreFiles.includes(file))
        .sort((a, b) => a.localeCompare(b));

    const today = new Date().toISOString().split('T')[0];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    htmlFiles.forEach(file => {
        const urlPath = file === 'index.html' ? '' : file;

        xml += `  <url>\n`;
        xml += `    <loc>${domain}/${urlPath}</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>weekly</changefreq>\n`;
        xml += `  </url>\n`;
    });

    xml += `</urlset>\n`;

    fs.writeFileSync(
        path.join(__dirname, 'sitemap.xml'),
        xml,
        'utf8'
    );

    console.log('Sitemap generated successfully.');
    console.log(`Included ${htmlFiles.length} HTML page(s).`);
    console.log(`Excluded: ${ignoreFiles.join(', ')}`);
}

generateSitemap();
