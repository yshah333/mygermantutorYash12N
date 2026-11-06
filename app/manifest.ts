import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Deutsch sprechen",
    short_name: "Deutsch",
    description: "Live German speaking practice, Goethe-style.",
    start_url: "/",
    display: "standalone",
    background_color: "#F4F5F8",
    theme_color: "#F4F5F8",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
