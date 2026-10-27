import fs from "node:fs";
import { injectMetadata, metadataConfig } from "./metadata.js";
import { ABOUT_FAQ, renderAboutContent } from "../public/clientAboutContent.js";
export { ABOUT_FAQ };

export function renderAboutPage(options = {}) {
  let html = options.indexHtml ?? fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>/i, "");
  html = html.replace(/<div class="view" id="view-home">/, '<div class="view is-hidden" id="view-home">');
  html = html.replace(/<div class="view is-hidden" id="view-about">/, '<div class="view" id="view-about">');
  html = html.replace("<!-- about-content -->", () => renderAboutContent());
  const meta = metadataConfig({ ...options, path: "/about" });
  html = injectMetadata(html, { ...options, path: "/about" });
  if (meta.origin && meta.indexPolicy === "index,follow") {
    const data = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: ABOUT_FAQ.map(item => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })) };
    const json = JSON.stringify(data).replace(/</g, "\\u003c");
    html = html.replace("</head>", () => '<script type="application/ld+json">' + json + "</script>\n</head>");
  }
  return html;
}
