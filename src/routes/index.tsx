import { createFileRoute } from "@tanstack/react-router";
import ImageConverter from "@/components/ImageConverter";

const TITLE = "PixelForge — Free Image Converter, Compressor & Background Remover";
const DESCRIPTION =
  "Convert, compress, resize and remove backgrounds from PNG, JPG, WEBP, AVIF, SVG, HEIC, TIFF, PDF and Base64. 100% private, browser-based — no uploads, no accounts, no tracking.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      {
        name: "keywords",
        content:
          "image converter, png to jpg, jpg to webp, avif converter, heic to jpg, image compressor, resize image, remove background, base64 image, free online image tool",
      },
      { name: "author", content: "Mudassir Asghar" },
      { name: "theme-color", content: "#6366F1" },
      { name: "robots", content: "index, follow" },

      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { property: "og:site_name", content: "PixelForge" },

      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "PixelForge",
          description: DESCRIPTION,
          applicationCategory: "MultimediaApplication",
          operatingSystem: "Any",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          creator: { "@type": "Person", name: "Mudassir Asghar" },
          featureList: [
            "Convert images between PNG, JPG, WEBP, AVIF, SVG, HEIC, TIFF, PDF and Base64",
            "Compress images without losing quality",
            "Resize images to exact dimensions",
            "Remove image backgrounds with AI",
            "100% client-side — no uploads",
          ],
        }),
      },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <h1 className="sr-only">PixelForge — Free browser-based image converter, compressor and background remover</h1>
      <ImageConverter />
    </main>
  );
}
