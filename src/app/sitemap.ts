import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://sol-shield.xyz";
  const lastModified = new Date();

  return [
    {
      url: baseUrl,
      lastModified,
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/buildcheck`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/dev-lineage`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.85,
    },
    {
      url: `${baseUrl}/wallets`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.85,
    },
    {
      url: `${baseUrl}/wallet-detox`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.4,
    },
  ];
}
