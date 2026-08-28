import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.FRONTEND_URL || 'https://samrat-fashion.vercel.app';

  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/shop', '/shop/*', '/custom-printing', '/bulk-printing', '/support'],
      disallow: ['/admin', '/admin/*', '/account', '/account/*', '/checkout', '/cart', '/forgot-password', '/reset-password', '/order-confirmation/*'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
