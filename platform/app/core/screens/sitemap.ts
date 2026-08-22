export async function loader() {
  const origin = process.env.SITE_URL || "http://localhost:3000";
  const lastmod = new Date().toISOString();
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/</loc><lastmod>${lastmod}</lastmod></url>
  <url><loc>${origin}/news</loc><lastmod>${lastmod}</lastmod></url>
  <url><loc>${origin}/news/revit-2025-field-beta</loc><lastmod>${lastmod}</lastmod></url>
  <url><loc>${origin}/news/evidence-based-takeoff</loc><lastmod>${lastmod}</lastmod></url>
  <url><loc>${origin}/news/field-file-validation</loc><lastmod>${lastmod}</lastmod></url>
  <url><loc>${origin}/download</loc><lastmod>${lastmod}</lastmod></url>
  <url><loc>${origin}/inquiry</loc><lastmod>${lastmod}</lastmod></url>
</urlset>`,
    { headers: { "Content-Type": "application/xml" } },
  );
}
